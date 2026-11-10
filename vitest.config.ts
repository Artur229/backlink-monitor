import { defineConfig } from "vitest/config";

const TEST_DB = "postgresql://backlink:backlink@localhost:5434/backlink_test";
const TEST_REDIS = "redis://localhost:6380/15";

export default defineConfig({
  test: {
    // Integration tests use a separate DB and Redis DB 15, never the dev data.
    env: { DATABASE_URL: TEST_DB, REDIS_URL: TEST_REDIS, TZ: "Europe/Kyiv", PROXY_LIST: "does-not-exist.txt" },
    globalSetup: ["tests/integration/globalSetup.ts"],
    fileParallelism: false,
  },
});
