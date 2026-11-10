import { getQueues } from "../lib/queue/queues";
import { sharedRedis } from "../lib/queue/redis";

const { checks, alerts, maintenance } = getQueues();
for (const q of [checks, alerts, maintenance]) {
  const c = await q.getJobCounts("waiting", "active", "delayed", "prioritized", "completed", "failed");
  console.log(q.name.padEnd(12), JSON.stringify(c), (await q.isPaused()) ? "PAUSED" : "");
}
await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
sharedRedis().disconnect();
