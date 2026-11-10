# Deploy to Railway

One Railway project, four services: **web** (dashboard), **worker** (queues + Telegram bot), **Postgres**, **Redis**.
The whole project is described as code in [`.railway/railway.ts`](../.railway/railway.ts) (Railway Infrastructure as Code): both app services come from the same repo with their own build and start commands, plus Postgres and Redis. Variables are **unmanaged** by IaC: they live in Railway, so secrets like the bot token are never in the repo and `railway config apply` never touches them.

Change commands in `.railway/railway.ts`, preview with `npx @railway/cli config plan`, apply with `npx @railway/cli config apply`.

| | web | worker |
|---|---|---|
| Build | `npm run build` | `npx prisma generate` |
| Start | `npx prisma migrate deploy && npm run start` | `npm run worker` |
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

## Commands for a new project

For a fresh Railway project, create the services (above) and then run `npx @railway/cli config apply` to set their build/start/healthcheck from `.railway/railway.ts`. The service names must match: `backlink-monitor` (web) and `worker`.

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
