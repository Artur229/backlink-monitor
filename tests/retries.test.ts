import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "undici";
import { checkLink, parseRetryAfter } from "../src/lib/check/checkLink";
import type { FetchResult } from "../src/lib/check/fetch";
import { ProxyPool } from "../src/lib/proxy/pool";

const LINK = { donorUrl: "https://blog-example.com/p", targetUrl: "https://my-site.com/", anchor: null };
const OK_HTML = `<a href="https://my-site.com/">x</a>`;

const page = (httpCode: number, headers: Record<string, string> = {}, html = OK_HTML): FetchResult => ({
  ok: true, httpCode, headers, html, finalUrl: LINK.donorUrl, redirects: [], durationMs: 10,
});
const fail = (kind: "timeout" | "network" | "dns" | "tls" | "proxy"): FetchResult => ({
  ok: false, kind, message: kind, durationMs: 10,
});

/** fetch stub that returns the given results in order and records which dispatcher was used */
function script(...results: FetchResult[]) {
  const calls: (Dispatcher | undefined)[] = [];
  const fetch = vi.fn(async (_url: string, opts: { dispatcher?: Dispatcher }) => {
    calls.push(opts.dispatcher);
    return results[Math.min(calls.length - 1, results.length - 1)]!;
  });
  return { fetch, calls };
}

const base = (fetch: ReturnType<typeof script>["fetch"], extra = {}) => {
  const sleep = vi.fn(async (_ms: number) => {});
  return { deps: { fetch, sleep, pool: null, retries: 3, retryDelaysMs: [2000, 8000, 30000], random: () => 0, ...extra }, sleep };
};

describe("checkLink retries", () => {
  it("timeout twice then ok → ok after 3 attempts, delays 2s, 8s", async () => {
    const { fetch } = script(fail("timeout"), fail("network"), page(200));
    const { deps, sleep } = base(fetch);
    const r = await checkLink(LINK, deps);
    expect(r).toMatchObject({ status: "ok", attempts: 3 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 8000]);
  });

  it("adds up to 30% jitter", async () => {
    const { fetch } = script(fail("timeout"), page(200));
    const { deps, sleep } = base(fetch, { random: () => 0.5 });
    await checkLink(LINK, deps);
    expect(sleep).toHaveBeenCalledWith(2300);
  });

  it("always timing out → error after 1 + 3 retries, never lost", async () => {
    const { fetch } = script(fail("timeout"));
    const { deps, sleep } = base(fetch);
    const r = await checkLink(LINK, deps);
    expect(r.status).toBe("error");
    expect(r.attempts).toBe(4);
    expect(r.issues).toEqual(["timeout: timeout", "after 4 attempts"]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 8000, 30000]);
  });

  it("404 is never retried", async () => {
    const { fetch } = script(page(404));
    const { deps } = base(fetch);
    expect(await checkLink(LINK, deps)).toMatchObject({ status: "page_gone", attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lost (200 without link) is not retried — confirmation is the scheduler's job", async () => {
    const { fetch } = script(page(200, {}, "<p>nothing</p>"));
    const { deps } = base(fetch);
    expect(await checkLink(LINK, deps)).toMatchObject({ status: "lost", attempts: 1 });
  });

  it("DNS / TLS failures are not retried", async () => {
    for (const kind of ["dns", "tls"] as const) {
      const { fetch } = script(fail(kind));
      const { deps } = base(fetch);
      expect(await checkLink(LINK, deps)).toMatchObject({ status: "error", attempts: 1 });
    }
  });

  it("429 persistently → blocked after all retries", async () => {
    const { fetch } = script(page(429));
    const { deps } = base(fetch);
    expect(await checkLink(LINK, deps)).toMatchObject({ status: "blocked", attempts: 4 });
  });

  it("503 then 200 → ok", async () => {
    const { fetch } = script(page(503), page(200));
    const { deps } = base(fetch);
    expect(await checkLink(LINK, deps)).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("honours Retry-After seconds instead of the backoff", async () => {
    const { fetch } = script(page(429, { "retry-after": "7" }), page(200));
    const { deps, sleep } = base(fetch);
    await checkLink(LINK, deps);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("gives up when Retry-After is longer than the cap", async () => {
    const { fetch } = script(page(429, { "retry-after": "3600" }));
    const { deps, sleep } = base(fetch);
    const r = await checkLink(LINK, deps);
    expect(r.status).toBe("blocked");
    expect(r.attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.issues.at(-1)).toMatch(/Retry-After 3600s is too long/);
  });
});

describe("checkLink with proxies", () => {
  const makePool = (n: number, onAllDown = vi.fn()) => {
    const dispatchers = new Map<string, Dispatcher>();
    const pool = new ProxyPool(
      Array.from({ length: n }, (_, i) => `http://user:secret@10.0.0.${i + 1}:8000`),
      {
        failThreshold: 3,
        cooldownMs: 600_000,
        onAllDown,
        makeDispatcher: (url) => {
          const d = { url } as unknown as Dispatcher;
          dispatchers.set(url, d);
          return d;
        },
      },
    );
    return { pool, onAllDown };
  };

  it("each retry goes through a different proxy; result records the label without password", async () => {
    const { pool } = makePool(3);
    const { fetch, calls } = script(fail("timeout"), fail("proxy"), page(200));
    const { deps } = base(fetch, { pool });
    const r = await checkLink(LINK, deps);
    const used = calls.map((d) => (d as unknown as { url: string }).url);
    expect(new Set(used).size).toBe(3);
    expect(r.status).toBe("ok");
    expect(r.proxy).toBe("10.0.0.3:8000");
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("network failures count against the proxy; HTTP 403 from the donor does not", async () => {
    const { pool } = makePool(1);
    const { fetch } = script(page(403));
    await checkLink(LINK, base(fetch, { pool }).deps);
    expect(pool.available()).toHaveLength(1);

    const { fetch: f2 } = script(fail("timeout"));
    await checkLink(LINK, base(f2, { pool, retries: 2 }).deps);
    expect(pool.available()).toHaveLength(0);
  });

  it("407 from proxy counts as proxy failure and is retried via another proxy", async () => {
    const { pool } = makePool(2);
    const { fetch } = script(page(407), page(200));
    const r = await checkLink(LINK, base(fetch, { pool }).deps);
    expect(r).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("all proxies dead → error with allProxiesDown, onAllDown fired once, no direct fallback", async () => {
    const { pool, onAllDown } = makePool(2);
    const { fetch } = script(fail("proxy"));
    // 2 proxies × 3 failures each = 6 attempts → need retries >= 5
    const r = await checkLink(LINK, base(fetch, { pool, retries: 10 }).deps);
    expect(r).toMatchObject({ status: "error", allProxiesDown: true, issues: ["all proxies are down", "after 6 attempts"] });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(onAllDown).toHaveBeenCalledTimes(1);

    const again = await checkLink(LINK, base(fetch, { pool }).deps);
    expect(again.allProxiesDown).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(6); // no request made
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Tue, 10 Nov 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
