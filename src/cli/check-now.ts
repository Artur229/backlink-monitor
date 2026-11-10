import { prisma } from "../lib/db";
import { getQueues, enqueueManualCheck } from "../lib/queue/queues";
import { sharedRedis } from "../lib/queue/redis";
import { findLinksByDonor } from "../worker/bot";

/** Same as the dashboard "Check now" button: npm run check-now -- <donor url> */
const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run check-now -- <donor_url>");
  process.exit(2);
}
const links = (await findLinksByDonor(arg)) ?? [];
for (const l of links) await enqueueManualCheck(l.id);
console.log(links.length ? `✔ queued ${links.length} manual check(s) — the worker processes them` : "✖ no such donor page in DB");
const { checks, alerts, maintenance } = getQueues();
await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
sharedRedis().disconnect();
await prisma.$disconnect();
