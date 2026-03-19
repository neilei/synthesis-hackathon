import { describe, it, expect } from "vitest";
import { redactLogRow, redactParsedEntry } from "../redact.js";

describe("redactLogRow", () => {
  it("returns null for privacy_guarantee action", () => {
    const row = {
      id: 1,
      intentId: "test",
      action: "privacy_guarantee",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 0,
      cycle: null,
      tool: null,
      parameters: null,
      result: null,
      durationMs: null,
      error: null,
    };
    expect(redactLogRow(row)).toBeNull();
  });

  it("redacts reasoning and marketContext from rebalance_decision", () => {
    const row = {
      id: 2,
      intentId: "test",
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({
        shouldRebalance: true,
        reasoning: "ETH is undervalued because...",
        marketContext: "BTC dominance rising...",
        model: "qwen3-4b",
      }),
      durationMs: 1200,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.shouldRebalance).toBe(true);
    expect(redacted!.result!.reasoning).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.marketContext).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.model).toBe("qwen3-4b");
    expect(redacted!.result!._redacted).toBe(true);
  });

  it("redacts reasonings from judge_completed", () => {
    const row = {
      id: 3,
      intentId: "test",
      action: "judge_completed",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 2,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({
        composite: 7.5,
        scores: { "decision-quality": 80 },
        reasonings: { "decision-quality": "The agent made a good call..." },
      }),
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.composite).toBe(7.5);
    expect(redacted!.result!.reasonings).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!._redacted).toBe(true);
  });

  it("passes through swap_executed unchanged", () => {
    const row = {
      id: 4,
      intentId: "test",
      action: "swap_executed",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 3,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({ txHash: "0xabc", sellAmount: "0.1" }),
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.txHash).toBe("0xabc");
    expect(redacted!.result!._redacted).toBeUndefined();
  });

  it("handles null result gracefully", () => {
    const row = {
      id: 5,
      intentId: "test",
      action: "agent_start",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 4,
      cycle: null,
      tool: null,
      parameters: null,
      result: null,
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result).toBeUndefined();
  });
});

describe("redactParsedEntry", () => {
  it("returns null for privacy_guarantee", () => {
    const entry = {
      action: "privacy_guarantee",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 0,
    };
    expect(redactParsedEntry(entry)).toBeNull();
  });

  it("redacts reasoning from parsed rebalance_decision", () => {
    const entry = {
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      result: {
        shouldRebalance: false,
        reasoning: "Market is stable",
        marketContext: "Low volatility",
      },
    };
    const redacted = redactParsedEntry(entry);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.reasoning).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.marketContext).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!._redacted).toBe(true);
    expect(redacted!.result!.shouldRebalance).toBe(false);
  });

  it("does not mutate the original entry", () => {
    const entry = {
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      result: {
        shouldRebalance: true,
        reasoning: "original reasoning",
      },
    };
    redactParsedEntry(entry);
    expect(entry.result.reasoning).toBe("original reasoning");
  });

  it("passes through cycle_complete unchanged", () => {
    const entry = {
      action: "cycle_complete",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 5,
      result: { totalValue: 150.5, drift: 0.02 },
    };
    const redacted = redactParsedEntry(entry);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.totalValue).toBe(150.5);
    expect(redacted!.result!._redacted).toBeUndefined();
  });
});
