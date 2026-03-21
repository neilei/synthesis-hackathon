import { describe, it, expect } from "vitest";
import {
  computeExpiryTimestamp,
  computePeriodAmount,
  computeConservativeEthPrice,
  ETH_PRICE_ABSOLUTE_FLOOR_USD,
  detectAdversarialIntent,
  generateAuditReport,
} from "../delegation.js";
import type { ParsedIntent } from "../schemas.js";

const SAMPLE_INTENT: ParsedIntent = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  maxTradesPerDay: 10,
  maxPerTradeUsd: 200,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

describe("computeExpiryTimestamp", () => {
  it("computes expiry as now + days * 86400", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = computeExpiryTimestamp(7);
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before + 7 * 86400);
    expect(result).toBeLessThanOrEqual(after + 7 * 86400);
  });

  it("works for single day", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = computeExpiryTimestamp(1);
    expect(result - now).toBeGreaterThanOrEqual(86399);
    expect(result - now).toBeLessThanOrEqual(86401);
  });
});

describe("computeConservativeEthPrice", () => {
  it("halves live price", () => {
    expect(computeConservativeEthPrice(2000)).toBe(1000);
  });

  it("never goes below absolute floor", () => {
    expect(computeConservativeEthPrice(800)).toBe(ETH_PRICE_ABSOLUTE_FLOOR_USD);
  });

  it("uses explicit ethPriceFloor over live price", () => {
    expect(computeConservativeEthPrice(2000, 1500)).toBe(1500);
  });

  it("clamps explicit floor to absolute floor", () => {
    expect(computeConservativeEthPrice(2000, 300)).toBe(ETH_PRICE_ABSOLUTE_FLOOR_USD);
  });

  it("falls back to absolute floor with no args", () => {
    expect(computeConservativeEthPrice()).toBe(ETH_PRICE_ABSOLUTE_FLOOR_USD);
  });
});

describe("computePeriodAmount", () => {
  it("falls back to $500 floor with no price args", () => {
    // $200/day at $500/ETH = 0.4 ETH
    const result = computePeriodAmount(200, "ETH");
    expect(result).toBe(400000000000000000n);
  });

  it("uses livePrice/2 when provided", () => {
    // $200/day, live $2000 → conservative $1000 → 0.2 ETH
    const result = computePeriodAmount(200, "ETH", 2000);
    expect(result).toBe(200000000000000000n);
  });

  it("uses explicit ethPriceFloor when provided", () => {
    // $200/day, floor $800 → 0.25 ETH
    const result = computePeriodAmount(200, "ETH", undefined, 800);
    expect(result).toBe(250000000000000000n);
  });

  it("converts daily budget USD to USDC units (6 decimals)", () => {
    const result = computePeriodAmount(200, "USDC");
    expect(result).toBe(200_000_000n);
  });

  it("USDC ignores ETH price args", () => {
    const result = computePeriodAmount(200, "USDC", 2000, 1500);
    expect(result).toBe(200_000_000n);
  });

  it("returns 0 for zero budget", () => {
    expect(computePeriodAmount(0, "ETH")).toBe(0n);
    expect(computePeriodAmount(0, "USDC")).toBe(0n);
  });

  it("rounds up to avoid underestimating amounts", () => {
    // $1/day at $500/ETH = 0.002 ETH = 2000000000000000 wei
    const result = computePeriodAmount(1, "ETH");
    expect(result).toBe(2000000000000000n);
  });
});

describe("detectAdversarialIntent", () => {
  it("returns empty for safe intents", () => {
    expect(detectAdversarialIntent(SAMPLE_INTENT)).toEqual([]);
  });

  it("warns on high daily budget", () => {
    const warnings = detectAdversarialIntent({
      ...SAMPLE_INTENT,
      dailyBudgetUsd: 5000,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("dailyBudgetUsd");
  });

  it("warns on long time window", () => {
    const warnings = detectAdversarialIntent({
      ...SAMPLE_INTENT,
      timeWindowDays: 60,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("timeWindowDays");
  });

  it("warns on high slippage", () => {
    const warnings = detectAdversarialIntent({
      ...SAMPLE_INTENT,
      maxSlippage: 0.05,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("maxSlippage");
  });

  it("returns multiple warnings", () => {
    const warnings = detectAdversarialIntent({
      ...SAMPLE_INTENT,
      dailyBudgetUsd: 5000,
      timeWindowDays: 60,
      maxSlippage: 0.05,
    });
    expect(warnings).toHaveLength(3);
  });
});

describe("generateAuditReport", () => {
  it("generates allows list", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.allows.length).toBeGreaterThan(0);
    expect(report.allows.some((a) => a.includes("$200"))).toBe(true);
    expect(report.allows.some((a) => a.includes("7 days"))).toBe(true);
  });

  it("generates prevents list", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.prevents.length).toBeGreaterThan(0);
    expect(report.prevents.some((p) => p.includes("$1,400"))).toBe(true);
  });

  it("generates worst case with principal + slippage", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.worstCase).toContain("$1,400");
    expect(report.worstCase).toContain("slippage");
  });

  it("includes per-trade limit in allows", () => {
    const report = generateAuditReport({ ...SAMPLE_INTENT, maxPerTradeUsd: 5 });
    expect(report.allows.some((a) => a.includes("$5") && a.includes("per individual trade"))).toBe(true);
  });

  it("includes per-trade limit in prevents", () => {
    const report = generateAuditReport({ ...SAMPLE_INTENT, maxPerTradeUsd: 10 });
    expect(report.prevents.some((p) => p.includes("$10") && p.includes("single trade"))).toBe(true);
  });

  it("returns empty warnings for safe intents", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.warnings).toEqual([]);
  });

  it("includes warnings for adversarial intents", () => {
    const report = generateAuditReport({
      ...SAMPLE_INTENT,
      dailyBudgetUsd: 5000,
    });
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain("budget");
  });

  it("includes target allocation in allows", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.allows.some((a) => a.includes("ETH: 60%"))).toBe(true);
    expect(report.allows.some((a) => a.includes("USDC: 40%"))).toBe(true);
  });
});
