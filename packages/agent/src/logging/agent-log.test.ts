/**
 * Unit tests for JSONL event logging: entry creation, sequencing, file output.
 *
 * @module @veil/agent/logging/agent-log.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { appendFileSync } from "fs";
import {
  logAction,
  resetLogSequence,
  logStart,
  logStop,
  type AgentLogEntry,
} from "./agent-log.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetLogSequence();
});

describe("logAction", () => {
  it("returns an entry with correct shape and action", () => {
    const entry = logAction("test_action");

    expect(entry).toMatchObject({
      action: "test_action",
      sequence: 0,
    });
    expect(entry.timestamp).toBeDefined();
    expect(typeof entry.timestamp).toBe("string");
    // ISO 8601 format check
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it("increments sequence on successive calls", () => {
    const first = logAction("action_1");
    const second = logAction("action_2");
    const third = logAction("action_3");

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);
  });

  it("includes optional fields when provided", () => {
    const entry = logAction("swap", {
      tool: "uniswap",
      parameters: { tokenIn: "WETH", tokenOut: "USDC" },
      result: { txHash: "0xabc" },
      duration_ms: 1234,
    });

    expect(entry.tool).toBe("uniswap");
    expect(entry.parameters).toEqual({ tokenIn: "WETH", tokenOut: "USDC" });
    expect(entry.result).toEqual({ txHash: "0xabc" });
    expect(entry.duration_ms).toBe(1234);
  });

  it("includes error field when provided", () => {
    const entry = logAction("swap_failed", {
      error: "insufficient balance",
    });

    expect(entry.error).toBe("insufficient balance");
  });

  it("omits optional fields when not provided", () => {
    const entry = logAction("simple_action");

    expect(entry.tool).toBeUndefined();
    expect(entry.parameters).toBeUndefined();
    expect(entry.result).toBeUndefined();
    expect(entry.duration_ms).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });

  it("writes JSON line to file via appendFileSync", () => {
    const entry = logAction("file_write_test");

    expect(appendFileSync).toHaveBeenCalledTimes(1);

    const [filePath, content, encoding] = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(filePath).toContain("agent_log.jsonl");
    expect(encoding).toBe("utf-8");

    // Content should be valid JSON followed by newline
    expect(content).toMatch(/\n$/);
    const parsed = JSON.parse(content.trim());
    expect(parsed.action).toBe("file_write_test");
    expect(parsed.sequence).toBe(entry.sequence);
  });
});

describe("resetLogSequence", () => {
  it("resets the sequence counter to 0", () => {
    logAction("a");
    logAction("b");
    const before = logAction("c");
    expect(before.sequence).toBe(2);

    resetLogSequence();

    const after = logAction("d");
    expect(after.sequence).toBe(0);
  });
});

describe("logStart", () => {
  it("logs an agent_start action with pid and cwd", () => {
    logStart();

    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const [, content] = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed: AgentLogEntry = JSON.parse(content.trim());

    expect(parsed.action).toBe("agent_start");
    expect(parsed.parameters).toBeDefined();
    expect(parsed.parameters!.pid).toBe(process.pid);
    expect(parsed.parameters!.cwd).toBe(process.cwd());
  });
});

describe("logStop", () => {
  it("logs an agent_stop action with the given reason", () => {
    logStop("user_requested");

    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const [, content] = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed: AgentLogEntry = JSON.parse(content.trim());

    expect(parsed.action).toBe("agent_stop");
    expect(parsed.parameters).toEqual({ reason: "user_requested" });
  });
});
