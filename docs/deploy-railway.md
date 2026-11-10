# Deploy to Railway

One Railway project, four services: **web** (dashboard), **worker** (queues + Telegram bot), **Postgres**, **Redis**.
Web and worker are built from the same GitHub repo; each one points at its own config file in `railway/`.

## 1. Project and databases

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → pick this repo. This creates the first service; rename it to `web`.
2. **+ New → Database → PostgreSQL**.
3. **+ New → Database → Redis**.
4. **+ New → GitHub Repo** → the same repo again; rename it to `worker`.

## 2. Service settings

| | web | worker |
|---|---|---|
| Settings → Config-as-code → **Railway Config File** | `/railway/web.json` | `/railway/worker.json` |
| Settings → Networking | **Generate Domain** | — (no public port) |
| Replicas | 1+ | **exactly 1** (Telegram long polling allows a single consumer) |
| Serverless / app sleeping | can be on | **off** (the worker must keep running) |

The config files set the commands:

- **web**: build `npm run build`, pre-deploy `npx prisma migrate deploy`, start `npm run start`, healthcheck `/api/health`.
- **worker**: start `npm run worker`, restart policy `ALWAYS`.

## 3. Variables

Set these on **both** services (Railway → service → Variables → *Raw editor*). The `${{…}}` references are resolved by Railway.

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
TZ=Europe/Kyiv
DASHBOARD_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
```

**web** only:

```env
DASHBOARD_PASSWORD=choose-a-password   # optional; empty = open dashboard
```

**worker** only:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
CHECK_CRON=0 3 * * *
DIGEST_CRON=0 10 * * *
# Crawler tuning (defaults shown in .env.example): CONCURRENCY, PER_DOMAIN_DELAY_MS, TIMEOUT_MS, RETRIES, ...
```

Proxies: the worker reads `PROXY_LIST` (default `proxies.txt`). `proxies.txt` is gitignored, so on Railway either leave it out (direct connection) or mount a volume with the file and point `PROXY_LIST` at it.

## 4. First run

1. Deploy both services. The web pre-deploy step runs the migrations.
2. Open the web domain → **Імпорт CSV** → upload your links (or run `npm run import links.csv` locally with `DATABASE_URL` pointing at Railway's public Postgres URL).
3. Trigger the first check without waiting for the cron: on the worker service, open the shell and run `npm run run-now`. Or press **Перевірити зараз** on individual links.
4. In Telegram, send `/status` to the bot.

## Checks

- `https://<web-domain>/api/health` → `{"ok":true}`
- Worker logs show `worker starting`, `daily checks scheduled`, `digest scheduled`, `bot @… polling`.
- `npm run tg:test` (locally, with the same token/chat id) sends a test message.
