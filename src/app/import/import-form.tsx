"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CircleAlert, CircleCheck, TriangleAlert, Upload } from "lucide-react";
import { importCsv, type ImportState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsv, {});
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const r = state.report;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={() => setDrag(false)}
          className={cn(
            "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-card px-6 py-10 text-center transition-colors",
            drag ? "border-ring bg-accent" : "hover:border-ring/60",
          )}
        >
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">{fileName ?? "Перетягніть CSV сюди або натисніть, щоб обрати"}</span>
          <span className="text-xs text-muted-foreground">до 5 MB</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Імпортую…" : "Імпортувати"}
        </Button>
      </form>

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          <CircleAlert className="size-4" /> {state.error}
        </p>
      )}

      {r?.fatal && (
        <p className="flex items-center gap-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">
          <CircleAlert className="size-4 shrink-0" /> Файл не імпортовано: {r.fatal}
        </p>
      )}

      {r && !r.fatal && (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <CircleCheck className="size-4 text-ok" /> {state.fileName}
            </span>
            <span><b className="tabular-nums">{r.created}</b> нових</span>
            <span><b className="tabular-nums">{r.updated}</b> оновлено</span>
            <span className={r.errors.length ? "text-bad" : "text-muted-foreground"}>
              <b className="tabular-nums">{r.errors.length}</b> відхилено
            </span>
            {r.created + r.updated > 0 && <Link href="/" className="ml-auto underline">До таблиці →</Link>}
          </div>

          {r.errors.length > 0 && (
            <IssueList title="Помилки (рядки пропущено)" tone="bad" items={r.errors} icon={<CircleAlert className="size-3.5" />} />
          )}
          {r.warnings.length > 0 && (
            <IssueList title="Попередження" tone="warn" items={r.warnings} icon={<TriangleAlert className="size-3.5" />} />
          )}
        </section>
      )}
    </div>
  );
}

function IssueList({ title, tone, items, icon }: { title: string; tone: "bad" | "warn"; items: { line: number; message: string }[]; icon: React.ReactNode }) {
  return (
    <div>
      <h3 className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-medium", tone === "bad" ? "text-bad" : "text-warn")}>
        {icon} {title}
      </h3>
      <ul className="max-h-72 overflow-y-auto rounded-lg border text-sm">
        {items.map((e, i) => (
          <li key={i} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">рядок {e.line}</span>
            <span className="font-mono text-xs">{e.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
