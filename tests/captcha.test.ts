import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePage, type PageResponse } from "../src/lib/check/analyze";

const DONOR = "https://blog-example.com/best-tips";
const LINK = { donorUrl: DONOR, targetUrl: "https://my-site.com/", anchor: "best casino bonuses" };
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8");
const page = (html: string, over: Partial<PageResponse> = {}): PageResponse => ({
  httpCode: 200, finalUrl: DONOR, headers: {}, html, ...over,
});

describe("captcha / challenge → blocked, never lost", () => {
  it("Cloudflare challenge on 403 → blocked with marker", () => {
    expect(analyzePage(page(fixture("captcha-cloudflare"), { httpCode: 403 }), LINK)).toEqual({
      status: "blocked",
      issues: ["HTTP 403", "captcha: cf-chl"],
    });
  });

  it("Cloudflare challenge on 503 → blocked", () => {
    expect(analyzePage(page(fixture("captcha-cloudflare"), { httpCode: 503 }), LINK).status).toBe("blocked");
  });

  it("Cloudflare challenge served with 200 → blocked, not lost", () => {
    const r = analyzePage(page(fixture("captcha-cloudflare")), LINK);
    expect(r.status).toBe("blocked");
    expect(r.issues).toContain("captcha: cf-chl");
  });

  it("cf-mitigated: challenge header → blocked", () => {
    const r = analyzePage(page("<html><body>wait</body></html>", { headers: { "cf-mitigated": "challenge" } }), LINK);
    expect(r).toEqual({ status: "blocked", issues: ["HTTP 200", "captcha: cf-mitigated: challenge"] });
  });

  it("thin page that is just an hCaptcha form → blocked", () => {
    expect(analyzePage(page(fixture("captcha-hcaptcha-wall")), LINK)).toEqual({
      status: "blocked",
      issues: ["HTTP 200", "captcha: hcaptcha"],
    });
  });

  it("real article with a reCAPTCHA contact form and no link → still lost", () => {
    expect(analyzePage(page(fixture("recaptcha-form-lost")), LINK).status).toBe("lost");
  });

  it("captcha widget on a page where the link IS present → ok", () => {
    const html = `${fixture("ok")}<div class="g-recaptcha"></div>`;
    expect(analyzePage(page(html), LINK).status).toBe("ok");
  });

  it("plain 403 without markers → blocked", () => {
    expect(analyzePage(page("Forbidden", { httpCode: 403 }), LINK)).toEqual({ status: "blocked", issues: ["HTTP 403"] });
  });
});
