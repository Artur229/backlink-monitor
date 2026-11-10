import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLink } from "../src/lib/check/checkLink";
import { fetchPage, type FetchOptions } from "../src/lib/check/fetch";

let server: Server;
let base: string;

const OPTS: FetchOptions = { timeoutMs: 1000, maxBodyBytes: 64 * 1024, maxRedirects: 5 };

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const p = url.pathname;
    if (p === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<a href="https://my-site.com/">best casino bonuses</a>`);
    }
    if (p.startsWith("/hop/")) {
      const n = Number(p.split("/")[2]);
      res.writeHead(n > 0 ? 301 : 200, n > 0 ? { location: `/hop/${n - 1}` } : { "content-type": "text/html" });
      return res.end(n > 0 ? "" : "<p>landed</p>");
    }
    if (p === "/cp1251") {
      res.writeHead(200, { "content-type": "text/html; charset=windows-1251" });
      // "Привіт" in windows-1251
      return res.end(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]));
    }
    if (p === "/meta-charset") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(Buffer.concat([Buffer.from('<meta charset="windows-1251">'), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2])]));
    }
    if (p === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "x".repeat(16 * 1024);
      for (let i = 0; i < 100; i++) res.write(chunk);
      return res.end();
    }
    if (p === "/pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end("%PDF-1.4");
    }
    if (p === "/slow") {
      setTimeout(() => res.end("late"), 3000);
      return;
    }
    if (p === "/gone") {
      res.writeHead(410, { "content-type": "text/html" });
      return res.end("gone");
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("fetchPage", () => {
  it("returns body, code and final URL", async () => {
    const r = await fetchPage(`${base}/ok`, OPTS);
    expect(r).toMatchObject({ ok: true, httpCode: 200, finalUrl: `${base}/ok`, redirects: [] });
  });

  it("follows up to 5 redirects and records each hop", async () => {
    const r = await fetchPage(`${base}/hop/5`, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.finalUrl).toBe(`${base}/hop/0`);
      expect(r.redirects).toHaveLength(5);
    }
  });

  it("gives up after more than 5 redirects", async () => {
    expect(await fetchPage(`${base}/hop/6`, OPTS)).toMatchObject({ ok: false, kind: "too_many_redirects" });
  });

  it("decodes windows-1251 from header and from <meta charset>", async () => {
    const a = await fetchPage(`${base}/cp1251`, OPTS);
    const b = await fetchPage(`${base}/meta-charset`, OPTS);
    expect(a.ok && a.html).toBe("Привіт");
    expect(b.ok && b.html).toContain("Привіт");
  });

  it("cuts the body at maxBodyBytes", async () => {
    const r = await fetchPage(`${base}/huge`, OPTS);
    expect(r.ok && r.truncated).toBe(true);
    expect(r.ok && r.html.length).toBe(OPTS.maxBodyBytes);
  });

  it("rejects non-HTML content", async () => {
    expect(await fetchPage(`${base}/pdf`, OPTS)).toMatchObject({ ok: false, kind: "not_html" });
  });

  it("times out", async () => {
    const r = await fetchPage(`${base}/slow`, { ...OPTS, timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("classifies DNS failure", async () => {
    const r = await fetchPage("http://does-not-exist.invalid/", OPTS);
    expect(r).toMatchObject({ ok: false, kind: "dns" });
  });

  it("classifies connection refused as network", async () => {
    const r = await fetchPage("http://127.0.0.1:1/", OPTS);
    expect(r).toMatchObject({ ok: false, kind: "network" });
  });
});

describe("checkLink end-to-end against local server", () => {
  const deps = { fetchOptions: OPTS, pool: null, sleep: async () => {} };
  const link = (path: string) => ({ donorUrl: `${base}${path}`, targetUrl: "https://my-site.com", anchor: "Best Casino Bonuses" });

  it("ok", async () => {
    expect(await checkLink(link("/ok"), deps)).toMatchObject({ status: "ok", httpCode: 200 });
  });

  it("page_gone on 410", async () => {
    expect(await checkLink(link("/gone"), deps)).toMatchObject({ status: "page_gone", httpCode: 410 });
  });

  it("network failures become error, never lost", async () => {
    const r = await checkLink(link("/slow"), { ...deps, retries: 0, fetchOptions: { ...OPTS, timeoutMs: 300 } });
    expect(r).toMatchObject({ status: "error", issues: ["timeout: timeout"] });
  });
});
