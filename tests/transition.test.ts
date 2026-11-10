import { describe, expect, it } from "vitest";
import type { CheckStatus } from "../src/lib/check/status";
import { transition, type LinkState } from "../src/lib/monitor/transition";

const fresh: LinkState = { status: "pending", failStreak: 0, lastConclusiveStatus: null };
const okLink: LinkState = { status: "ok", failStreak: 0, lastConclusiveStatus: "ok" };

/** Run a sequence of results, return every alert as "from→to" */
function run(results: CheckStatus[], start: LinkState = okLink) {
  let state = start;
  const alerts: string[] = [];
  const confirms: number[] = [];
  results.forEach((r, i) => {
    const t = transition(state, r);
    if (t.alert) alerts.push(`${t.alert.from}→${t.alert.to}`);
    if (t.scheduleConfirm) confirms.push(i);
    state = t.next;
  });
  return { state, alerts, confirms };
}

describe("transition — alert only on change", () => {
  it("ok → ok → ok: nothing", () => {
    expect(run(["ok", "ok", "ok"]).alerts).toEqual([]);
  });

  it("ok → lost needs 2 consecutive results; one-off lost is ignored", () => {
    const one = run(["lost", "ok"]);
    expect(one.alerts).toEqual([]);
    expect(one.confirms).toEqual([0]);
    expect(one.state.status).toBe("ok");

    const two = run(["lost", "lost"]);
    expect(two.alerts).toEqual(["ok→lost"]);
    expect(two.state).toEqual({ status: "lost", failStreak: 0, lastConclusiveStatus: "lost" });
  });

  it("first unconfirmed lost keeps showing the previous status", () => {
    const t = transition(okLink, "lost");
    expect(t.next).toEqual({ status: "ok", failStreak: 1, lastConclusiveStatus: "ok" });
    expect(t.statusChanged).toBe(false);
    expect(t.scheduleConfirm).toBe(true);
  });

  it("page_gone is confirmed the same way", () => {
    expect(run(["page_gone", "page_gone"]).alerts).toEqual(["ok→page_gone"]);
  });

  it("confirmed lost stays quiet day after day", () => {
    const r = run(["lost", "lost", "lost", "lost", "lost"]);
    expect(r.alerts).toEqual(["ok→lost"]);
    expect(r.confirms).toEqual([0]);
  });

  it("nofollow / noindex alert immediately", () => {
    expect(run(["nofollow"]).alerts).toEqual(["ok→nofollow"]);
    expect(run(["noindex"]).alerts).toEqual(["ok→noindex"]);
  });

  it("anchor_changed is a low-priority alert", () => {
    expect(transition(okLink, "anchor_changed").alert).toEqual({ from: "ok", to: "anchor_changed", kind: "low" });
  });

  it("problem → ok sends a 'recovered' alert", () => {
    const r = run(["nofollow", "ok"]);
    expect(r.alerts).toEqual(["ok→nofollow", "nofollow→ok"]);
    expect(transition({ status: "nofollow", failStreak: 0, lastConclusiveStatus: "nofollow" }, "ok").alert?.kind).toBe("recovered");
  });

  it("problem → other problem alerts", () => {
    expect(run(["nofollow", "lost", "lost"]).alerts).toEqual(["ok→nofollow", "nofollow→lost"]);
  });
});

describe("transition — blocked / error never mean lost", () => {
  it("ok → blocked → error → ok: no alerts at all", () => {
    const r = run(["blocked", "error", "ok"]);
    expect(r.alerts).toEqual([]);
    expect(r.state.status).toBe("ok");
  });

  it("blocked is shown but the conclusive status is kept", () => {
    const t = transition(okLink, "blocked");
    expect(t.next).toEqual({ status: "blocked", failStreak: 0, lastConclusiveStatus: "ok" });
    expect(t.statusChanged).toBe(true);
    expect(t.alert).toBeNull();
  });

  it("lost → error → lost still confirms (inconclusive does not reset the streak)", () => {
    expect(run(["lost", "error", "lost"]).alerts).toEqual(["ok→lost"]);
  });

  it("ok → blocked → nofollow alerts ok→nofollow (compares with last conclusive)", () => {
    expect(run(["blocked", "nofollow"]).alerts).toEqual(["ok→nofollow"]);
  });

  it("lost confirmed → blocked → lost: no repeat alert", () => {
    expect(run(["lost", "lost", "blocked", "lost"]).alerts).toEqual(["ok→lost"]);
  });
});

describe("transition — first check of a new link", () => {
  it("pending → ok: no alert", () => {
    expect(transition(fresh, "ok").alert).toBeNull();
  });

  it("pending → nofollow alerts right away", () => {
    expect(transition(fresh, "nofollow").alert).toEqual({ from: "pending", to: "nofollow", kind: "problem" });
  });

  it("pending → lost needs confirmation too", () => {
    const r = run(["lost", "lost"], fresh);
    expect(r.alerts).toEqual(["pending→lost"]);
    expect(r.confirms).toEqual([0]);
  });

  it("pending → blocked: shown as blocked, no alert", () => {
    const t = transition(fresh, "blocked");
    expect(t.next.status).toBe("blocked");
    expect(t.alert).toBeNull();
  });
});
