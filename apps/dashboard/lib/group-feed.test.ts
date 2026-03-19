import { describe, it, expect } from "vitest";
import type { AgentLogEntry } from "@veil/common";
import { groupFeedByCycle } from "./group-feed";

const entry = (
  overrides: Partial<AgentLogEntry> & { action: string },
): AgentLogEntry => ({
  timestamp: "2026-03-16T12:00:00.000Z",
  sequence: 0,
  ...overrides,
});

describe("groupFeedByCycle", () => {
  it("groups entries by cycle number", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "rebalance_decision", cycle: 1, sequence: 1 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 2 }),
      entry({ action: "price_fetch", cycle: 2, sequence: 3 }),
      entry({ action: "cycle_complete", cycle: 2, sequence: 4 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups).toHaveLength(2);
    expect(groups[0].cycle).toBe(1);
    expect(groups[0].entries).toHaveLength(3);
    expect(groups[1].cycle).toBe(2);
    expect(groups[1].entries).toHaveLength(2);
  });

  it("puts entries without cycle in an init group (cycle null)", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "agent_start", sequence: 0 }),
      entry({ action: "audit_report", sequence: 1 }),
      entry({ action: "price_fetch", cycle: 1, sequence: 2 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 3 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups).toHaveLength(2);
    expect(groups[0].cycle).toBeNull();
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].cycle).toBe(1);
  });

  it("extracts snapshot from cycle_complete result", () => {
    const feed: AgentLogEntry[] = [
      entry({
        action: "cycle_complete",
        cycle: 1,
        sequence: 0,
        result: {
          allocation: { ETH: 0.6, USDC: 0.4 },
          drift: 0.03,
          totalValue: 1500,
          ethPrice: 2500,
          tradesExecuted: 1,
          totalSpentUsd: 45,
          budgetTier: "$200/day",
        },
      }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].snapshot).toEqual({
      allocation: { ETH: 0.6, USDC: 0.4 },
      drift: 0.03,
      totalValue: 1500,
      ethPrice: 2500,
    });
  });

  it("snapshot is null when cycle_complete has no result", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].snapshot).toBeNull();
  });

  it("returns empty array for empty feed", () => {
    expect(groupFeedByCycle([])).toEqual([]);
  });

  it("preserves entry order within each group", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "a", cycle: 1, sequence: 0 }),
      entry({ action: "b", cycle: 1, sequence: 1 }),
      entry({ action: "c", cycle: 1, sequence: 2 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].entries.map((e) => e.action)).toEqual(["a", "b", "c"]);
  });

  it("detects errors in a cycle group", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "cycle_error", cycle: 1, sequence: 1, error: "boom" }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].hasError).toBe(true);
  });

  it("deduplicates entries with the same sequence number", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 12, sequence: 60 }),
      entry({ action: "price_fetch", cycle: 12, sequence: 60 }), // duplicate
      entry({ action: "portfolio_check", cycle: 12, sequence: 61 }),
      entry({ action: "portfolio_check", cycle: 12, sequence: 61 }), // duplicate
      entry({ action: "rebalance_decision", cycle: 12, sequence: 62 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups).toHaveLength(1);
    expect(groups[0].cycle).toBe(12);
    expect(groups[0].entries).toHaveLength(3);
    expect(groups[0].entries.map((e) => e.action)).toEqual([
      "price_fetch",
      "portfolio_check",
      "rebalance_decision",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Progress tracking tests
// ---------------------------------------------------------------------------

describe("progress tracking", () => {
  /** Build a cycle group from a list of actions and return its progress. */
  function progress(actions: Array<{ action: string; result?: Record<string, unknown>; error?: string }>) {
    const feed: AgentLogEntry[] = actions.map((a, i) => entry({
      action: a.action,
      cycle: 1,
      sequence: i,
      result: a.result,
      error: a.error,
    }));
    const groups = groupFeedByCycle(feed);
    return groups[0].progress;
  }

  // ── In-progress states (cycle not yet terminal) ─────────────────────

  it("shows 0/5 with pending label when cycle just started (no entries yet beyond budget_check)", () => {
    // budget_check only fires when tier !== normal, so it's not a milestone
    const p = progress([{ action: "budget_check" }]);
    expect(p.completed).toBe(0);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Fetching price");
  });

  it("shows 1/5 after price_fetch", () => {
    const p = progress([{ action: "price_fetch" }]);
    expect(p.completed).toBe(1);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Checking portfolio");
  });

  it("shows 2/5 after price_fetch + portfolio_check", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
    ]);
    expect(p.completed).toBe(2);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Fetching pool data");
  });

  it("shows 3/5 after all market data gathered", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
    ]);
    expect(p.completed).toBe(3);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Analyzing drift");
  });

  it("shows 4/5 after hold decision", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: false, reasoning: "drift low" } },
    ]);
    expect(p.completed).toBe(4);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Completing cycle");
  });

  it("shows 4/8 after rebalance decision", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true, reasoning: "high drift" } },
    ]);
    expect(p.completed).toBe(4);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBe("Getting quote");
  });

  it("shows 5/8 after quote received", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
    ]);
    expect(p.completed).toBe(5);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBe("Executing swap");
  });

  it("shows 6/8 after swap executed, pending judge", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
      { action: "swap_executed" },
      { action: "judge_started" },
    ]);
    expect(p.completed).toBe(6);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBe("Evaluating result");
  });

  // ── Completed cycles ────────────────────────────────────────────────

  it("shows 5/5 for completed hold cycle", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: false } },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    expect(p.completed).toBe(5);
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBeNull();
  });

  it("shows 8/8 for completed rebalance cycle", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
      { action: "swap_executed" },
      { action: "judge_completed" },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    expect(p.completed).toBe(8);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBeNull();
  });

  // ── Low-drift hold (no rebalance_decision at all) ───────────────────

  it("shows 4/4 for low-drift hold cycle (skips decision entirely)", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    expect(p.completed).toBe(4);
    expect(p.total).toBe(4);
    expect(p.pendingLabel).toBeNull();
  });

  // ── Error variants ──────────────────────────────────────────────────

  it("handles cycle_error as terminal (crash mid-cycle)", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "cycle_error", error: "Venice timeout" },
    ]);
    // cycle_error is terminal, no decision was made
    expect(p.completed).toBe(3); // price + portfolio + cycle_error
    expect(p.total).toBe(3); // terminal without decision → total = completed
    expect(p.pendingLabel).toBeNull();
  });

  it("handles swap_failed instead of swap_executed", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
      { action: "swap_failed", error: "insufficient funds" },
      { action: "judge_started" },
    ]);
    expect(p.completed).toBe(6); // price + portfolio + pool + decision + quote + swap_failed
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBe("Evaluating result");
  });

  it("handles judge_failed instead of judge_completed", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
      { action: "swap_executed" },
      { action: "judge_failed", error: "Venice unreachable" },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    expect(p.completed).toBe(8);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBeNull();
  });

  // ── Intermediate actions don't affect step count ────────────────────

  it("ignores intermediate actions (permit2, delegation)", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true } },
      { action: "quote_received" },
      { action: "permit2_approval" },
      { action: "delegation_caveat_enforced" },
      { action: "swap_executed" },
      { action: "judge_started" },
      { action: "judge_completed" },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    // permit2_approval, delegation_caveat_enforced, judge_started are not milestones
    expect(p.completed).toBe(8);
    expect(p.total).toBe(8);
    expect(p.pendingLabel).toBeNull();
  });

  it("shows 6/6 when rebalance decision followed by safety_block", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch" },
      { action: "rebalance_decision", result: { shouldRebalance: true, reasoning: "high drift" } },
      { action: "safety_block", result: { reason: "trade_limit_reached" } },
      { action: "cycle_complete", result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } },
    ]);
    // 3 market + decision + safety_block + complete = 6
    expect(p.completed).toBe(6);
    expect(p.total).toBe(6);
    expect(p.pendingLabel).toBeNull();
  });

  it("ignores budget_check (conditional, not a milestone)", () => {
    const p = progress([
      { action: "budget_check", result: { tier: "critical" } },
      { action: "price_fetch" },
    ]);
    expect(p.completed).toBe(1); // only price_fetch counts
    expect(p.total).toBe(5);
    expect(p.pendingLabel).toBe("Checking portfolio");
  });

  // ── Judge completes before cycle_complete (normal flow) ──────────

  it("shows correct progress when judge completes within the cycle", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "portfolio_check", cycle: 1, sequence: 1 }),
      entry({ action: "pool_data_fetch", cycle: 1, sequence: 2 }),
      entry({ action: "rebalance_decision", cycle: 1, sequence: 3, result: { shouldRebalance: true } }),
      entry({ action: "quote_received", cycle: 1, sequence: 4 }),
      entry({ action: "swap_executed", cycle: 1, sequence: 5 }),
      entry({ action: "judge_started", cycle: 1, sequence: 6 }),
      entry({ action: "judge_completed", cycle: 1, sequence: 7, result: { composite: 0.85 } }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 8, result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } }),
    ];
    const groups = groupFeedByCycle(feed);
    expect(groups[0].progress.completed).toBe(8);
    expect(groups[0].progress.total).toBe(8);
    expect(groups[0].progress.pendingLabel).toBeNull();
  });

  // ── Defensive: judge_completed arrives after cycle_complete ─────

  it("updates progress when judge_completed arrives after cycle_complete", () => {
    // SSE delivery order is not guaranteed — frontend must handle this
    const feedBefore: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "portfolio_check", cycle: 1, sequence: 1 }),
      entry({ action: "pool_data_fetch", cycle: 1, sequence: 2 }),
      entry({ action: "rebalance_decision", cycle: 1, sequence: 3, result: { shouldRebalance: true } }),
      entry({ action: "quote_received", cycle: 1, sequence: 4 }),
      entry({ action: "swap_executed", cycle: 1, sequence: 5 }),
      entry({ action: "judge_started", cycle: 1, sequence: 6 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 7, result: { allocation: {}, drift: 0, totalValue: 0, ethPrice: 0 } }),
    ];
    const groupsBefore = groupFeedByCycle(feedBefore);
    expect(groupsBefore[0].progress.completed).toBe(7);
    expect(groupsBefore[0].progress.total).toBe(8);

    const feedAfter = [
      ...feedBefore,
      entry({ action: "judge_completed", cycle: 1, sequence: 8, result: { composite: 0.85 } }),
    ];
    const groupsAfter = groupFeedByCycle(feedAfter);
    expect(groupsAfter[0].progress.completed).toBe(8);
    expect(groupsAfter[0].progress.total).toBe(8);
    expect(groupsAfter[0].progress.pendingLabel).toBeNull();
  });

  // ── pool_data_fetch error (cycle continues) ─────────────────────────

  it("counts pool_data_fetch with error as completed step", () => {
    const p = progress([
      { action: "price_fetch" },
      { action: "portfolio_check" },
      { action: "pool_data_fetch", error: "The Graph timeout" },
      { action: "rebalance_decision", result: { shouldRebalance: false } },
    ]);
    expect(p.completed).toBe(4); // pool error still counts as completed
    expect(p.total).toBe(5);
  });

  // ── isComplete flag ─────────────────────────────────────────────────

  it("isComplete is true for cycle_complete", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 1 }),
    ];
    const groups = groupFeedByCycle(feed);
    expect(groups[0].isComplete).toBe(true);
  });

  it("isComplete is true for cycle_error", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "cycle_error", cycle: 1, sequence: 1, error: "boom" }),
    ];
    const groups = groupFeedByCycle(feed);
    expect(groups[0].isComplete).toBe(true);
  });

  it("isComplete is false when cycle is in progress", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "portfolio_check", cycle: 1, sequence: 1 }),
    ];
    const groups = groupFeedByCycle(feed);
    expect(groups[0].isComplete).toBe(false);
  });

  // ── Init group progress ─────────────────────────────────────────────

  it("init group progress uses raw entry count", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "privacy_guarantee", sequence: 0 }),
      entry({ action: "delegation_created", sequence: 1 }),
      entry({ action: "audit_report", sequence: 2 }),
    ];
    const groups = groupFeedByCycle(feed);
    expect(groups[0].cycle).toBeNull();
    expect(groups[0].progress).toEqual({
      completed: 3,
      total: 3,
      pendingLabel: null,
    });
  });
});
