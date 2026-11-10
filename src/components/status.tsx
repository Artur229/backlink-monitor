import type { StoredStatus } from "@/lib/monitor/transition";
import { cn } from "@/lib/utils";

const STYLE: Record<StoredStatus, { label: string; tone: "ok" | "bad" | "warn" | "info" | "muted"; hint: string }> = {
  ok: { label: "ok", tone: "ok", hint: "Посилання на місці, dofollow, анкор збігається" },
  lost: { label: "зникло", tone: "bad", hint: "Сторінка відкривається, але посилання немає" },
  page_gone: { label: "сторінку видалено", tone: "bad", hint: "404 / 410" },
  nofollow: { label: "nofollow", tone: "warn", hint: "rel nofollow / sponsored / ugc або nofollow на сторінці" },
  noindex: { label: "noindex", tone: "warn", hint: "Сторінку закрито від індексації або canonical на інший URL" },
  anchor_changed: { label: "інший анкор", tone: "info", hint: "Посилання живе, але текст інший" },
  blocked: { label: "blocked", tone: "muted", hint: "Капча / 403 / 429 / 503 — не вважається зникненням" },
  error: { label: "error", tone: "muted", hint: "Таймаут, DNS, TLS, мережа — не вважається зникненням" },
  pending: { label: "очікує", tone: "muted", hint: "Ще не перевірялось" },
};

const TONE = {
  ok: "bg-ok/12 text-ok ring-ok/25",
  bad: "bg-bad/12 text-bad ring-bad/25",
  warn: "bg-warn/15 text-warn ring-warn/30",
  info: "bg-info/12 text-info ring-info/25",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

export function StatusBadge({ status, className }: { status: StoredStatus; className?: string }) {
  const s = STYLE[status];
  return (
    <span
      title={s.hint}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[s.tone], className)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </span>
  );
}

export const statusLabel = (s: StoredStatus) => STYLE[s].label;
export const statusHint = (s: StoredStatus) => STYLE[s].hint;
