/**
 * @file Tests for formatting utilities — truncateAddress, truncateHash,
 * formatCurrency, formatTimestamp, formatPercentage.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  truncateAddress,
  truncateHash,
  formatCurrency,
  formatTimestamp,
  formatPercentage,
} from "../format.js";

// ---------------------------------------------------------------------------
// truncateAddress
// ---------------------------------------------------------------------------

describe("truncateAddress", () => {
  it("truncates a standard 42-char Ethereum address", () => {
    expect(truncateAddress("0xf13021F02E23a8113C1bD826575a1682F6Fac927")).toBe(
      "0xf130...c927",
    );
  });

  it("returns short strings unchanged", () => {
    expect(truncateAddress("0xabc")).toBe("0xabc");
  });

  it("returns 11-char strings unchanged (below threshold)", () => {
    expect(truncateAddress("0x123456789")).toBe("0x123456789");
  });

  it("truncates 12-char strings (at threshold)", () => {
    expect(truncateAddress("0x12345678ab")).toBe("0x1234...78ab");
  });
});

// ---------------------------------------------------------------------------
// truncateHash
// ---------------------------------------------------------------------------

describe("truncateHash", () => {
  it("truncates a standard 66-char transaction hash", () => {
    expect(
      truncateHash(
        "0x725ba2904c3cd1b902fc656f201ef4786af84df56d8dc996a5cbb666b622f573",
      ),
    ).toBe("0x725b...f573");
  });

  it("returns short strings unchanged", () => {
    expect(truncateHash("0xabc")).toBe("0xabc");
  });

  it("returns 11-char strings unchanged (below threshold)", () => {
    expect(truncateHash("abcdefghijk")).toBe("abcdefghijk");
  });

  it("truncates 12-char strings (at threshold)", () => {
    expect(truncateHash("abcdefghijkl")).toBe("abcdef...ijkl");
  });
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats a whole number", () => {
    expect(formatCurrency(1000)).toBe("$1,000.00");
  });

  it("formats a decimal value", () => {
    expect(formatCurrency(150.5)).toBe("$150.50");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(99.999)).toBe("$100.00");
  });

  it("formats a large number with commas", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows seconds ago for recent timestamps", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T12:00:30.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:25.000Z")).toBe("5s ago");
  });

  it("shows minutes ago", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T12:03:00.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:00.000Z")).toBe("3m ago");
  });

  it("shows hours ago", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T14:00:00.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:00.000Z")).toBe("2h ago");
  });

  it("shows days ago", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-16T12:00:00.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:00.000Z")).toBe("1d ago");
  });

  it("shows date for timestamps older than 7 days", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const result = formatTimestamp("2026-03-15T12:00:00.000Z");
    // Should contain "Mar" and "15"
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("shows 0s ago for exact now", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T12:00:00.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:00.000Z")).toBe("0s ago");
  });

  it("shows 59s ago at the boundary before minutes", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T12:00:59.000Z");
    vi.setSystemTime(now);
    expect(formatTimestamp("2026-03-15T12:00:00.000Z")).toBe("59s ago");
  });
});

// ---------------------------------------------------------------------------
// formatPercentage
// ---------------------------------------------------------------------------

describe("formatPercentage", () => {
  it("formats a decimal as percentage with 1 decimal place by default", () => {
    expect(formatPercentage(0.05)).toBe("5.0%");
  });

  it("formats zero", () => {
    expect(formatPercentage(0)).toBe("0.0%");
  });

  it("formats 100%", () => {
    expect(formatPercentage(1)).toBe("100.0%");
  });

  it("accepts a custom decimal places parameter", () => {
    expect(formatPercentage(0.1234, 2)).toBe("12.34%");
  });

  it("handles values greater than 1", () => {
    expect(formatPercentage(1.5)).toBe("150.0%");
  });

  it("handles small values", () => {
    expect(formatPercentage(0.005)).toBe("0.5%");
  });
});
