# Backlink Monitor

Daily checker for purchased backlinks. Alerts in Telegram when a link disappears or stops passing SEO value.
Portfolio project for an SEO-tools role (link building + outreach CRM). Full spec: `docs/spec.pdf` (Ukrainian).
This file is the source of truth: where it differs from the PDF, the **Spec amendments** below win.

**Users:** SEO lead (overall picture, $ at risk), outreacher (signal to contact the donor).
**Out of MVP scope:** Google index check (needs paid SERP API), auth (optional single password via env), multi-tenancy.

## Stack

TypeScript, Node 22+ · undici (ProxyAgent) + cheerio · BullMQ + Redis · PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`, URL in `prisma.config.ts`, client generated to `src/generated/prisma`) · Zod · Next.js + Tailwind + shadcn/ui · grammY · Vitest (HTML fixture per status) · docker-compose for local Postgres (port 5434) + Redis (port 6380).

One repo, two processes: **web** (dashboard + API) and **worker** (queues + bot). They talk only via Postgres and Redis.

Flow: scheduler (daily cron) or dashboard button → check queue → worker `checkLink()` → writes `Check` + updates `Link` → only on confirmed status change → alert queue (with retries) → Telegram.

## Input: CSV import

Dashboard upload or `npm run import links.csv`. Idempotent: key = `donor_url + target_url`, re-import updates the row.
Columns: `donor_url`*, `target_url`*, `anchor`, `outreacher`, `price_usd`, `placed_at` (YYYY-MM-DD).
Invalid rows never fail the import — they go to an error report with the row number. Validation via Zod.

## Checks

One HTTP GET of the donor page + cheerio. Every link checked once per 24h and on demand ("Check now", `/check <url>`).

1. HTTP code and final URL after redirects (max 5).
2. `<a href>` pointing to target_url. Normalize URLs: ignore http/https, `www.`, trailing slash, `utm_*` params.
3. Link `rel`: nofollow, sponsored, ugc.
4. Anchor matches expected (case- and whitespace-insensitive).
5. `<meta name="robots">` and `X-Robots-Tag` header: noindex, nofollow.
6. `<link rel="canonical">` pointing to a different page.

Result = one status (priority top → bottom) + `issues[]` with details:

| Status | When | Alert |
|---|---|---|
| `blocked` | 403/429/503 after all retries, or captcha / Cloudflare challenge | no, digest only |
| `error` | timeout, DNS, TLS, network after all retries | no, digest only |
| `page_gone` | 404 / 410 | yes |
| `lost` | 200 but no link to target | yes |
| `nofollow` | link has rel nofollow/sponsored/ugc, **or page-level nofollow** (meta robots / X-Robots-Tag) | yes |
| `noindex` | page noindex or canonical to another URL | yes |
| `anchor_changed` | link alive, anchor differs | yes, low priority |
| `ok` | all good | no |

**Core rules:**
- `blocked` and `error` are never treated as a lost link.
- Alert only on status CHANGE (ok → lost), never daily repeats.
- `lost` / `page_gone` alert only after 2 consecutive results, the second re-check scheduled 1h later (`failStreak`).

## Crawler

All numbers in `.env` (see `.env.example`): CONCURRENCY 10, PER_DOMAIN_DELAY 5s, TIMEOUT 15s, RETRIES 3 (2s → 8s → 30s + jitter), PROXY_LIST `proxies.txt` (`http://user:pass@host:port`), MAX_BODY 5 MB + Content-Type must be HTML.

- **Retries** only for what can heal: timeout, network error, 429, 5xx. Never 404. Respect `Retry-After`.
- **Proxies:** each retry goes through a different proxy. 3 consecutive failures → proxy disabled for 10 min (circuit breaker). All proxies dead → pause queue + one system Telegram alert. No proxy list → direct connection.
- **Headers:** realistic User-Agent from a small pool + Accept-Language.
- **Captcha:** detect, don't solve. 403/503 + HTML markers (`cf-chl`, `challenge-platform`, `g-recaptcha`, `hcaptcha`, "Just a moment") → `blocked`. Post-MVP: Playwright fallback for JS-rendered links.

## Notifications & dashboard

