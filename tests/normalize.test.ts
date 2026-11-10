import { describe, expect, it } from "vitest";
import { normalizeText, normalizeUrl, sameUrl } from "../src/lib/check/normalize";

describe("normalizeUrl", () => {
  it.each([
    ["https://my-site.com/", "http://my-site.com"],
    ["https://my-site.com/", "https://www.my-site.com/"],
    ["https://My-Site.COM/reviews/", "https://my-site.com/reviews"],
    ["https://my-site.com/reviews", "https://my-site.com/reviews?utm_source=x&utm_medium=y"],
    ["https://my-site.com/?a=1&b=2", "https://my-site.com/?b=2&a=1&gclid=abc"],
    ["https://my-site.com/page", "https://my-site.com/page#section"],
    ["https://my-site.com/", "https://my-site.com/index.html"],
    ["https://my-site.com/", "https://my-site.com:443/"],
    ["https://my-site.com/a/b", "https://my-site.com/a//b/"],
  ])("%s ≡ %s", (a, b) => {
    expect(sameUrl(a, b)).toBe(true);
  });

  it.each([
    ["https://my-site.com/reviews", "https://my-site.com/review"],
    ["https://my-site.com/", "https://my-site.com.evil.net/"],
    ["https://my-site.com/", "https://sub.my-site.com/"],
    ["https://my-site.com/?id=1", "https://my-site.com/?id=2"],
    ["https://my-site.com/Page", "https://my-site.com/page"],
    ["https://my-site.com:8080/", "https://my-site.com/"],
  ])("%s ≢ %s", (a, b) => {
    expect(sameUrl(a, b)).toBe(false);
  });

  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("../reviews/", "https://my-site.com/blog/post")).toBe("my-site.com/reviews");
    expect(normalizeUrl("//www.my-site.com", "https://blog.com/x")).toBe("my-site.com");
  });

  it("rejects non-http and garbage", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)", "https://a.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("handles IDN and Cyrillic paths consistently", () => {
    expect(sameUrl("https://приклад.укр/сторінка/", "https://xn--80aikifvh.xn--j1amh/%D1%81%D1%82%D0%BE%D1%80%D1%96%D0%BD%D0%BA%D0%B0")).toBe(true);
  });
});

describe("normalizeText", () => {
  it("ignores case and whitespace incl. nbsp", () => {
    expect(normalizeText("  Best Casino \n  BONUSES ")).toBe("best casino bonuses");
  });
});
