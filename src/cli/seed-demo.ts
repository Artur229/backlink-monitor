import { prisma } from "../lib/db";
import type { CheckStatus } from "../lib/check/status";

/**
 * Demo data for screenshots / GIF: npm run seed:demo
 * Fictional *.example.com donors with 14 days of history. Deletes ALL links first.
 */
const DAY = 86_400_000;
const now = Date.now();
const rnd = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();

type Spec = { donor: string; target: string; anchor: string | null; who: string | null; price: number | null; history: CheckStatus[] };

const ok14 = Array<CheckStatus>(14).fill("ok");
const turns = (from: CheckStatus, to: CheckStatus, at: number): CheckStatus[] => [...Array<CheckStatus>(at).fill(from), ...Array<CheckStatus>(14 - at).fill(to)];

const SPECS: Spec[] = [
  { donor: "https://casino-guide.example.com/best-bonuses-2026", target: "https://my-site.com/", anchor: "best casino bonuses", who: "Olha", price: 450, history: turns("ok", "lost", 11) },
  { donor: "https://www.slots-weekly.example.com/reviews/top-10", target: "https://my-site.com/reviews", anchor: "honest reviews", who: "Ivan", price: 320, history: ok14 },
  { donor: "https://betting-news.example.com/2026/10/odds-explained", target: "https://my-site.com/odds", anchor: "odds calculator", who: "Olha", price: 280, history: turns("ok", "nofollow", 9) },
  { donor: "https://sportsfan.example.com/blog/how-to-bet", target: "https://my-site.com/", anchor: "my-site", who: "Maksym", price: 250, history: ok14 },
  { donor: "https://pokerpro.example.com/strategy/bankroll", target: "https://my-site.com/poker", anchor: "poker rooms", who: "Ivan", price: 220, history: turns("ok", "page_gone", 12) },
  { donor: "https://finance-daily.example.com/side-income", target: "https://my-site.com/", anchor: "online casinos", who: "Olha", price: 200, history: ok14 },
  { donor: "https://gamblers-digest.example.com/news/regulation", target: "https://my-site.com/legal", anchor: "legal casinos", who: "Maksym", price: 190, history: [...Array<CheckStatus>(6).fill("ok"), "blocked", "blocked", "ok", "ok", "ok", "ok", "ok", "ok"] },
  { donor: "https://tech-review.example.com/apps/casino-apps", target: "https://my-site.com/apps", anchor: "casino apps", who: "Ivan", price: 180, history: turns("ok", "noindex", 10) },
  { donor: "https://lifestyle-mag.example.com/weekend-fun", target: "https://my-site.com/", anchor: "best casino bonuses", who: "Olha", price: 150, history: turns("ok", "anchor_changed", 8) },
  { donor: "https://cf-protected.example.com/guide", target: "https://my-site.com/", anchor: "my-site", who: "Maksym", price: 140, history: turns("ok", "blocked", 9) },
  { donor: "https://esports-hub.example.com/betting-on-cs", target: "https://my-site.com/esports", anchor: "esports betting", who: "Ivan", price: 130, history: ok14 },
  { donor: "https://travel-notes.example.com/vegas-trip", target: "https://my-site.com/", anchor: "my site", who: "Olha", price: 120, history: [...turns("ok", "lost", 5).slice(0, 7), ...Array<CheckStatus>(7).fill("ok")] },
  { donor: "https://crypto-corner.example.com/btc-casinos", target: "https://my-site.com/crypto", anchor: "bitcoin casinos", who: "Maksym", price: 110, history: ok14 },
  { donor: "https://forum.example.com/threads/best-slots", target: "https://my-site.com/slots", anchor: "slots", who: "Ivan", price: 90, history: turns("ok", "nofollow", 3) },
  { donor: "https://local-news.example.com/business/igaming", target: "https://my-site.com/", anchor: null, who: "Olha", price: 85, history: ok14 },
  { donor: "https://dead-host.example.com/article", target: "https://my-site.com/", anchor: "my-site", who: "Maksym", price: 80, history: turns("ok", "error", 12) },
  { donor: "https://sports-stats.example.com/football/tips", target: "https://my-site.com/football", anchor: "football tips", who: "Ivan", price: 75, history: ok14 },
  { donor: "https://blog.example.com/top-sites", target: "https://my-site.com/", anchor: "top casino", who: "Olha", price: 70, history: ok14 },
  { donor: "https://reviews-hub.example.com/casinos/my-site", target: "https://my-site.com/", anchor: "my-site review", who: "Maksym", price: 65, history: ok14 },
  { donor: "https://guest-posts.example.com/gambling-trends", target: "https://my-site.com/trends", anchor: "gambling trends", who: "Ivan", price: 60, history: turns("ok", "lost", 13) },
  { donor: "https://money-tips.example.com/fun-budget", target: "https://my-site.com/", anchor: "budget casinos", who: null, price: 50, history: ok14 },
  { donor: "https://news-example.example.com/review", target: "https://my-site.com/reviews", anchor: "mysite", who: "Ivan", price: 90, history: ok14 },
  { donor: "https://new-partner.example.com/welcome", target: "https://my-site.com/", anchor: "my-site", who: "Olha", price: 100, history: [] },
  { donor: "https://new-partner.example.com/second", target: "https://my-site.com/promo", anchor: "promo codes", who: "Olha", price: 100, history: [] },
];

