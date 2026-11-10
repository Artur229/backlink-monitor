"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUS_OPTIONS: [string, string][] = [
  ["all", "Усі статуси"],
  ["problems", "Проблемні"],
  ["unreachable", "Blocked / error"],
  ["ok", "ok"],
  ["lost", "зникло"],
  ["page_gone", "сторінку видалено"],
  ["nofollow", "nofollow"],
  ["noindex", "noindex"],
  ["anchor_changed", "інший анкор"],
  ["blocked", "blocked"],
  ["error", "error"],
  ["pending", "очікує"],
];

const SORT_OPTIONS: [string, string][] = [
  ["price_desc", "Ціна: дорожчі"],
  ["price_asc", "Ціна: дешевші"],
  ["changed_desc", "Нещодавно змінились"],
  ["checked_desc", "Нещодавно перевірені"],
];

const selectCls =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function Filters({ outreachers }: { outreachers: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (key: string, value: string, def = "") => {
    const next = new URLSearchParams(sp.toString());
    if (!value || value === def) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  // Debounced search
  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const t = setTimeout(() => set("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["status", "outreacher", "q", "sort"].some((k) => sp.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук: донор, ціль, анкор" className="pl-8" aria-label="Пошук" />
      </div>
      <select aria-label="Статус" className={selectCls} value={sp.get("status") ?? "all"} onChange={(e) => set("status", e.target.value, "all")}>
        {STATUS_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <select aria-label="Аутричер" className={selectCls} value={sp.get("outreacher") ?? ""} onChange={(e) => set("outreacher", e.target.value)}>
        <option value="">Усі аутричери</option>
        {outreachers.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value="__none__">Без аутричера</option>
      </select>
      <select aria-label="Сортування" className={selectCls} value={sp.get("sort") ?? "price_desc"} onChange={(e) => set("sort", e.target.value, "price_desc")}>
        {SORT_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          onClick={() => { setQ(""); router.replace(pathname, { scroll: false }); }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" /> Скинути
        </button>
      )}
    </div>
  );
}
