import { ImportForm } from "./import-form";

export default function ImportPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Імпорт CSV</h1>
        <p className="text-sm text-muted-foreground">
          Повторне завантаження оновлює наявні посилання (ключ — пара donor_url + target_url), дублів не буде. Рядки з помилками
          пропускаються й потрапляють у звіт. Нові посилання перевіряються з найближчим щоденним прогоном або кнопкою «Перевірити зараз».
        </p>
      </div>
      <ImportForm />
      <section className="rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-medium">Формат</h2>
        <p className="mt-1 text-muted-foreground">
          Обовʼязкові колонки: <code className="font-mono">donor_url</code>, <code className="font-mono">target_url</code>. Необовʼязкові:{" "}
          <code className="font-mono">anchor</code>, <code className="font-mono">outreacher</code>, <code className="font-mono">price_usd</code>,{" "}
          <code className="font-mono">placed_at</code> (YYYY-MM-DD).
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
{`donor_url,target_url,anchor,outreacher,price_usd,placed_at
https://blog-example.com/best-tips,https://my-site.com/,best casino bonuses,Olha,150,2026-10-01
https://news-example.org/review,https://my-site.com/reviews,mysite,Ivan,90,2026-10-12`}
        </pre>
      </section>
    </div>
  );
}
