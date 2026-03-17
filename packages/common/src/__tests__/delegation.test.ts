import { describe, it, expect } from "vitest";
import {
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
  detectAdversarialIntent,
  generateAuditReport,
} from "../delegation.js";
import type { ParsedIntent } from "../schemas.js";

const SAMPLE_INTENT: ParsedIntent = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  maxTradesPerDay: 10,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

describe("computeMaxValueWei", () => {
  it("computes max ETH value in wei using conservative price", () => {
    // (200 * 7) / 500 = 2.8 ETH = 2.8e18 wei
    const result = computeMaxValueWei(200, 7);
    expect(result).toBe(BigInt("2800000000000000000"));
  });

  it("accepts custom conservative price", () => {
    // (200 * 7) / 1000 = 1.4 ETH
    const result = computeMaxValueWei(200, 7, 1000);
    expect(result).toBe(BigInt("1400000000000000000"));
  });

  it("handles small budget", () => {
    // (10 * 1) / 500 = 0.02 ETH
    const result = computeMaxValueWei(10, 1);
    expect(result).toBe(BigInt("20000000000000000"));
  });
});

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

describe("computeMaxCalls", () => {
  it("computes total calls from trades per day and days", () => {
    expect(computeMaxCalls(10, 7)).toBe(70);
  });

  it("works with 1 trade per day", () => {
    expect(computeMaxCalls(1, 30)).toBe(30);
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
