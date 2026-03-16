/**
 * Unit tests for audit report generation: allows, prevents, worst-case, warnings.
 *
 * @module @veil/agent/delegation/audit.test
 */
import { describe, it, expect } from "vitest";
import { generateAuditReport } from "../audit.js";
import type { IntentParse } from "../../venice/schemas.js";

// ---------------------------------------------------------------------------
// Helper: create sample data
// ---------------------------------------------------------------------------

function makeSampleIntent(overrides: Partial<IntentParse> = {}): IntentParse {
  return {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
    ...overrides,
  };
}

function makeSampleDelegation(overrides: Record<string, unknown> = {}) {
  return {
    delegate: "0xagent",
    delegator: "0xdelegator",
    authority:
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    caveats: [
      {
        enforcer: "0x1234",
        terms: "0x",
        args: "0x",
      },
    ],
    salt: "0x01",
    signature: "0xsigned",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Audit report generation
// ---------------------------------------------------------------------------

describe("generateAuditReport", () => {
  it("returns a report with all required sections", () => {
    const intent = makeSampleIntent();
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

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
    const intent = makeSampleIntent({ dailyBudgetUsd: 500, timeWindowDays: 14 });
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.allows.some((a) => a.includes("$500/day"))).toBe(true);
    expect(report.allows.some((a) => a.includes("14 days"))).toBe(true);
  });

  it("includes total budget cap in PREVENTS section", () => {
    const intent = makeSampleIntent({ dailyBudgetUsd: 200, timeWindowDays: 7 });
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    // Total = 200 * 7 = 1400
    expect(report.prevents.some((p) => p.includes("1,400"))).toBe(true);
  });

  it("calculates WORST CASE including slippage", () => {
    const intent = makeSampleIntent({
      dailyBudgetUsd: 1000,
      timeWindowDays: 10,
      maxSlippage: 0.01,
    });
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    // Total = 10,000, slippage = 10,000 * 0.01 = 100
    expect(report.worstCase).toContain("10,000");
    expect(report.worstCase).toContain("100.00");
  });

  it("includes allocation description in ALLOWS", () => {
    const intent = makeSampleIntent({
      targetAllocation: { ETH: 0.7, USDC: 0.3 },
    });
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.allows.some((a) => a.includes("ETH: 70%"))).toBe(true);
    expect(report.allows.some((a) => a.includes("USDC: 30%"))).toBe(true);
  });

  it("shows caveats present when delegation has caveats", () => {
    const intent = makeSampleIntent();
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.intentMatch).toContain("Caveats present: YES");
  });

  it("warns when delegation has no caveats", () => {
    const intent = makeSampleIntent();
    const delegation = makeSampleDelegation({ caveats: [] });
    const report = generateAuditReport(intent, delegation);

    expect(report.intentMatch).toContain("Caveats present: NO");
    expect(
      report.warnings.some((w) => w.includes("CRITICAL") && w.includes("unrestricted")),
    ).toBe(true);
  });

  it("includes adversarial warnings for dangerous intents", () => {
    const intent = makeSampleIntent({
      dailyBudgetUsd: 5000,
      timeWindowDays: 60,
      maxSlippage: 0.1,
    });
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.warnings.length).toBeGreaterThanOrEqual(3);
    expect(report.warnings.some((w) => w.includes("$5000"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("60 days"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("10.0%"))).toBe(true);
  });

  it("has no warnings for a safe intent with proper delegation", () => {
    const intent = makeSampleIntent();
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.warnings).toHaveLength(0);
  });

  it("formatted report contains proper section markers", () => {
    const intent = makeSampleIntent();
    const delegation = makeSampleDelegation();
    const report = generateAuditReport(intent, delegation);

    expect(report.formatted).toContain("=== DELEGATION AUDIT REPORT ===");
    expect(report.formatted).toContain("--- ALLOWS ---");
    expect(report.formatted).toContain("--- PREVENTS ---");
    expect(report.formatted).toContain("--- WORST CASE ---");
    expect(report.formatted).toContain("--- INTENT MATCH ---");
    expect(report.formatted).toContain("=== END AUDIT REPORT ===");
  });

  it("shows signature status in intent match", () => {
    const intent = makeSampleIntent();

    const signed = makeSampleDelegation({ signature: "0xabc123" });
    const reportSigned = generateAuditReport(intent, signed);
    expect(reportSigned.intentMatch).toContain("Signed: YES");

    const unsigned = makeSampleDelegation({ signature: "0x" });
    const reportUnsigned = generateAuditReport(intent, unsigned);
    expect(reportUnsigned.intentMatch).toContain("Signed: NO");
  });

  it("shows delegate/delegator presence", () => {
    const intent = makeSampleIntent();

    const withAddrs = makeSampleDelegation();
    const report = generateAuditReport(intent, withAddrs);
    expect(report.intentMatch).toContain("Delegate/Delegator set: YES");

    const without = { caveats: [], salt: "0x01", signature: "0xabc" };
    const reportNo = generateAuditReport(intent, without);
    expect(reportNo.intentMatch).toContain("Delegate/Delegator set: NO");
  });
});
