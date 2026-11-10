import { prisma } from "../db";
import { AT_RISK, PROBLEMS, UNREACHABLE } from "../monitor/stats";
import type { StoredStatus } from "../monitor/transition";
import type { Prisma } from "../../generated/prisma/client";

export const STATUS_FILTERS = ["all", "problems", "unreachable", "ok", "lost", "page_gone", "nofollow", "noindex", "anchor_changed", "blocked", "error", "pending"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const SORTS = ["price_desc", "price_asc", "checked_desc", "changed_desc"] as const;
export type Sort = (typeof SORTS)[number];

export interface LinkFilters {
  status: StatusFilter;
  outreacher: string; // "" = all, "__none__" = without outreacher
  sort: Sort;
  q: string;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): LinkFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const status = one("status") as StatusFilter;
  const sort = one("sort") as Sort;
  return {
    status: STATUS_FILTERS.includes(status) ? status : "all",
    outreacher: one("outreacher"),
    sort: SORTS.includes(sort) ? sort : "price_desc",
    q: one("q").trim(),
  };
}

function statusWhere(f: StatusFilter): Prisma.LinkWhereInput {
  if (f === "all") return {};
  if (f === "problems") return { status: { in: [...PROBLEMS] as StoredStatus[] } };
  if (f === "unreachable") return { status: { in: [...UNREACHABLE] as StoredStatus[] } };
  return { status: f };
}

const ORDER: Record<Sort, Prisma.LinkOrderByWithRelationInput[]> = {
  price_desc: [{ priceUsd: { sort: "desc", nulls: "last" } }, { donorUrl: "asc" }],
  price_asc: [{ priceUsd: { sort: "asc", nulls: "last" } }, { donorUrl: "asc" }],
  checked_desc: [{ lastCheckedAt: { sort: "desc", nulls: "last" } }],
  changed_desc: [{ statusChangedAt: { sort: "desc", nulls: "last" } }],
};

export async function listLinks(f: LinkFilters, take = 500) {
  const where: Prisma.LinkWhereInput = {
    ...statusWhere(f.status),
    ...(f.outreacher === "__none__" ? { outreacher: null } : f.outreacher ? { outreacher: f.outreacher } : {}),
    ...(f.q
      ? { OR: [{ donorUrl: { contains: f.q, mode: "insensitive" } }, { targetUrl: { contains: f.q, mode: "insensitive" } }, { anchor: { contains: f.q, mode: "insensitive" } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([prisma.link.findMany({ where, orderBy: ORDER[f.sort], take }), prisma.link.count({ where })]);
  return { rows, total };
}

export async function listOutreachers(): Promise<string[]> {
  const rows = await prisma.link.findMany({ where: { outreacher: { not: null } }, distinct: ["outreacher"], select: { outreacher: true }, orderBy: { outreacher: "asc" } });
  return rows.map((r) => r.outreacher!);
}

export async function getLinkWithHistory(id: string, take = 100) {
  return prisma.link.findUnique({ where: { id }, include: { checks: { orderBy: { checkedAt: "desc" }, take } } });
}

/** Link exists and is followed: still delivers value (anchor change is cosmetic). */
const ALIVE: ReadonlySet<StoredStatus> = new Set(["ok", "anchor_changed"]);

export interface OutreacherRow {
  outreacher: string | null;
  links: number;
  checked: number;
  alive: number;
  alivePct: number | null;
  problems: number;
  unreachable: number;
  spentUsd: number;
  lostUsd: number;
}

export async function outreacherReport(): Promise<OutreacherRow[]> {
  const groups = await prisma.link.groupBy({ by: ["outreacher", "status"], _count: { _all: true }, _sum: { priceUsd: true } });
  const map = new Map<string | null, OutreacherRow>();
  for (const g of groups) {
    const r = map.get(g.outreacher) ?? { outreacher: g.outreacher, links: 0, checked: 0, alive: 0, alivePct: null, problems: 0, unreachable: 0, spentUsd: 0, lostUsd: 0 };
    const n = g._count._all;
    const usd = g._sum.priceUsd ?? 0;
    r.links += n;
    r.spentUsd += usd;
    // % alive is over conclusively checked links only: blocked/pending tell us nothing.
    if (g.status !== "pending" && !UNREACHABLE.has(g.status)) r.checked += n;
    if (ALIVE.has(g.status)) r.alive += n;
    if (PROBLEMS.has(g.status)) r.problems += n;
    if (UNREACHABLE.has(g.status)) r.unreachable += n;
    if (AT_RISK.has(g.status)) r.lostUsd += usd;
    map.set(g.outreacher, r);
  }
  return [...map.values()]
    .map((r) => ({ ...r, alivePct: r.checked ? Math.round((r.alive / r.checked) * 100) : null }))
    .sort((a, b) => b.lostUsd - a.lostUsd || b.links - a.links);
}
