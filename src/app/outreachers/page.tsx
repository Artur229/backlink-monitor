import Link from "next/link";
import { usd } from "@/components/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outreacherReport } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Outreachers() {
  const rows = await outreacherReport();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Звіт по аутричерах</h1>
        <p className="text-sm text-muted-foreground">
          % живих рахується лише по посиланнях, які вдалося перевірити (без blocked / error / очікує). $ втрачено — ціна посилань, що зникли або перестали передавати вагу.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">Даних ще немає.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Аутричер</TableHead>
                <TableHead className="text-right">Посилань</TableHead>
                <TableHead className="w-48">% живих</TableHead>
                <TableHead className="text-right">Проблемні</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Не перевірено</TableHead>
                <TableHead className="hidden text-right md:table-cell">Витрачено</TableHead>
                <TableHead className="pr-4 text-right">$ втрачено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const q = r.outreacher === null ? "__none__" : encodeURIComponent(r.outreacher);
                return (
                  <TableRow key={r.outreacher ?? "__none__"}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/?outreacher=${q}`} className="hover:underline">
                        {r.outreacher ?? <span className="text-muted-foreground">без аутричера</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.links}</TableCell>
                    <TableCell>
                      {r.alivePct === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                            <div
                              className={cn("h-full rounded-full", r.alivePct >= 90 ? "bg-ok" : r.alivePct >= 70 ? "bg-warn" : "bg-bad")}
                              style={{ width: `${r.alivePct}%` }}
                            />
                          </div>
                          <span className="w-10 text-right tabular-nums">{r.alivePct}%</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.problems ? (
                        <Link href={`/?outreacher=${q}&status=problems`} className="text-bad hover:underline">{r.problems}</Link>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{r.unreachable}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{usd(r.spentUsd)}</TableCell>
                    <TableCell className={cn("pr-4 text-right font-medium tabular-nums", r.lostUsd ? "text-bad" : "text-muted-foreground")}>
                      {usd(r.lostUsd)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
