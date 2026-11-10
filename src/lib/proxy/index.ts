import { config } from "../config";
import { ProxyPool, type PoolOptions } from "./pool";

let pool: ProxyPool | null = null;
let onAllDown: (() => void) | undefined;

/** Lets the worker hook "all proxies down" → pause queue + system alert (step 5/6). */
export function setOnAllProxiesDown(fn: () => void): void {
  onAllDown = fn;
}

/** Process-wide pool from PROXY_LIST. Empty when the file is missing → direct connection. */
export function getProxyPool(): ProxyPool {
  if (!pool) {
    const opts: PoolOptions = {
      failThreshold: config.PROXY_FAIL_THRESHOLD,
      cooldownMs: config.PROXY_COOLDOWN_MS,
      onAllDown: () => onAllDown?.(),
    };
    pool = ProxyPool.fromFile(config.PROXY_LIST, opts);
  }
  return pool;
}
