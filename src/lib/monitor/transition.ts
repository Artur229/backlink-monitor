import { INCONCLUSIVE, type CheckStatus } from "../check/status";

export type StoredStatus = CheckStatus | "pending";

export interface LinkState {
  status: StoredStatus;
  failStreak: number;
  lastConclusiveStatus: CheckStatus | null;
}

export interface Alert {
  /** previous conclusive status, "pending" for a never-checked link */
  from: StoredStatus;
  to: CheckStatus;
  kind: "problem" | "low" | "recovered";
}

export interface Transition {
  next: LinkState;
  statusChanged: boolean;
  alert: Alert | null;
  /** lost/page_gone seen once: re-check after CONFIRM_DELAY_MS before alerting */
  scheduleConfirm: boolean;
}

/** These need 2 consecutive results before we believe them (a donor may be down for an hour). */
const NEEDS_CONFIRMATION: ReadonlySet<CheckStatus> = new Set(["lost", "page_gone"]);
const CONFIRMATIONS_REQUIRED = 2;

/**
 * Pure: current link state + new check result → next state and whether to alert.
 *
 * Rules (spec §3):
 *  - blocked / error never count as a lost link and never alert; the conclusive state is untouched.
 *  - Alerts fire only on a CHANGE of the conclusive status, never on repeats.
 *  - lost / page_gone alert only after 2 consecutive results (second one ~1h later).
 */
export function transition(prev: LinkState, result: CheckStatus): Transition {
  const changed = (next: LinkState) => next.status !== prev.status;

  // Inconclusive: show it, but remember nothing about the link itself.
  if (INCONCLUSIVE.has(result)) {
    const next = { ...prev, status: result };
    return { next, statusChanged: changed(next), alert: null, scheduleConfirm: false };
  }

  if (NEEDS_CONFIRMATION.has(result)) {
    if (prev.lastConclusiveStatus === result) {
      // Already confirmed and alerted earlier — nothing new.
      const next = { ...prev, status: result, failStreak: 0 };
      return { next, statusChanged: changed(next), alert: null, scheduleConfirm: false };
    }
    const streak = prev.failStreak + 1;
    if (streak < CONFIRMATIONS_REQUIRED) {
      // Keep showing the previous status until confirmed.
      const next = { ...prev, failStreak: streak };
      return { next, statusChanged: false, alert: null, scheduleConfirm: true };
    }
    const next: LinkState = { status: result, failStreak: 0, lastConclusiveStatus: result };
    return {
      next,
      statusChanged: changed(next),
      alert: { from: prev.lastConclusiveStatus ?? "pending", to: result, kind: "problem" },
      scheduleConfirm: false,
    };
  }

  // ok / nofollow / noindex / anchor_changed: a single result is enough.
  const next: LinkState = { status: result, failStreak: 0, lastConclusiveStatus: result };
  const before = prev.lastConclusiveStatus;
  let alert: Alert | null = null;
  if (before !== result && !(before === null && result === "ok")) {
    alert = {
      from: before ?? "pending",
      to: result,
      kind: result === "ok" ? "recovered" : result === "anchor_changed" ? "low" : "problem",
    };
  }
  return { next, statusChanged: changed(next), alert, scheduleConfirm: false };
}
