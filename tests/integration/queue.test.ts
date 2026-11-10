import { DelayedError, type Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CheckResult } from "../../src/lib/check/checkLink";
import type { CheckStatus } from "../../src/lib/check/status";
import { prisma } from "../../src/lib/db";
import { acquireDomainSlot, domainOf } from "../../src/lib/queue/domainLimiter";
import { dailyJobId, enqueueDailyChecks, getQueues, type CheckJobData } from "../../src/lib/queue/queues";
import { sharedRedis } from "../../src/lib/queue/redis";
import { makeCheckProcessor } from "../../src/worker/checkProcessor";

const run = process.env.INTEGRATION === "1";
const redis = sharedRedis();

beforeEach(async () => {
  if (!run) return;
  await redis.flushdb();
  await prisma.check.deleteMany();
  await prisma.link.deleteMany();
});

afterAll(async () => {
  const { checks, alerts, maintenance } = getQueues();
  await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
  redis.disconnect();
  await prisma.$disconnect();
});

describe.skipIf(!run)("per-domain limiter (Redis SET NX PX)", () => {
  it("one slot per domain per interval; www and case share the slot", async () => {
    expect(domainOf("https://WWW.Blog.com/a")).toBe("blog.com");
    expect(await acquireDomainSlot(redis, "blog.com", 500)).toBe(0);
    const wait = await acquireDomainSlot(redis, "blog.com", 500);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(500);
    expect(await acquireDomainSlot(redis, "other.com", 500)).toBe(0);
    await new Promise((r) => setTimeout(r, 550));
    expect(await acquireDomainSlot(redis, "blog.com", 500)).toBe(0);
  });

  it("20 concurrent attempts on one domain → exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => acquireDomainSlot(redis, "busy.com", 5000)));
    expect(results.filter((w) => w === 0)).toHaveLength(1);
  });
});

describe.skipIf(!run)("daily jobId dedup", () => {
  it("cron firing twice on the same day adds each link once", async () => {
    const { checks } = getQueues();
    await enqueueDailyChecks(["a", "b"], "2026-11-10");
    await enqueueDailyChecks(["a", "b"], "2026-11-10");
    expect(await checks.getJobCountByTypes("waiting", "prioritized")).toBe(2);
    expect((await checks.getJob(dailyJobId("a", "2026-11-10")))?.data).toEqual({ linkId: "a", reason: "daily" });
    await enqueueDailyChecks(["a"], "2026-11-11");
    expect(await checks.getJobCountByTypes("waiting", "prioritized")).toBe(3);
  });
});

