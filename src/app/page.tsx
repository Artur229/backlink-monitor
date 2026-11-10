import Link from "next/link";
import { Suspense } from "react";
import { CheckNowButton } from "@/components/check-now-button";
import { Filters } from "@/components/filters";
import { fmtAgo, shortUrl, usd } from "@/components/format";
import { StatusBadge } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listLinks, listOutreachers, parseFilters } from "@/lib/dashboard/queries";
import { getStats } from "@/lib/monitor/stats";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await props.searchParams);
  const [stats, { rows, total }, outreachers] = await Promise.all([getStats(), listLinks(filters), listOutreachers()]);

  const tiles = [
    { label: "Усього посилань", value: stats.total, href: "/" },
    { label: "Працюють", value: stats.ok, href: "/?status=ok", tone: "text-ok" },
    { label: "Проблемні", value: stats.problems, href: "/?status=problems", tone: stats.problems ? "text-bad" : undefined },
    { label: "Blocked / error", value: stats.unreachable, href: "/?status=unreachable", hint: "не вдалося перевірити — не вважається зникненням" },
  ];

  return (
    <div className="space-y-6">
      <section aria-label="Підсумки" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} title={t.hint} className="rounded-xl border bg-card p-4 transition-colors hover:border-ring/60">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", t.tone)}>{t.value}</div>
          </Link>
        ))}
        <Link
          href="/?status=problems"
          className="col-span-2 rounded-xl border border-bad/30 bg-bad/6 p-4 transition-colors hover:border-bad/60 lg:col-span-1"
          title="Сума цін посилань зі статусом зникло / сторінку видалено / nofollow / noindex"
        >
          <div className="text-xs text-muted-foreground">$ під ризиком</div>
          <div className={cn("mt-1 text-2xl font-semibold tabular-nums", stats.atRiskUsd ? "text-bad" : "")}>{usd(stats.atRiskUsd)}</div>
        </Link>
      </section>

      <section aria-label="Посилання" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Suspense fallback={<div className="h-8" />}>
            <Filters outreachers={outreachers} />
          </Suspense>
          <div className="text-sm text-muted-foreground tabular-nums">
            {total === stats.total ? `${total} посилань` : `${total} з ${stats.total}`}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          {rows.length === 0 ? (
            <EmptyState hasLinks={stats.total > 0} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Донор → ціль</TableHead>
                  <TableHead className="hidden md:table-cell">Анкор</TableHead>
                  <TableHead className="hidden sm:table-cell">Аутричер</TableHead>
                  <TableHead className="text-right">Ціна</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="hidden lg:table-cell">Перевірено</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Дії</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-[22rem] pl-4">
                      <Link href={`/links/${l.id}`} className="block truncate font-medium hover:underline" title={l.donorUrl}>
                        {shortUrl(l.donorUrl)}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground" title={l.targetUrl}>→ {shortUrl(l.targetUrl)}</div>
                    </TableCell>
                    <TableCell className="hidden max-w-[12rem] truncate text-muted-foreground md:table-cell" title={l.anchor ?? undefined}>
                      {l.anchor ?? "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{l.outreacher ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(l.priceUsd)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={l.status} />
                        {l.failStreak > 0 && (
                          <span className="text-[11px] text-warn" title="Перша перевірка показала проблему; алерт буде після повторної">
                            перевіряється повторно
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell" title={l.lastCheckedAt?.toISOString()}>
                      {fmtAgo(l.lastCheckedAt)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <CheckNowButton linkId={l.id} compact />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyState({ hasLinks }: { hasLinks: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="font-medium">{hasLinks ? "Нічого не знайдено за цими фільтрами" : "Посилань ще немає"}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasLinks ? (
          <Link href="/" className="underline">Скинути фільтри</Link>
        ) : (
          <>Завантажте CSV на сторінці <Link href="/import" className="underline">Імпорт</Link> або командою <code className="font-mono">npm run import links.csv</code></>
        )}
      </p>
    </div>
  );
}
