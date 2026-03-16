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
});
