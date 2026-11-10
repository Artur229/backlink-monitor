# Deploy to Railway

One Railway project, four services: **web** (dashboard), **worker** (queues + Telegram bot), **Postgres**, **Redis**.
Web and worker are the same repo with the same [`railway.json`](../railway.json). The role comes from the service name: a service with "worker" in its name runs the worker, anything else runs the dashboard. Set `SERVICE_ROLE=web|worker` to override.

| | web | worker |
|---|---|---|
| Build | `next build` | `prisma generate` |
| Start | `prisma migrate deploy && next start` | `tsx src/worker/index.ts` |
| Healthcheck `/api/health` | DB ping | Redis ping (small HTTP server on `$PORT`) |
| Public domain | yes | not needed |
| Replicas | 1+ | **exactly 1** (Telegram long polling allows one consumer) |

## With the Railway CLI

```bash
npx @railway/cli login
npx @railway/cli link                         # pick the project
npx @railway/cli add --database postgres
npx @railway/cli add --database redis
npx @railway/cli add --service worker --repo <owner>/backlink-monitor
```

Variables on **both** `web` and `worker` (`npx @railway/cli variables --service <name> --set "KEY=VALUE" ...`):

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
TZ=Europe/Kyiv
DASHBOARD_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
```

`web` only: `DASHBOARD_PASSWORD` (optional). `worker` only: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and optionally `CHECK_CRON`, `DIGEST_CRON` and crawler settings from [.env.example](../.env.example).

Public URL for the dashboard: `npx @railway/cli domain --service web`.

## Or in the Railway UI

1. **New Project → Deploy from GitHub repo** → this repo. Rename the service to `web`.
2. **+ New → Database → PostgreSQL** and **+ New → Database → Redis**.
3. **+ New → GitHub Repo** → the same repo, name it `worker`.
4. Variables as above (Variables → Raw editor). `web` → Settings → Networking → **Generate Domain**.

## First run

1. Both services redeploy after the variables change. Web applies the migrations on start.
   Note: `railway redeploy` without `--from-source` re-runs the *old* build; use `--from-source` to deploy the latest commit.
2. `https://<web-domain>/api/health` → `{"ok":true}`.
3. Import links on **Імпорт CSV**, then run the first check without waiting for the cron: worker service → shell → `npm run run-now`, or press **Перевірити зараз** on a link.
4. Send `/status` to the bot.

Proxies: `proxies.txt` is gitignored. On Railway, either run without it (direct connection) or mount a volume with the file and set `PROXY_LIST` to its path.