const ISSUES: Record<CheckStatus, string[]> = {
  ok: [],
  lost: ["link not found"],
  page_gone: ["HTTP 404"],
  nofollow: ["rel=nofollow"],
  noindex: ["page noindex"],
  anchor_changed: ["anchor: 'click here' != 'best casino bonuses'"],
  blocked: ["HTTP 403", "captcha: challenge-platform", "after 4 attempts"],
  error: ["timeout: timeout", "after 4 attempts"],
};
const HTTP: Record<CheckStatus, number | null> = { ok: 200, lost: 200, page_gone: 404, nofollow: 200, noindex: 200, anchor_changed: 200, blocked: 403, error: null };
const PROXIES = ["185.12.40.7:8000", "91.204.15.33:3128", "45.83.91.120:8080", null];
const INCONCLUSIVE = new Set<CheckStatus>(["blocked", "error"]);

await prisma.check.deleteMany();
await prisma.link.deleteMany();

for (const s of SPECS) {
  // A day's single check + a 1h confirm for confirmed lost/page_gone, like the real worker.
  const checks: { checkedAt: Date; status: CheckStatus }[] = [];
  s.history.forEach((st, i) => {
    const day = now - (s.history.length - 1 - i) * DAY - 7 * 3_600_000 + Math.round(rnd() * 600_000);
    checks.push({ checkedAt: new Date(day), status: st });
    if ((st === "lost" || st === "page_gone") && s.history[i - 1] !== st) checks.push({ checkedAt: new Date(day + 3_600_000), status: st });
  });
  const last = s.history.at(-1);
  const lastConclusive = [...s.history].reverse().find((h) => !INCONCLUSIVE.has(h)) ?? null;
  const changeIdx = s.history.findLastIndex((h, i) => i > 0 && h !== s.history[i - 1]);
  await prisma.link.create({
    data: {
      donorUrl: s.donor,
      targetUrl: s.target,
      anchor: s.anchor,
      outreacher: s.who,
      priceUsd: s.price,
      placedAt: new Date(now - 30 * DAY - Math.round(rnd() * 40) * DAY),
      status: last ?? "pending",
      lastConclusiveStatus: lastConclusive,
      lastCheckedAt: checks.at(-1)?.checkedAt ?? null,
      statusChangedAt: changeIdx > 0 ? checks.find((c) => c.status === s.history[changeIdx])?.checkedAt ?? null : null,
      checks: {
        create: checks.map((c) => ({
          checkedAt: c.checkedAt,
          status: c.status,
          httpCode: HTTP[c.status],
          issues: ISSUES[c.status],
          proxy: PROXIES[Math.floor(rnd() * PROXIES.length)],
          durationMs: c.status === "error" ? 15000 : 180 + Math.round(rnd() * 900),
          finalUrl: s.donor,
        })),
      },
    },
  });
}
console.log(`✔ seeded ${SPECS.length} demo links`);
await prisma.$disconnect();
