import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config";
import { getProxyPool } from "../proxy";
import type { ProxyEntry, ProxyPool } from "../proxy/pool";
import { analyzePage, type ExpectedLink } from "./analyze";
import { fetchPage, type FetchOptions, type FetchResult } from "./fetch";
import { browserHeaders } from "./headers";
import type { CheckStatus } from "./status";

export interface CheckResult {
  status: CheckStatus;
  issues: string[];
  httpCode: number | null;
  finalUrl: string | null;
  /** duration of the last attempt */
  durationMs: number;
  /** host:port of the proxy used on the last attempt, null = direct */
  proxy: string | null;
  attempts: number;
  /** every proxy is disabled: the caller should pause the queue */
  allProxiesDown?: boolean;
}

export interface CheckDeps {
  fetch?: (url: string, opts: FetchOptions) => Promise<FetchResult>;
  fetchOptions?: Partial<FetchOptions>;
  /** null = no proxies (direct) */
  pool?: ProxyPool | null;
  retries?: number;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<unknown>;
  random?: () => number;
}

/** Longest Retry-After we are willing to wait inside a job; longer → give up for now. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Network-level failures that may heal on another attempt (and count against the proxy). */
const RETRIABLE_ERRORS = new Set(["timeout", "network", "proxy"]);
/** HTTP codes worth retrying: rate limit, server errors, IP bans (another proxy may pass). */
const isRetriableCode = (code: number) => code === 429 || code === 403 || code === 401 || code >= 500;

/**
 * One check of one link with retries (amendment 3: retries live here, not in BullMQ):
 * each attempt goes through a different proxy, waits 2s → 8s → 30s + jitter
 * or what Retry-After says. 404 and other definite answers are never retried.
 */
export async function checkLink(link: ExpectedLink, deps: CheckDeps = {}): Promise<CheckResult> {
  const doFetch = deps.fetch ?? fetchPage;
  const pool = deps.pool === undefined ? getProxyPool() : deps.pool;
  const retries = deps.retries ?? config.RETRIES;
  const delays = deps.retryDelaysMs ?? config.RETRY_DELAYS_MS;
  const wait = deps.sleep ?? sleep;
  const random = deps.random ?? Math.random;

  const usedProxies = new Set<string>();
  let result!: CheckResult;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let proxy: ProxyEntry | null = null;
    if (pool && pool.size > 0) {
      proxy = pool.pick(usedProxies);
      if (!proxy) {
        // No direct fallback: the caller pauses the queue instead of hammering donors from our own IP.
        result = {
          status: "error",
          issues: ["all proxies are down"],
          httpCode: null,
          finalUrl: null,
          durationMs: 0,
          proxy: null,
          attempts: attempt,
          allProxiesDown: true,
        };
        break;
      }
      usedProxies.add(proxy.url);
    }

    const res = await doFetch(link.donorUrl, {
      timeoutMs: config.TIMEOUT_MS,
      maxBodyBytes: config.MAX_BODY_BYTES,
      maxRedirects: config.MAX_REDIRECTS,
      headers: browserHeaders(random),
      dispatcher: proxy?.dispatcher(),
      ...deps.fetchOptions,
    });

    const { retriable, proxyFailed, retryAfterMs } = classify(res);
    if (proxy) (proxyFailed ? pool!.failure(proxy) : pool!.success(proxy));
    result = toResult(res, link, proxy, attempt + 1);

    if (!retriable || attempt === retries) break;

    let delay: number;
    if (retryAfterMs !== null) {
      if (retryAfterMs > MAX_RETRY_AFTER_MS) {
        result.issues.push(`Retry-After ${Math.round(retryAfterMs / 1000)}s is too long, giving up`);
        break;
      }
      delay = retryAfterMs;
    } else {
      const baseDelay = delays[Math.min(attempt, delays.length - 1)] ?? 0;
      delay = baseDelay + Math.round(random() * baseDelay * 0.3); // +0..30% jitter
    }
    await wait(delay);
  }

  if (result.attempts > 1) result.issues.push(`after ${result.attempts} attempts`);
  return result;
}

function classify(res: FetchResult): { retriable: boolean; proxyFailed: boolean; retryAfterMs: number | null } {
  if (!res.ok) {
    const netFail = RETRIABLE_ERRORS.has(res.kind);
    return { retriable: netFail, proxyFailed: netFail, retryAfterMs: null };
  }
  if (res.httpCode === 407) return { retriable: true, proxyFailed: true, retryAfterMs: null };
  if (isRetriableCode(res.httpCode)) {
    return { retriable: true, proxyFailed: false, retryAfterMs: parseRetryAfter(res.headers["retry-after"]) };
  }
  return { retriable: false, proxyFailed: false, retryAfterMs: null };
}

function toResult(res: FetchResult, link: ExpectedLink, proxy: ProxyEntry | null, attempts: number): CheckResult {
  const common = { durationMs: res.durationMs, proxy: proxy?.label ?? null, attempts };
  if (!res.ok) {
    return { status: "error", issues: [`${res.kind}: ${res.message}`], httpCode: res.httpCode ?? null, finalUrl: res.finalUrl ?? null, ...common };
  }
  if (res.httpCode === 407) {
    return { status: "error", issues: ["proxy: 407 Proxy Authentication Required"], httpCode: 407, finalUrl: res.finalUrl, ...common };
  }
  const { status, issues } = analyzePage(res, link);
  return { status, issues, httpCode: res.httpCode, finalUrl: res.finalUrl, ...common };
}

/** Retry-After: delta-seconds or HTTP-date → ms, null if absent/invalid. */
export function parseRetryAfter(v: string | string[] | undefined, now = Date.now()): number | null {
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}