Telegram bot (grammY):
- Instant alert on status change: `❗ Посилання зникло: blog-example.com/best-tips → my-site.com. Аутричер: Olha. Заплачено: $150` + link to the dashboard card.
- Daily digest at 10:00 (timezone from `TZ`): counts of ok / problems / blocked, $ at risk.
- Commands: `/status` (short summary), `/check <url>` (check one link now).

Dashboard (Next.js, no auth or one password from env):
- Top stats: total, ok, problems, blocked, **$ at risk**.
- Links table: filter by status and outreacher, sort by price, "Check now" button.
- Link card: check history (date, HTTP code, status, response time, proxy).
- Outreacher report: link count, % alive, $ lost.
- CSV import page with error report.

## Spec amendments (override the PDF)

1. **Per-domain limit:** open-source BullMQ has no group rate limit (Pro only). Own limiter: Redis key per domain via `SET NX PX 5000`. If the slot is taken, the job is moved back with a delay (`moveToDelayed` + `DelayedError`), never waits inside the worker.
2. **Job dedup:** `jobId = ${linkId}_${date}` (colons are not allowed in custom ids). Keep completed jobs for a day: `removeOnComplete: { age: 86400 }`, otherwise dedup is lost.
3. **Retries live inside `checkLink()`**, not BullMQ `attempts`. Each attempt uses a different proxy and honours `Retry-After`.
4. **Page-level nofollow** (meta robots / X-Robots-Tag) → status `nofollow`.
5. **Digest at 10:00** in the timezone from `.env` (`TZ=Europe/Kyiv`).
6. **Deploy: Railway only** (web + worker + Postgres + Redis in one project). Free Render has no background workers.
7. **Needed from the owner:** Telegram bot token + chat_id, a test page on Vercel (for "remove link → alert arrives"), optional `proxies.txt`.

## Failure modes (goes into README as is)

| What breaks | Without protection | How handled |
|---|---|---|
| Donor returns captcha or 403 | False "link lost" alert | Status `blocked`, no alert |
| Donor down for an hour | Alert and team panic | Retries + alert only after 2 consecutive checks |
| Proxy dies | All checks fail | Circuit breaker, different proxy per retry |
| All proxies dead | Hundreds of `error` per minute | Queue pause + one system alert |
| 20 links on one domain | Donor bans our IP | Per-domain limit (Redis `SET NX PX` slot + delayed job) |
| Link rendered by JS | `lost` although it exists | Known limitation; plan: Playwright fallback |
| URL formats differ (www, slash, utm) | `lost` although it exists | URL normalization + unit tests |
| Worker crashes mid-run | Some links unchecked | Jobs persist in Redis (AOF), worker resumes after restart |
| Cron fires twice | Duplicate jobs and alerts | `jobId = ${linkId}_${date}`, completed jobs kept 24h |
| Telegram API down | Alert lost | Alerts are a separate queue with retries |
| 50 MB page or not HTML | Worker eats memory | 5 MB limit + Content-Type check |

## Plan (one commit per step)

- [x] 1. Repo, CLAUDE.md, docker-compose (Postgres + Redis), Prisma schema
- [x] 2. CSV import with Zod validation
- [ ] 3. `checkLink()`: fetch + cheerio + URL normalization + status, unit tests on HTML fixtures
- [ ] 4. Retries, proxy pool, captcha detection
- [ ] 5. BullMQ: check queue, per-domain limit, daily schedule
- [ ] 6. Telegram: alerts on status change + digest
- [ ] 7. Dashboard: stats, table, link card
- [ ] 8. README + demo GIF + Railway deploy

**Done when:** CSV with 10 links → all 10 checked with a status · removing the link on the Vercel test page → Telegram alert · captcha page shows `blocked`, not `lost` · worker crash mid-run loses no checks · `npm test` green, dashboard on a public URL.

**README must have:** problem in one paragraph, GIF, architecture diagram, status table, failure modes table, run in 3 commands, "How I built it with Claude Code" section.

## Conventions

- Commands: `npm run db:up` (docker), `npm run db:migrate`, `npm run typecheck`, `npm test`.
- Status priority and alert rules live in one pure module, covered by tests — no network in unit tests (HTML fixtures in `tests/fixtures/`).
- Never commit `.env` or `proxies.txt`.
- Commit messages in English, one commit per plan step.
