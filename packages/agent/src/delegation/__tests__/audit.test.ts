/**
 * Unit tests for audit report generation: allows, prevents, worst-case, warnings.
 *
 * @module @veil/agent/delegation/audit.test
 */
import { describe, it, expect } from "vitest";
import { generateDetailedAudit } from "../audit.js";
import { makeIntent } from "../../__tests__/fixtures.js";

// ---------------------------------------------------------------------------
// Audit report generation
// ---------------------------------------------------------------------------

describe("generateDetailedAudit", () => {
  it("returns a report with all required sections", () => {
    const intent = makeIntent();
    const report = generateDetailedAudit(intent);

    expect(report.allows).toBeInstanceOf(Array);
    expect(report.prevents).toBeInstanceOf(Array);
    expect(report.worstCase).toBeDefined();
    expect(report.intentMatch).toBeDefined();
    expect(report.formatted).toContain("ALLOWS");
    expect(report.formatted).toContain("PREVENTS");
    expect(report.formatted).toContain("WORST CASE");
    expect(report.formatted).toContain("INTENT MATCH");
  });

  it("includes correct budget in ALLOWS section", () => {
    const intent = makeIntent({ dailyBudgetUsd: 500, timeWindowDays: 14 });
    const report = generateDetailedAudit(intent);

    expect(report.allows.some((a) => a.includes("$500/day"))).toBe(true);
    expect(report.allows.some((a) => a.includes("14 days"))).toBe(true);
  });

  it("includes total budget cap in PREVENTS section", () => {
    const intent = makeIntent({ dailyBudgetUsd: 200, timeWindowDays: 7 });
    const report = generateDetailedAudit(intent);

    // Total = 200 * 7 = 1400
    expect(report.prevents.some((p) => p.includes("1,400"))).toBe(true);
  });

  it("calculates WORST CASE including slippage", () => {
    const intent = makeIntent({
      dailyBudgetUsd: 1000,
      timeWindowDays: 10,
      maxSlippage: 0.01,
    });
    const report = generateDetailedAudit(intent);

    // Total = 10,000, slippage = 10,000 * 0.01 = 100
    expect(report.worstCase).toContain("10,000");
    expect(report.worstCase).toContain("100.00");
  });

  it("includes allocation description in ALLOWS", () => {
    const intent = makeIntent({
      targetAllocation: { ETH: 0.7, USDC: 0.3 },
    });
    const report = generateDetailedAudit(intent);

    expect(report.allows.some((a) => a.includes("ETH: 70%"))).toBe(true);
    expect(report.allows.some((a) => a.includes("USDC: 30%"))).toBe(true);
  });

  it("shows permission info when provided", () => {
    const intent = makeIntent();
    const report = generateDetailedAudit(intent, {
      permissionCount: 2,
      types: ["native-token-periodic", "erc20-token-periodic"],
      hasDelegationManager: true,
    });

    expect(report.intentMatch).toContain("Permissions granted: 2");
    expect(report.intentMatch).toContain("native-token-periodic");
    expect(report.intentMatch).toContain("DelegationManager: YES");
  });

  it("shows pending status when no permission info provided", () => {
    const intent = makeIntent();
    const report = generateDetailedAudit(intent);

    expect(report.intentMatch).toContain("pending user grant");
  });

  it("includes adversarial warnings for dangerous intents", () => {
    const intent = makeIntent({
      dailyBudgetUsd: 5000,
      timeWindowDays: 60,
      maxSlippage: 0.1,
    });
    const report = generateDetailedAudit(intent);

    expect(report.warnings.length).toBeGreaterThanOrEqual(3);
    expect(report.warnings.some((w) => w.includes("$5000"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("60 days"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("10.0%"))).toBe(true);
  });

  it("includes per-trade limit in ALLOWS section", () => {
    const intent = makeIntent({ maxPerTradeUsd: 5 });
    const report = generateDetailedAudit(intent);

    expect(report.allows.some((a) => a.includes("$5") && a.includes("per individual trade"))).toBe(true);
  });

  it("includes per-trade limit in PREVENTS section", () => {
    const intent = makeIntent({ maxPerTradeUsd: 10 });
    const report = generateDetailedAudit(intent);

    expect(report.prevents.some((p) => p.includes("$10") && p.includes("single trade"))).toBe(true);
  });

  it("has no warnings for a safe intent", () => {
    const intent = makeIntent();
    const report = generateDetailedAudit(intent);

    expect(report.warnings).toHaveLength(0);
  });

  it("formatted report contains proper section markers", () => {
    const intent = makeIntent();
    const report = generateDetailedAudit(intent);

    expect(report.formatted).toContain("=== DELEGATION AUDIT REPORT ===");
    expect(report.formatted).toContain("--- ALLOWS ---");
    expect(report.formatted).toContain("--- PREVENTS ---");
    expect(report.formatted).toContain("--- WORST CASE ---");
    expect(report.formatted).toContain("--- INTENT MATCH ---");
    expect(report.formatted).toContain("=== END AUDIT REPORT ===");
  });
});
