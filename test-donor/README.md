# Test donor page (done criterion #2)

A static page with one backlink, used for the end-to-end check "remove the link → a Telegram alert arrives".

1. Deploy it: `vercel deploy test-donor --prod --yes --scope artur229s-projects`. Public URL: **https://test-donor.vercel.app** (the per-deployment `*-artur229s-projects.vercel.app` URLs are behind Vercel login, so monitor the short alias).
2. Import [examples/demo-vercel.csv](../examples/demo-vercel.csv) on the dashboard's **Імпорт CSV** page (already imported in production).
3. Press **Перевірити зараз** → status `ok`.
4. Delete the `<a href="https://example.com/">` line in `index.html` and redeploy.
5. Press **Перевірити зараз** again: the first `lost` is silent and a re-check is queued. After `CONFIRM_DELAY_MS` (1 h; set `CONFIRM_DELAY_MS=60000` on the worker for a demo) the alert "❗ Посилання зникло" arrives in Telegram.
6. Restore the line and redeploy → "✅ Посилання знову працює".
