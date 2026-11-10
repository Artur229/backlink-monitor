import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLink } from "../src/lib/check/checkLink";
import { ProxyPool } from "../src/lib/proxy/pool";

/** Real undici ProxyAgent against a tiny forwarding proxy that requires Basic auth. */
let donor: Server;
let proxy: Server;
let donorUrl: string;
let proxyPort: number;
const seenByProxy: string[] = [];

beforeAll(async () => {
  donor = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<a href="https://my-site.com/">best casino bonuses</a>`);
  });
  proxy = createServer((req, res) => {
    const expected = `Basic ${Buffer.from("olha:s3cret").toString("base64")}`;
    if (req.headers["proxy-authorization"] !== expected) {
      res.writeHead(407, { "proxy-authenticate": "Basic" }).end();
      return;
    }
    seenByProxy.push(req.url!); // absolute-form target for plain-HTTP requests
    const upstream = httpRequest(req.url!, { method: req.method, headers: { ...req.headers, "proxy-authorization": "" } }, (up) => {
      res.writeHead(up.statusCode!, up.headers);
      up.pipe(res);
    });
    req.pipe(upstream);
  });
  await Promise.all([
    new Promise<void>((r) => donor.listen(0, "127.0.0.1", r)),
    new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r)),
  ]);
  donorUrl = `http://127.0.0.1:${(donor.address() as AddressInfo).port}/post`;
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(() => {
  for (const s of [donor, proxy]) { s.closeAllConnections(); s.close(); }
});

const LINK = () => ({ donorUrl, targetUrl: "https://my-site.com", anchor: "Best casino bonuses" });
const opts = { failThreshold: 3, cooldownMs: 600_000 };
const deps = (pool: ProxyPool) => ({ pool, sleep: async () => {}, fetchOptions: { timeoutMs: 2000 } });

describe("real proxy", () => {
  it("routes the request through the proxy with credentials from the URL", async () => {
    const pool = new ProxyPool([`http://olha:s3cret@127.0.0.1:${proxyPort}`], opts);
    const r = await checkLink(LINK(), deps(pool));
    expect(r).toMatchObject({ status: "ok", httpCode: 200, proxy: `127.0.0.1:${proxyPort}`, attempts: 1 });
    expect(seenByProxy).toContain(donorUrl);
  });

  it("bad credentials → 407 → proxy failure, retried, then error (never lost)", async () => {
    const pool = new ProxyPool([`http://olha:wrong@127.0.0.1:${proxyPort}`], opts);
    const r = await checkLink(LINK(), { ...deps(pool), retries: 2 });
    expect(r.status).toBe("error");
    expect(r.issues[0]).toMatch(/proxy/);
    expect(pool.available()).toHaveLength(0); // 3 consecutive failures → disabled
    expect(JSON.stringify(r)).not.toContain("wrong");
  });

  it("dead proxy (connection refused) → retries via the next proxy", async () => {
    const pool = new ProxyPool(["http://127.0.0.1:1", `http://olha:s3cret@127.0.0.1:${proxyPort}`], opts);
    const r = await checkLink(LINK(), deps(pool));
    expect(r).toMatchObject({ status: "ok", attempts: 2, proxy: `127.0.0.1:${proxyPort}` });
  });
});
