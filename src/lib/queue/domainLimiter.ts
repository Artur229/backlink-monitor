import type { Redis } from "ioredis";

/** Domain key: hostname without www., so www.blog.com and blog.com share a slot. */
export function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Per-domain rate limit (amendment 1, open-source BullMQ has no group limits):
 * SET bm:domain:<host> NX PX <ms>. Returns 0 if the slot is ours, otherwise
 * how many ms until the domain is free — the caller moves the job to delayed.
 */
export async function acquireDomainSlot(redis: Redis, domain: string, intervalMs: number): Promise<number> {
  if (intervalMs <= 0) return 0;
  const key = `bm:domain:${domain}`;
  for (let i = 0; i < 2; i++) {
    const ok = await redis.set(key, "1", "PX", intervalMs, "NX");
    if (ok === "OK") return 0;
    const ttl = await redis.pttl(key);
    if (ttl > 0) return ttl;
    // key expired between SET and PTTL (-2) or has no TTL (-1, shouldn't happen) → try again
    if (ttl === -1) await redis.pexpire(key, intervalMs);
  }
  return intervalMs;
}
