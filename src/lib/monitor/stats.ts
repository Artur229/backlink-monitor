import type { CheckStatus } from "../check/status";
import { prisma } from "../db";
import type { StoredStatus } from "./transition";

/** Link no longer passes SEO value → its price is "money at risk". anchor_changed still passes value. */
export const AT_RISK: ReadonlySet<StoredStatus> = new Set<CheckStatus>(["lost", "page_gone", "nofollow", "noindex"]);
/** Shown as "problems" (needs an outreacher's attention). */
export const PROBLEMS: ReadonlySet<StoredStatus> = new Set<CheckStatus>(["lost", "page_gone", "nofollow", "noindex", "anchor_changed"]);
export const UNREACHABLE: ReadonlySet<StoredStatus> = new Set<CheckStatus>(["blocked", "error"]);

export interface Stats {
  total: number;
  ok: number;
  problems: number;
  unreachable: number;
  pending: number;
  atRiskUsd: number;
  byStatus: Partial<Record<StoredStatus, number>>;
}

export function summarize(rows: { status: StoredStatus; count: number; priceUsd: number }[]): Stats {
  const s: Stats = { total: 0, ok: 0, problems: 0, unreachable: 0, pending: 0, atRiskUsd: 0, byStatus: {} };
  for (const r of rows) {
    s.total += r.count;
    s.byStatus[r.status] = (s.byStatus[r.status] ?? 0) + r.count;
    if (r.status === "ok") s.ok += r.count;
    else if (r.status === "pending") s.pending += r.count;
    else if (PROBLEMS.has(r.status)) s.problems += r.count;
    else if (UNREACHABLE.has(r.status)) s.unreachable += r.count;
    if (AT_RISK.has(r.status)) s.atRiskUsd += r.priceUsd;
  }
  return s;
}

export async function getStats(): Promise<Stats> {
  const rows = await prisma.link.groupBy({ by: ["status"], _count: { _all: true }, _sum: { priceUsd: true } });
  return summarize(rows.map((r) => ({ status: r.status, count: r._count._all, priceUsd: r._sum.priceUsd ?? 0 })));
}
