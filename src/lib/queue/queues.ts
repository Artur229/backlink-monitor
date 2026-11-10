import { Queue, type JobsOptions } from "bullmq";
import { config } from "../config";
import type { Alert } from "../monitor/transition";
import { sharedRedis } from "./redis";

export const CHECKS = "checks";
export const ALERTS = "alerts";
export const MAINTENANCE = "maintenance";

export type CheckReason = "daily" | "manual" | "confirm";
export interface CheckJobData {
  linkId: string;
  reason: CheckReason;
}

export type AlertJobData =
  | { type: "status"; linkId: string; checkId?: string; alert: Alert }
  | { type: "system"; message: string }
  | { type: "digest"; text: string };

const DAY_S = 86_400;

/**
 * Check jobs: completed ones are kept for a day so the daily jobId dedup survives
 * a second cron firing (amendment 2). `attempts` here only covers crashes/DB errors —
 * HTTP retries live inside checkLink() (amendment 3).
 */
export const checkJobDefaults: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: DAY_S },
  removeOnFail: { age: 7 * DAY_S },
};

/** Alerts are a separate queue with generous retries: Telegram may be down. */
export const alertJobDefaults: JobsOptions = {
  attempts: 10,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: DAY_S },
  removeOnFail: { age: 7 * DAY_S },
};

let queues: { checks: Queue<CheckJobData>; alerts: Queue<AlertJobData>; maintenance: Queue } | null = null;

export function getQueues() {
  if (!queues) {
    const connection = sharedRedis();
    queues = {
      checks: new Queue<CheckJobData>(CHECKS, { connection, defaultJobOptions: checkJobDefaults }),
      alerts: new Queue<AlertJobData>(ALERTS, { connection, defaultJobOptions: alertJobDefaults }),
      maintenance: new Queue(MAINTENANCE, { connection, defaultJobOptions: { removeOnComplete: { age: 7 * DAY_S }, removeOnFail: { age: 7 * DAY_S } } }),
    };
  }
  return queues;
}

/** YYYY-MM-DD in the configured timezone — part of the daily jobId. */
export function dateKey(d = new Date(), tz = config.TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Daily check id: `${linkId}_${date}` — a second cron firing on the same day adds nothing. */
export const dailyJobId = (linkId: string, date = dateKey()) => `${linkId}_${date}`;

/** "Check now" from dashboard / bot. Deduplicated while one is already waiting or running. */
export async function enqueueManualCheck(linkId: string) {
  return getQueues().checks.add(
    "check",
    { linkId, reason: "manual" },
    { jobId: `${linkId}_manual_${Date.now()}`, deduplication: { id: `manual_${linkId}` }, priority: 1 },
  );
}

/** Enqueue a daily check for every link (idempotent per day). */
export async function enqueueDailyChecks(linkIds: string[], date = dateKey()) {
  const { checks } = getQueues();
  const BATCH = 500;
  for (let i = 0; i < linkIds.length; i += BATCH) {
    await checks.addBulk(
      linkIds.slice(i, i + BATCH).map((linkId) => ({
        name: "check",
        data: { linkId, reason: "daily" as const },
        opts: { jobId: dailyJobId(linkId, date), priority: 10 },
      })),
    );
  }
}
