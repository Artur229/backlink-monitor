import { Worker } from "bullmq";
import { config } from "../lib/config";
import { getProxyPool, setOnAllProxiesDown } from "../lib/proxy";
import { getQueues, CHECKS, MAINTENANCE } from "../lib/queue/queues";
import { createRedis, sharedRedis } from "../lib/queue/redis";
import { makeCheckProcessor } from "./checkProcessor";
import { processMaintenance } from "./maintenance";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function main() {
  const { checks, alerts, maintenance } = getQueues();
  const pool = getProxyPool();
  log(`worker starting: concurrency=${config.CONCURRENCY}, proxies=${pool.size || "none (direct)"}, tz=${config.TZ}`);

  // A previous process may have paused the queue (all proxies down); proxy state is fresh now.
  await checks.resume();

  // All proxies dead → pause the queue, one system alert, resume when the first proxy cools down.
  let resumeTimer: NodeJS.Timeout | undefined;
  setOnAllProxiesDown(() => {
    const ms = Math.max(pool.msUntilAvailable(), 60_000);
    log(`all ${pool.size} proxies are down → pausing checks for ${Math.round(ms / 1000)}s`);
    void checks.pause();
    void alerts.add("system", {
      type: "system",
      message: `Усі проксі (${pool.size}) недоступні. Перевірки на паузі ~${Math.round(ms / 60_000)} хв.`,
    }, { jobId: `system_proxies_down_${Math.floor(Date.now() / ms)}` });
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      log("resuming checks");
      void checks.resume();
    }, ms);
  });

  // Daily schedule (Job Scheduler, BullMQ v6). Upsert is idempotent across restarts.
  await maintenance.upsertJobScheduler("daily-checks", { pattern: config.CHECK_CRON, tz: config.TZ }, { name: "daily-run" });
  log(`daily checks scheduled: "${config.CHECK_CRON}" ${config.TZ}`);

  const checkWorker = new Worker(CHECKS, makeCheckProcessor({ redis: sharedRedis() }), {
    connection: createRedis(),
    concurrency: config.CONCURRENCY,
    // Jobs of a killed worker are picked up again after restart (stalled → waiting).
    maxStalledCount: 3,
  });
  checkWorker.on("completed", (job, r) => log(`✓ ${job.id} [${job.data.reason}]`, JSON.stringify(r)));
  checkWorker.on("failed", (job, err) => log(`✖ ${job?.id}`, err.message));
  checkWorker.on("error", (err) => log("worker error", err.message));

  const maintWorker = new Worker(MAINTENANCE, processMaintenance, { connection: createRedis(), concurrency: 1 });
  maintWorker.on("completed", (job, r) => log(`✓ maintenance ${job.name}`, JSON.stringify(r)));
  maintWorker.on("failed", (job, err) => log(`✖ maintenance ${job?.name}`, err.message));

  const shutdown = async (signal: string) => {
    log(`${signal}: finishing active jobs…`);
    clearTimeout(resumeTimer);
    await Promise.all([checkWorker.close(), maintWorker.close()]);
    await Promise.all([checks.close(), alerts.close(), maintenance.close()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
