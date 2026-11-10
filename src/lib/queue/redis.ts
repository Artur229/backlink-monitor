import { Redis } from "ioredis";
import { config } from "../config";

/**
 * BullMQ workers need maxRetriesPerRequest: null (blocking commands).
 * family: 0 = dual-stack DNS lookup: Railway's private network (redis.railway.internal) is IPv6.
 */
export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
}

let shared: Redis | null = null;
export function sharedRedis(): Redis {
  return (shared ??= createRedis());
}