describe.skipIf(!run)("check processor: DB + alerts + confirmation", () => {
  const fakeJob = (linkId: string, id: string) => {
    const moved: number[] = [];
    const job = {
      id,
      data: { linkId, reason: "daily" } as CheckJobData,
      moveToDelayed: async (ts: number) => void moved.push(ts),
    } as unknown as Job<CheckJobData>;
    return { job, moved };
  };
  const result = (status: CheckStatus): CheckResult => ({
    status, issues: status === "lost" ? ["link not found"] : [], httpCode: 200,
    finalUrl: "https://donor.com/p", durationMs: 42, proxy: null, attempts: 1,
  });
  const processorReturning = (...statuses: CheckStatus[]) => {
    let i = 0;
    return makeCheckProcessor({ redis, check: async () => result(statuses[i++] ?? statuses.at(-1)!), random: () => 0 });
  };
  const newLink = () =>
    prisma.link.create({ data: { donorUrl: `https://donor-${Math.random()}.com/p`, targetUrl: "https://my-site.com/", priceUsd: 150, outreacher: "Olha" } });

  it("first ok: writes a Check, status ok, no alert", async () => {
    const link = await newLink();
    const out = await processorReturning("ok")(fakeJob(link.id, "j1").job);
    expect(out).toMatchObject({ status: "ok", alert: null });
    const saved = await prisma.link.findUniqueOrThrow({ where: { id: link.id }, include: { checks: true } });
    expect(saved).toMatchObject({ status: "ok", lastConclusiveStatus: "ok", failStreak: 0 });
    expect(saved.lastCheckedAt).toBeInstanceOf(Date);
    expect(saved.checks).toHaveLength(1);
    expect(saved.checks[0]).toMatchObject({ httpCode: 200, status: "ok", durationMs: 42 });
  });

  it("ok → lost: confirm job in 1h, no alert; second lost → one alert", async () => {
    const link = await newLink();
    await prisma.link.update({ where: { id: link.id }, data: { status: "ok", lastConclusiveStatus: "ok" } });
    const { checks, alerts } = getQueues();

    const proc = processorReturning("lost", "lost");
    await proc(fakeJob(link.id, `${link.id}_2026-11-10`).job);
    const confirm = await checks.getJob(`${link.id}_2026-11-10_confirm`);
    expect(confirm?.data).toEqual({ linkId: link.id, reason: "confirm" });
    expect(confirm?.opts.delay).toBe(3_600_000);
    expect(await alerts.count()).toBe(0);
    expect((await prisma.link.findUniqueOrThrow({ where: { id: link.id } })).status).toBe("ok");

    await redis.flushdb(); // free the domain slot
    await proc(fakeJob(link.id, `${link.id}_2026-11-10_confirm`).job);
    const alertJobs = await alerts.getJobs(["waiting", "delayed", "prioritized"]);
    expect(alertJobs).toHaveLength(1);
    expect(alertJobs[0]!.data).toMatchObject({ type: "status", linkId: link.id, alert: { from: "ok", to: "lost" } });
    const saved = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(saved).toMatchObject({ status: "lost", lastConclusiveStatus: "lost" });
    expect(saved.statusChangedAt).toBeInstanceOf(Date);
  });

  it("re-running the same job after a crash does not duplicate the alert", async () => {
    const link = await newLink();
    await prisma.link.update({ where: { id: link.id }, data: { status: "ok", lastConclusiveStatus: "ok" } });
    // simulate: alert enqueued, then crash before DB write → same job runs again with unchanged DB state
    const { alerts } = getQueues();
    await alerts.add("status", { type: "status", linkId: link.id, alert: { from: "ok", to: "nofollow", kind: "problem" } }, { jobId: "alert_job-x" });
    await processorReturning("nofollow")(fakeJob(link.id, "job-x").job);
    expect(await alerts.count()).toBe(1);
  });

  it("busy domain → job moved to delayed, nothing checked", async () => {
    const link = await newLink();
    await acquireDomainSlot(redis, domainOf(link.donorUrl), 5000);
    const { job, moved } = fakeJob(link.id, "j-busy");
    await expect(processorReturning("ok")(job)).rejects.toBeInstanceOf(DelayedError);
    expect(moved).toHaveLength(1);
    expect(moved[0]! - Date.now()).toBeGreaterThan(4000);
    expect(await prisma.check.count({ where: { linkId: link.id } })).toBe(0);
  });

  it("all proxies down → job delayed, no fake error recorded", async () => {
    const link = await newLink();
    const proc = makeCheckProcessor({
      redis,
      check: async () => ({ ...result("error"), issues: ["all proxies are down"], allProxiesDown: true }),
    });
    const { job, moved } = fakeJob(link.id, "j-proxy");
    await expect(proc(job)).rejects.toBeInstanceOf(DelayedError);
    expect(moved[0]! - Date.now()).toBeGreaterThanOrEqual(59_000);
    expect(await prisma.check.count({ where: { linkId: link.id } })).toBe(0);
    expect((await prisma.link.findUniqueOrThrow({ where: { id: link.id } })).status).toBe("pending");
  });

  it("blocked: shown, no alert, conclusive status kept", async () => {
    const link = await newLink();
    await prisma.link.update({ where: { id: link.id }, data: { status: "ok", lastConclusiveStatus: "ok" } });
    await processorReturning("blocked")(fakeJob(link.id, "j-b").job);
    expect(await getQueues().alerts.count()).toBe(0);
    expect(await prisma.link.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ status: "blocked", lastConclusiveStatus: "ok" });
  });
});
