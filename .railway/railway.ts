import { defineRailway, github, postgres, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const backlinkMonitor = github("Artur229/backlink-monitor", { branch: "main", checkSuites: false });

  const Redis = redis("Redis", { region: "sfo" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  // Queues, schedules, Telegram bot. Exactly 1 replica: Telegram long polling allows one consumer.
  // Answers the healthcheck with a tiny HTTP server on $PORT (Redis ping).
  const worker = service("worker", {
    source: backlinkMonitor,
    build: { buildCommand: "npx prisma generate", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "npm run worker",
    healthcheck: "/api/health",
    replicas: { "sfo": 1 },
  });
  // Dashboard. Migrations run right before the server starts (idempotent).
  const backlinkMonitor2 = service("backlink-monitor", {
    source: backlinkMonitor,
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "npx prisma migrate deploy && npm run start",
    healthcheck: "/api/health",
    replicas: { "sfo": 1 },
  });

  return project("protective-adaptation", {
    variables: { managed: false },
    resources: [worker, Redis, Postgres, backlinkMonitor2, postgresVolume, redisVolume],
  });
});
