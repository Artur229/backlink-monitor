import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { CheckNowButton } from "@/components/check-now-button";
import { fmtAgo, fmtDate, fmtDateTime, shortUrl, usd } from "@/components/format";
import { StatusBadge, statusHint } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLinkWithHistory } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function LinkCard(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const link = await getLinkWithHistory(id);
  if (!link) notFound();

  const facts: [string, React.ReactNode][] = [
    ["Очікуваний анкор", link.anchor ?? <span className="text-muted-foreground">не задано</span>],
    ["Аутричер", link.outreacher ?? "—"],
    ["Ціна", usd(link.priceUsd)],
    ["Розміщено", fmtDate(link.placedAt)],
    ["Остання перевірка", <span key="c" title={fmtDateTime(link.lastCheckedAt)}>{fmtAgo(link.lastCheckedAt)}</span>],
    ["Статус змінився", fmtDateTime(link.statusChangedAt)],
  ];

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Усі посилання
      </Link>

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <a href={link.donorUrl} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
                {shortUrl(link.donorUrl)}
              </a>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </h1>
            <p className="truncate text-sm text-muted-foreground">→ {link.targetUrl}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="sm:text-right">
              <StatusBadge status={link.status} />
              <p className="mt-1 max-w-56 text-xs text-muted-foreground">{statusHint(link.status)}</p>
            </div>
            <CheckNowButton linkId={link.id} size="default" />
          </div>
        </div>
        {link.failStreak > 0 && (
          <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
            Остання перевірка показала проблему. Повторна перевірка вже в черзі — алерт прийде, лише якщо вона це підтвердить.
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Історія перевірок</h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          {link.checks.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">Ще не перевірялось. Натисніть «Перевірити зараз».</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Дата</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Відповідь</TableHead>
                  <TableHead className="hidden sm:table-cell">Проксі</TableHead>
                  <TableHead className="pr-4">Деталі</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {link.checks.map((c) => {
                  const issues = (c.issues as string[]) ?? [];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap pl-4 tabular-nums">{fmtDateTime(c.checkedAt)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{c.httpCode ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.durationMs != null ? `${c.durationMs} мс` : "—"}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{c.proxy ?? "напряму"}</TableCell>
                      <TableCell className="max-w-[28rem] whitespace-normal pr-4 font-mono text-xs text-muted-foreground">
                        {issues.length ? issues.join(" · ") : "—"}
                        {c.finalUrl && c.finalUrl !== link.donorUrl && !issues.some((i) => i.startsWith("redirected")) && (
                          <div className="truncate" title={c.finalUrl}>final: {c.finalUrl}</div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
