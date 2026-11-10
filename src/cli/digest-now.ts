import { prisma } from "../lib/db";
import { getQueues } from "../lib/queue/queues";
import { sharedRedis } from "../lib/queue/redis";
import { buildDigest } from "../worker/maintenance";

/** Sends today's digest now (bypasses the once-a-day jobId): npm run digest-now [-- --print] */
const text = await buildDigest();
if (process.argv.includes("--print")) {
  console.log(text);
} else {
  await getQueues().alerts.add("digest", { type: "digest", text }, { jobId: `digest_manual_${Date.now()}` });
  console.log("✔ digest queued — the worker sends it");
}
const { checks, alerts, maintenance } = getQueues();
await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
sharedRedis().disconnect();
await prisma.$disconnect();
