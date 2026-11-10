# Test donor page (done criterion #2)

A static page with one backlink, used for the end-to-end check "remove the link → a Telegram alert arrives".

1. Deploy it: `vercel deploy test-donor --prod` (Vercel login required). Note the URL, e.g. `https://bm-test-donor.vercel.app`.
2. Import it as a link:
   ```csv
   donor_url,target_url,anchor,outreacher,price_usd,placed_at
   https://bm-test-donor.vercel.app/,https://example.com/,best example site,Olha,150,2026-11-10
   ```
3. Press **Перевірити зараз** → status `ok`.
4. Delete the `<a href="https://example.com/">` line in `index.html` and redeploy.
5. Press **Перевірити зараз** again: the first `lost` is silent and a re-check is queued. After `CONFIRM_DELAY_MS` (1 h; set `CONFIRM_DELAY_MS=60000` on the worker for a demo) the alert "❗ Посилання зникло" arrives in Telegram.
6. Restore the line and redeploy → "✅ Посилання знову працює".
