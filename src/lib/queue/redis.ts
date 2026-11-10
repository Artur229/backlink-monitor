import { Redis } from "ioredis";
import { config } from "../config";

/** BullMQ workers need maxRetriesPerRequest: null (blocking commands). */
export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

let shared: Redis | null = null;
export function sharedRedis(): Redis {
  return (shared ??= createRedis());
}
