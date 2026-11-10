/** Check outcome statuses, highest priority first. Must match `enum LinkStatus` in prisma/schema.prisma (minus `pending`). */
export const STATUS_PRIORITY = [
  "blocked",
  "error",
  "page_gone",
  "lost",
  "nofollow",
  "noindex",
  "anchor_changed",
  "ok",
] as const;

export type CheckStatus = (typeof STATUS_PRIORITY)[number];

/** Statuses that mean "we could not see the page" — never treated as a lost link. */
export const INCONCLUSIVE: ReadonlySet<CheckStatus> = new Set(["blocked", "error"]);

/** Statuses that mean the link stopped working for SEO. */
export const PROBLEM: ReadonlySet<CheckStatus> = new Set(["page_gone", "lost", "nofollow", "noindex", "anchor_changed"]);

export function pickStatus(candidates: Iterable<CheckStatus>): CheckStatus {
  let best: CheckStatus = "ok";
  for (const s of candidates) {
    if (STATUS_PRIORITY.indexOf(s) < STATUS_PRIORITY.indexOf(best)) best = s;
  }
  return best;
}
