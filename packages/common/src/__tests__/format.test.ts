/**
 * @file Tests for formatting utilities — truncateAddress, truncateHash,
 * formatCurrency, formatTimestamp, formatPercentage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  truncateAddress,
  truncateHash,
  formatCurrency,
  formatTimestamp,
  formatPercentage,
} from "../format.js";

// ---------------------------------------------------------------------------
// truncateAddress / truncateHash
// ---------------------------------------------------------------------------

describe.each([
  ["truncateAddress", truncateAddress],
  ["truncateHash", truncateHash],
] as const)("%s", (_name, fn) => {
  it("truncates long strings", () => {
    expect(fn("0xf13021F02E23a8113C1bD826575a1682F6Fac927")).toMatch(/^0x.{4}\.\.\..{4}$/);
  });

  it("returns short strings unchanged", () => {
    expect(fn("0xabc")).toBe("0xabc");
  });

  it("returns 11-char strings unchanged (below threshold)", () => {
    expect(fn("0x123456789")).toBe("0x123456789");
  });

  it("truncates 12-char strings (at threshold)", () => {
    const result = fn("0x12345678ab");
    expect(result).toMatch(/^.{6}\.\.\..{4}$/);
  });
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
  it.each([
    [0, "$0.00"],
    [1000, "$1,000.00"],
    [150.5, "$150.50"],
    [99.999, "$100.00"],
    [1234567.89, "$1,234,567.89"],
  ] as const)("formats %f as %s", (input, expected) => {
    expect(formatCurrency(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["2026-03-15T12:00:25.000Z", "2026-03-15T12:00:30.000Z", "5s ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:03:00.000Z", "3m ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T14:00:00.000Z", "2h ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-16T12:00:00.000Z", "1d ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:00:00.000Z", "0s ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:00:59.000Z", "59s ago"],
  ] as const)("formats %s relative to %s as '%s'", (timestamp, now, expected) => {
    vi.setSystemTime(new Date(now));
    expect(formatTimestamp(timestamp)).toBe(expected);
  });

  it("shows date for timestamps older than 7 days", () => {
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));
    const result = formatTimestamp("2026-03-15T12:00:00.000Z");
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });
});

// ---------------------------------------------------------------------------
// formatPercentage
// ---------------------------------------------------------------------------

describe("formatPercentage", () => {
  it.each([
    [0.05, undefined, "5.0%"],
    [0, undefined, "0.0%"],
    [1, undefined, "100.0%"],
    [0.1234, 2, "12.34%"],
    [1.5, undefined, "150.0%"],
    [0.005, undefined, "0.5%"],
  ] as const)("formats %f with decimals=%s as %s", (value, decimals, expected) => {
    expect(formatPercentage(value, decimals)).toBe(expected);
  });
});
