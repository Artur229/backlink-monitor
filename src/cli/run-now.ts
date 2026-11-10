import { prisma } from "../lib/db";
import { getQueues } from "../lib/queue/queues";
import { sharedRedis } from "../lib/queue/redis";
import { runDaily } from "../worker/maintenance";

/** Enqueue today's checks for all links right now (same jobIds as the cron → safe to repeat). */
const r = await runDaily();
console.log(`✔ ${r.enqueued} links queued for ${r.date} (already-queued ones are skipped by jobId)`);
const { checks, alerts, maintenance } = getQueues();
await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
sharedRedis().disconnect();
await prisma.$disconnect();
