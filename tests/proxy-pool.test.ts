import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "undici";
import { ProxyPool, parseProxyList } from "../src/lib/proxy/pool";

const URLS = ["http://u:p@10.0.0.1:8000", "http://u:p@10.0.0.2:8000", "http://u:p@10.0.0.3:8000"];

function makePool(urls = URLS, onAllDown = vi.fn()) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const pool = new ProxyPool(urls, {
    failThreshold: 3,
    cooldownMs: 600_000,
    now: clock.now,
    onAllDown,
    makeDispatcher: () => ({}) as Dispatcher,
  });
  return { pool, clock, onAllDown };
}

describe("ProxyPool", () => {
  it("round-robins and labels without credentials", () => {
    const { pool } = makePool();
    expect([pool.pick(), pool.pick(), pool.pick(), pool.pick()].map((e) => e!.label)).toEqual([
      "10.0.0.1:8000", "10.0.0.2:8000", "10.0.0.3:8000", "10.0.0.1:8000",
    ]);
  });

  it("skips proxies already used in this check, falls back to reuse if needed", () => {
    const { pool } = makePool(URLS.slice(0, 2));
    const used = new Set<string>();
    const a = pool.pick(used)!; used.add(a.url);
    const b = pool.pick(used)!; used.add(b.url);
    expect(b.url).not.toBe(a.url);
    expect(pool.pick(used)).not.toBeNull(); // both used → reuse rather than fail
  });

  it("circuit breaker: 3 consecutive failures disable for 10 min, then it comes back", () => {
    const { pool, clock } = makePool();
    const e = pool.pick()!;
    pool.failure(e); pool.failure(e);
    expect(pool.available()).toHaveLength(3);
    pool.failure(e);
    expect(pool.available().map((x) => x.label)).not.toContain(e.label);
    clock.advance(599_999);
    expect(pool.available()).toHaveLength(2);
    clock.advance(1);
    expect(pool.available()).toHaveLength(3);
  });

  it("a success resets the failure streak", () => {
    const { pool } = makePool();
    const e = pool.pick()!;
    pool.failure(e); pool.failure(e); pool.success(e); pool.failure(e); pool.failure(e);
    expect(pool.available()).toHaveLength(3);
  });

  it("all down → pick() null, onAllDown fires once, re-armed after a success", () => {
    const { pool, clock, onAllDown } = makePool();
    for (const url of URLS) {
      const e = pool.available().find((x) => x.url === url)!;
      for (let i = 0; i < 3; i++) pool.failure(e);
    }
    expect(pool.allDown()).toBe(true);
    expect(pool.pick()).toBeNull();
    expect(onAllDown).toHaveBeenCalledTimes(1);
    expect(pool.msUntilAvailable()).toBe(600_000);

    clock.advance(600_000);
    const e = pool.pick()!;
    pool.success(e);
    for (const x of pool.available()) for (let i = 0; i < 3; i++) pool.failure(x);
    expect(onAllDown).toHaveBeenCalledTimes(2);
  });

  it("empty pool is never 'all down' (direct mode)", () => {
    const { pool } = makePool([]);
    expect(pool.size).toBe(0);
    expect(pool.allDown()).toBe(false);
    expect(pool.pick()).toBeNull();
  });
});

describe("parseProxyList", () => {
  it("keeps valid http(s) proxies, drops comments, blanks and garbage", () => {
    const text = "# my proxies\nhttp://user:pass@1.2.3.4:8080\n\n  https://5.6.7.8:443  \nsocks5://9.9.9.9:1080\nnot a url\r\n";
    expect(parseProxyList(text)).toEqual(["http://user:pass@1.2.3.4:8080", "https://5.6.7.8:443"]);
  });
});
