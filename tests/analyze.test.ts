import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePage, parseXRobotsTag, type PageResponse } from "../src/lib/check/analyze";

const DONOR = "https://blog-example.com/best-tips";
const LINK = { donorUrl: DONOR, targetUrl: "https://my-site.com/", anchor: "best casino bonuses" };

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8");
const page = (html: string, over: Partial<PageResponse> = {}): PageResponse => ({
  httpCode: 200,
  finalUrl: DONOR,
  headers: { "content-type": "text/html" },
  html,
  ...over,
});
const analyze = (name: string, over: Partial<PageResponse> = {}, link = LINK) =>
  analyzePage(page(fixture(name), over), link);

describe("analyzePage — statuses from fixtures", () => {
  it("ok: link present, dofollow, anchor matches ignoring case/whitespace", () => {
    expect(analyze("ok")).toEqual({ status: "ok", issues: [] });
  });

  it("ok: http/www/utm/fragment variants of the target still count", () => {
    expect(analyze("ok-url-variants").status).toBe("ok");
  });

  it("ok: relative href resolved via <base href>", () => {
    expect(analyze("ok-base-href").status).toBe("ok");
  });

  it("ok: with several links to target the best (dofollow) one wins", () => {
    expect(analyze("ok-best-of-many")).toEqual({ status: "ok", issues: [] });
  });

  it("ok: image link matches anchor by alt text", () => {
    expect(analyze("image-link").status).toBe("ok");
  });

  it("ok: anchor is not checked when none expected", () => {
    expect(analyze("anchor-changed", {}, { ...LINK, anchor: null }).status).toBe("ok");
  });

  it("lost: no link to target (look-alike domain and other page don't count)", () => {
    expect(analyze("lost")).toEqual({ status: "lost", issues: ["link not found"] });
  });

  it("nofollow: rel=nofollow on the link", () => {
    expect(analyze("nofollow-rel")).toEqual({ status: "nofollow", issues: ["rel=nofollow"] });
  });

  it("nofollow: rel sponsored / ugc (case-insensitive)", () => {
    expect(analyze("sponsored-ugc")).toEqual({ status: "nofollow", issues: ["rel=sponsored", "rel=ugc"] });
  });

  it("nofollow: page-level meta robots nofollow (amendment 4)", () => {
    expect(analyze("page-nofollow")).toEqual({ status: "nofollow", issues: ["page nofollow"] });
  });

  it("nofollow: page-level X-Robots-Tag nofollow", () => {
    const r = analyze("ok", { headers: { "x-robots-tag": "nofollow" } });
    expect(r).toEqual({ status: "nofollow", issues: ["page nofollow"] });
  });

  it("noindex: meta robots noindex", () => {
    expect(analyze("noindex-meta")).toEqual({ status: "noindex", issues: ["page noindex"] });
  });

  it("noindex: X-Robots-Tag noindex for googlebot", () => {
    expect(analyze("ok", { headers: { "x-robots-tag": "googlebot: noindex" } }).status).toBe("noindex");
  });

  it("ok: X-Robots-Tag noindex aimed at another bot is ignored", () => {
    expect(analyze("ok", { headers: { "x-robots-tag": "bingbot: noindex" } }).status).toBe("ok");
  });

  it("noindex: canonical points to another page", () => {
    expect(analyze("canonical-other")).toEqual({ status: "noindex", issues: ["canonical → https://blog-example.com/"] });
  });

  it("noindex: canonical via HTTP Link header", () => {
    const r = analyze("ok", { headers: { link: '<https://blog-example.com/other>; rel="canonical"' } });
    expect(r.status).toBe("noindex");
  });

  it("ok: canonical to itself in another URL form is fine", () => {
    expect(analyze("canonical-self").status).toBe("ok");
  });

  it("anchor_changed: link alive, different text", () => {
    expect(analyze("anchor-changed")).toEqual({
      status: "anchor_changed",
      issues: ["anchor: 'click here' != 'best casino bonuses'"],
    });
  });

  it("priority: lost beats noindex, but both issues are kept", () => {
    const r = analyze("lost-and-noindex");
    expect(r.status).toBe("lost");
    expect(r.issues).toEqual(["page noindex", "link not found"]);
  });

  it("priority: nofollow beats anchor_changed", () => {
    const html = `<a href="https://my-site.com/" rel="nofollow">other text</a>`;
    expect(analyzePage(page(html), LINK)).toEqual({
      status: "nofollow",
      issues: ["rel=nofollow", "anchor: 'other text' != 'best casino bonuses'"],
    });
  });

  it("redirect to another page is reported but does not change status by itself", () => {
    const r = analyze("ok", { finalUrl: "https://blog-example.com/best-tips-2026" });
    expect(r).toEqual({ status: "ok", issues: ["redirected → https://blog-example.com/best-tips-2026"] });
  });

  it("truncated page without the link → error, not a false lost", () => {
    expect(analyze("lost", { truncated: true }).status).toBe("error");
  });
});

describe("analyzePage — HTTP codes", () => {
  it.each([
    [404, "page_gone"],
    [410, "page_gone"],
    [403, "blocked"],
    [429, "blocked"],
    [503, "blocked"],
    [401, "blocked"],
    [500, "error"],
    [502, "error"],
    [400, "error"],
  ] as const)("HTTP %i → %s", (httpCode, status) => {
    expect(analyzePage(page("<html></html>", { httpCode }), LINK)).toEqual({ status, issues: [`HTTP ${httpCode}`] });
  });
});

describe("parseXRobotsTag", () => {
  it("handles scopes, valued directives and arrays", () => {
    expect(parseXRobotsTag("noindex, nofollow")).toEqual(["noindex", "nofollow"]);
    expect(parseXRobotsTag("max-snippet: 20, noindex")).toEqual(["max-snippet: 20", "noindex"]);
    expect(parseXRobotsTag("bingbot: noindex, googlebot: nofollow")).toEqual(["nofollow"]);
    expect(parseXRobotsTag(["noindex", "otherbot: nofollow"])).toEqual(["noindex"]);
    expect(parseXRobotsTag(undefined)).toEqual([]);
  });
});
