import { createServer } from "node:http";
import { Worker } from "bullmq";
import { config } from "../lib/config";
import { getProxyPool, setOnAllProxiesDown } from "../lib/proxy";
import { getQueues, ALERTS, CHECKS, MAINTENANCE } from "../lib/queue/queues";
import { createRedis, sharedRedis } from "../lib/queue/redis";
import { makeAlertProcessor } from "./alertProcessor";
import { createBot } from "./bot";
import { makeCheckProcessor } from "./checkProcessor";
import { processMaintenance } from "./maintenance";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function main() {
  const { checks, alerts, maintenance } = getQueues();
  const pool = getProxyPool();
  log(`worker starting: concurrency=${config.CONCURRENCY}, proxies=${pool.size || "none (direct)"}, tz=${config.TZ}`);

  // On Railway the platform healthcheck hits $PORT; answer 200 while Redis responds.
  if (process.env.PORT) {
    createServer(async (_req, res) => {
      const ok = await sharedRedis().ping().then(() => true, () => false);
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, role: "worker" }));
    }).listen(Number(process.env.PORT), () => log(`health endpoint on :${process.env.PORT}`));
  }

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

  // Telegram: alerts consumer + bot commands + daily digest. Without a token the alerts
  // just wait in Redis (nothing is lost) and are sent once the bot is configured.
  let telegram: ReturnType<typeof createBot> | null = null;
  let alertWorker: Worker | null = null;
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    telegram = createBot(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);
    alertWorker = new Worker(ALERTS, makeAlertProcessor(telegram.send), {
      connection: createRedis(),
      concurrency: 1,
      limiter: { max: 1, duration: 1100 }, // Telegram: ~1 message/sec per chat
    });
    alertWorker.on("completed", (job) => log(`✉ sent ${job.id}`));
    alertWorker.on("failed", (job, err) => log(`✉✖ ${job?.id} (attempt ${job?.attemptsMade})`, err.message));
    await maintenance.upsertJobScheduler("daily-digest", { pattern: config.DIGEST_CRON, tz: config.TZ }, { name: "digest" });
    log(`digest scheduled: "${config.DIGEST_CRON}" ${config.TZ}`);
    void telegram.bot.start({
      drop_pending_updates: true,
      onStart: (me) => log(`bot @${me.username} polling`),
    });
  } else {
    log("⚠ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — alerts are kept in the queue, not sent");
  }

  const shutdown = async (signal: string) => {
    log(`${signal}: finishing active jobs…`);
    clearTimeout(resumeTimer);
    await telegram?.stop();
    await Promise.all([checkWorker.close(), maintWorker.close(), alertWorker?.close()]);
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
