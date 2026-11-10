import { execSync } from "node:child_process";
import { Redis } from "ioredis";
import pg from "pg";

/** Prepares backlink_test DB + Redis DB 15. If Docker isn't up, integration tests are skipped. */
export default async function setup() {
  const redis = new Redis("redis://localhost:6380/15", { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await redis.connect();
    await redis.flushdb();
    const admin = new pg.Client({ connectionString: "postgresql://backlink:backlink@localhost:5434/backlink" });
    await admin.connect();
    const exists = await admin.query("select 1 from pg_database where datname = 'backlink_test'");
    if (!exists.rowCount) await admin.query("create database backlink_test");
    await admin.end();
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: "postgresql://backlink:backlink@localhost:5434/backlink_test" },
      stdio: "ignore",
    });
    process.env.INTEGRATION = "1";
  } catch {
    process.env.INTEGRATION = "0";
    console.warn("⚠ Postgres/Redis not reachable (npm run db:up) — integration tests skipped");
  } finally {
    redis.disconnect();
  }
}
