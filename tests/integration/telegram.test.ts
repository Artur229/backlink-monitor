import { UnrecoverableError, type Job } from "bullmq";
import { GrammyError, HttpError } from "grammy";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/db";
import { getQueues, type AlertJobData } from "../../src/lib/queue/queues";
import { sharedRedis } from "../../src/lib/queue/redis";
import { makeAlertProcessor } from "../../src/worker/alertProcessor";
import { findLinksByDonor } from "../../src/worker/bot";
import { buildDigest, enqueueDigest } from "../../src/worker/maintenance";

const run = process.env.INTEGRATION === "1";

beforeEach(async () => {
  if (!run) return;
  await sharedRedis().flushdb();
  await prisma.check.deleteMany();
  await prisma.link.deleteMany();
});

afterAll(async () => {
  const { checks, alerts, maintenance } = getQueues();
  await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
  sharedRedis().disconnect();
  await prisma.$disconnect();
});

const job = (data: AlertJobData) => ({ id: "a1", data }) as unknown as Job<AlertJobData>;
const tgError = (code: number, description: string) =>
  new GrammyError("Call to 'sendMessage' failed!", { ok: false, error_code: code, description }, "sendMessage", {});

describe.skipIf(!run)("alert processor", () => {
  it("formats a status alert from DB data and the latest check's issues", async () => {
    const link = await prisma.link.create({
      data: { donorUrl: "https://blog-example.com/best-tips", targetUrl: "https://my-site.com/", outreacher: "Olha", priceUsd: 150, status: "lost" },
    });
    await prisma.check.create({ data: { linkId: link.id, status: "lost", issues: ["link not found"], httpCode: 200 } });
    const send = vi.fn(async () => {});
    await makeAlertProcessor(send)(job({ type: "status", linkId: link.id, alert: { from: "ok", to: "lost", kind: "problem" } }));
    expect(send).toHaveBeenCalledOnce();
    const html = (send.mock.calls[0] as unknown as [string])[0];
    expect(html).toContain("❗ Посилання зникло</b>: blog-example.com/best-tips → my-site.com");
    expect(html).toContain("Аутричер: Olha. Заплачено: $150.");
    expect(html).toContain(`/links/${link.id}`);
  });

  it("deleted link → skipped, nothing sent", async () => {
    const send = vi.fn(async () => {});
    expect(await makeAlertProcessor(send)(job({ type: "status", linkId: "gone", alert: { from: "ok", to: "lost", kind: "problem" } }))).toEqual({ skipped: "link deleted" });
    expect(send).not.toHaveBeenCalled();
  });

  it("Telegram down / 429 / 5xx → retriable error (BullMQ retries)", async () => {
    for (const err of [tgError(429, "Too Many Requests: retry after 5"), tgError(502, "Bad Gateway"), new HttpError("Network request failed", new Error("ECONNRESET"))]) {
      const p = makeAlertProcessor(async () => { throw err; })(job({ type: "system", message: "x" }));
      await expect(p).rejects.toThrow(/Telegram unavailable/);
      await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
    }
  });

  it("permanent 4xx (bad chat id) → UnrecoverableError, no retry loop", async () => {
    const p = makeAlertProcessor(async () => { throw tgError(400, "Bad Request: chat not found"); })(job({ type: "system", message: "x" }));
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe.skipIf(!run)("digest", () => {
  it("summarizes the DB and is enqueued once per day", async () => {
    await prisma.link.createMany({
      data: [
        { donorUrl: "https://a.com/1", targetUrl: "https://my-site.com/", status: "ok", priceUsd: 100 },
        { donorUrl: "https://b.com/1", targetUrl: "https://my-site.com/", status: "lost", priceUsd: 150, outreacher: "Olha" },
        { donorUrl: "https://c.com/1", targetUrl: "https://my-site.com/", status: "nofollow", priceUsd: 300 },
        { donorUrl: "https://d.com/1", targetUrl: "https://my-site.com/", status: "blocked", priceUsd: 70 },
      ],
    });
    const text = await buildDigest();
    expect(text).toContain("Усього посилань: <b>4</b>");
    expect(text).toContain("💰 Під ризиком: <b>$450</b>");
    // most expensive problem first
    expect(text.indexOf("c.com/1")).toBeLessThan(text.indexOf("b.com/1"));
    expect(text).toContain("<b>Не вдалося перевірити:</b>\n• d.com/1 — blocked, $70");

    await enqueueDigest();
    await enqueueDigest();
    expect(await getQueues().alerts.count()).toBe(1);
  });
});

describe.skipIf(!run)("/check lookup", () => {
  it("finds a donor page regardless of protocol, www, slash, utm", async () => {
    await prisma.link.createMany({
      data: [
        { donorUrl: "https://blog-example.com/best-tips", targetUrl: "https://my-site.com/" },
        { donorUrl: "https://blog-example.com/best-tips", targetUrl: "https://my-site.com/reviews" },
        { donorUrl: "https://blog-example.com/other", targetUrl: "https://my-site.com/" },
      ],
    });
    expect(await findLinksByDonor("www.blog-example.com/best-tips/?utm_source=tg")).toHaveLength(2);
    expect(await findLinksByDonor("http://BLOG-EXAMPLE.com/other")).toHaveLength(1);
    expect(await findLinksByDonor("blog-example.com/nope")).toHaveLength(0);
    expect(await findLinksByDonor("not a url at all")).toBeNull();
  });
});
