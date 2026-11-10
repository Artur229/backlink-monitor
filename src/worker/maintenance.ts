import type { Job } from "bullmq";
import { prisma } from "../lib/db";
import { dateKey, enqueueDailyChecks } from "../lib/queue/queues";

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

export async function processMaintenance(job: Job) {
  switch (job.name) {
    case "daily-run":
      return runDaily();
    default:
      throw new Error(`unknown maintenance job ${job.name}`);
  }
}
