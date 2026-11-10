import { describe, expect, it } from "vitest";
import { summarize } from "../src/lib/monitor/stats";
import { esc, formatDigest, formatStatusAlert, formatSummary, shortUrl } from "../src/lib/telegram/format";

const LINK = {
  id: "abc123",
  donorUrl: "https://blog-example.com/best-tips",
  targetUrl: "https://my-site.com/",
  outreacher: "Olha",
  priceUsd: 150,
};
const DASH = "https://bm.example.app";

describe("formatStatusAlert", () => {
  it("matches the spec example for a lost link", () => {
    const html = formatStatusAlert({ from: "ok", to: "lost", kind: "problem" }, LINK, ["link not found"], DASH);
    expect(html).toBe(
      [
        "<b>❗ Посилання зникло</b>: blog-example.com/best-tips → my-site.com",
        "Аутричер: Olha. Заплачено: $150.",
        "Деталі: <code>link not found</code>",
        "Було: ok → стало: зникло",
        '<a href="https://bm.example.app/links/abc123">Картка в дашборді</a>',
      ].join("\n"),
    );
  });

  it("first check of a new link has no 'Було' line; attempts noise is hidden", () => {
    const html = formatStatusAlert({ from: "pending", to: "nofollow", kind: "problem" }, LINK, ["rel=nofollow", "after 2 attempts"], DASH);
    expect(html).toContain("⚠️ Посилання стало nofollow");
    expect(html).toContain("<code>rel=nofollow</code>");
    expect(html).not.toContain("Було");
    expect(html).not.toContain("attempts");
  });

  it("recovered alert has no details", () => {
    const html = formatStatusAlert({ from: "lost", to: "ok", kind: "recovered" }, LINK, [], DASH);
    expect(html).toMatch(/^<b>✅ Посилання знову працює<\/b>/);
    expect(html).toContain("Було: зникло → стало: ok");
  });

  it("works without outreacher/price and escapes HTML from page data", () => {
    const html = formatStatusAlert(
      { from: "ok", to: "anchor_changed", kind: "low" },
      { ...LINK, outreacher: null, priceUsd: null },
      ["anchor: '<script>' != 'a & b'"],
      DASH,
    );
    expect(html).not.toContain("Аутричер");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<script>");
  });
});

describe("summary & digest", () => {
  const stats = summarize([
    { status: "ok", count: 7, priceUsd: 900 },
    { status: "lost", count: 1, priceUsd: 150 },
    { status: "nofollow", count: 1, priceUsd: 200 },
    { status: "anchor_changed", count: 1, priceUsd: 60 },
    { status: "blocked", count: 2, priceUsd: 70 },
    { status: "pending", count: 1, priceUsd: 0 },
  ]);

  it("counts problems, unreachable and $ at risk (anchor_changed is not at risk)", () => {
    expect(stats).toMatchObject({ total: 13, ok: 7, problems: 3, unreachable: 2, pending: 1, atRiskUsd: 350 });
  });

  it("summary text", () => {
    expect(formatSummary(stats)).toBe(
      "Усього посилань: <b>13</b>\n✅ ok: 7   ❗ проблемних: 3   🚫 blocked/error: 2   ⏳ очікує: 1\n💰 Під ризиком: <b>$350</b>",
    );
  });

  it("digest lists problems and unreachable, truncates long lists", () => {
    const problems = Array.from({ length: 12 }, (_, i) => ({
      donorUrl: `https://d${i}.com/p`, status: "lost" as const, outreacher: "Ivan", priceUsd: 100 - i,
    }));
    const text = formatDigest("10.11.2026", stats, problems, [{ donorUrl: "https://cf.com/x", status: "blocked", outreacher: null, priceUsd: null }], DASH);
    expect(text).toContain("<b>📊 Дайджест за 10.11.2026</b>");
    expect(text).toContain("• d0.com/p — зникло, $100 (Ivan)");
    expect(text).toContain("…і ще 2");
    expect(text).toContain("<b>Не вдалося перевірити:</b>\n• cf.com/x — blocked");
  });

  it("all good digest", () => {
    const text = formatDigest("10.11.2026", summarize([{ status: "ok", count: 3, priceUsd: 10 }]), [], [], DASH);
    expect(text).toContain("Усі посилання на місці 👌");
  });
});

describe("helpers", () => {
  it("shortUrl / esc", () => {
    expect(shortUrl("https://www.blog-example.com/best-tips/")).toBe("blog-example.com/best-tips");
    expect(esc(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
