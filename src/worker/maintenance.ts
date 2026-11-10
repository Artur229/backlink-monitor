import type { Job } from "bullmq";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { getStats, PROBLEMS, UNREACHABLE } from "../lib/monitor/stats";
import type { StoredStatus } from "../lib/monitor/transition";
import { dateKey, enqueueDailyChecks, getQueues } from "../lib/queue/queues";
import { formatDigest } from "../lib/telegram/format";

/** "daily-run": put one check job per link into the queue (jobId per day → idempotent). */
export async function runDaily(): Promise<{ date: string; enqueued: number }> {
  const date = dateKey();
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const batch = await prisma.link.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    await enqueueDailyChecks(batch.map((l) => l.id), date);
    total += batch.length;
    cursor = batch.at(-1)!.id;
  }
  return { date, enqueued: total };
}

/** Builds today's digest text (also used by tests and a manual preview). */
export async function buildDigest(): Promise<string> {
  const stats = await getStats();
  const select = { donorUrl: true, status: true, outreacher: true, priceUsd: true } as const;
  const [problems, unreachable] = await Promise.all([
    prisma.link.findMany({
      where: { status: { in: [...PROBLEMS] as StoredStatus[] } },
      select,
      orderBy: [{ priceUsd: { sort: "desc", nulls: "last" } }, { donorUrl: "asc" }],
    }),
    prisma.link.findMany({
      where: { status: { in: [...UNREACHABLE] as StoredStatus[] } },
      select,
      orderBy: [{ priceUsd: { sort: "desc", nulls: "last" } }, { donorUrl: "asc" }],
    }),
  ]);
  const [y, m, d] = dateKey().split("-");
  return formatDigest(`${d}.${m}.${y}`, stats, problems, unreachable, config.DASHBOARD_URL);
}

/** "digest": goes through the alerts queue so it gets the same Telegram retries. One per day. */
export async function enqueueDigest() {
  const text = await buildDigest();
  await getQueues().alerts.add("digest", { type: "digest", text }, { jobId: `digest_${dateKey()}` });
  return { digest: dateKey() };
}

export async function processMaintenance(job: Job) {
  switch (job.name) {
    case "daily-run":
      return runDaily();
    case "digest":
      return enqueueDigest();
    default:
      throw new Error(`unknown maintenance job ${job.name}`);
  }
}
