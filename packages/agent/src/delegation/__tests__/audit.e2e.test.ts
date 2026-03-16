/**
 * E2E tests for audit report generation with real delegation objects.
 *
 * @module @veil/agent/delegation/audit.e2e.test
 */
import { describe, it, expect } from "vitest";
import { generateAuditReport } from "../audit.js";
import { createDelegationFromIntent } from "../compiler.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { IntentParse } from "../../venice/schemas.js";

describe("Audit report generation (e2e)", () => {
  const delegatorKey = generatePrivateKey();
  const agentKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentKey);

  const safeIntent: IntentParse = {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  };

  it(
    "generates a complete audit report from a real delegation",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      // All sections should be populated
      expect(report.allows).toBeDefined();
      expect(report.allows.length).toBeGreaterThan(0);

      expect(report.prevents).toBeDefined();
      expect(report.prevents.length).toBeGreaterThan(0);

      expect(report.worstCase).toBeDefined();
      expect(report.worstCase).toContain("$");
      expect(report.worstCase.length).toBeGreaterThan(0);

      expect(report.intentMatch).toBeDefined();
      expect(report.intentMatch.length).toBeGreaterThan(0);

      expect(report.formatted).toBeDefined();
      expect(report.formatted.length).toBeGreaterThan(0);

      // Formatted report should contain all section headers
      expect(report.formatted).toContain("DELEGATION AUDIT REPORT");
      expect(report.formatted).toContain("ALLOWS");
      expect(report.formatted).toContain("PREVENTS");
      expect(report.formatted).toContain("WORST CASE");
      expect(report.formatted).toContain("INTENT MATCH");
      expect(report.formatted).toContain("END AUDIT REPORT");

      console.log("\n" + report.formatted);
    },
  );

  it(
    "reports correct allows content for the intent",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      // Check specific allows content
      expect(report.allows.some((a) => a.includes("$200/day"))).toBe(true);
      expect(report.allows.some((a) => a.includes("7 days"))).toBe(true);
      expect(report.allows.some((a) => a.includes("10 trades per day"))).toBe(
        true,
      );
      expect(report.allows.some((a) => a.includes("0.5%"))).toBe(true); // slippage
      expect(report.allows.some((a) => a.includes("5.0%"))).toBe(true); // drift
      expect(report.allows.some((a) => a.includes("ETH"))).toBe(true);
      expect(report.allows.some((a) => a.includes("USDC"))).toBe(true);
    },
  );

  it(
    "reports correct prevents content for the intent",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      // $200/day * 7 days = $1,400 total
      expect(report.prevents.some((p) => p.includes("1,400"))).toBe(true);
      // 10 trades/day * 7 days = 70 total
      expect(report.prevents.some((p) => p.includes("70 trades"))).toBe(true);
      expect(
        report.prevents.some((p) => p.includes("non-approved contract")),
      ).toBe(true);
    },
  );

  it(
    "worst case calculation is correct",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      // Total budget = $200 * 7 = $1,400
      // Slippage loss = $1,400 * 0.005 = $7.00
      // Total = $1,407
      expect(report.worstCase).toContain("1,400");
      expect(report.worstCase).toContain("7.00");
      expect(report.worstCase).toContain("7 days");
    },
  );

  it(
    "intent match reports caveats, delegate/delegator, and signature",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      // A real signed delegation should have all three
      expect(report.intentMatch).toContain("Caveats present: YES");
      expect(report.intentMatch).toContain("Delegate/Delegator set: YES");
      expect(report.intentMatch).toContain("Signed: YES");
    },
  );

  it(
    "safe intent produces no warnings",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        safeIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(safeIntent, result.delegation);

      expect(report.warnings).toHaveLength(0);
      expect(report.formatted).not.toContain("WARNINGS");
    },
  );

  it(
    "adversarial intent produces warnings",
    { timeout: 30000 },
    async () => {
      const adversarialIntent: IntentParse = {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 5000, // exceeds $1,000 threshold
        timeWindowDays: 60, // exceeds 30-day threshold
        maxTradesPerDay: 10,
        maxSlippage: 0.05, // exceeds 2% threshold
        driftThreshold: 0.05,
      };

      const result = await createDelegationFromIntent(
        adversarialIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(adversarialIntent, result.delegation);

      expect(report.warnings.length).toBeGreaterThanOrEqual(3);
      expect(report.warnings.some((w) => w.includes("Daily budget"))).toBe(
        true,
      );
      expect(report.warnings.some((w) => w.includes("Time window"))).toBe(
        true,
      );
      expect(report.warnings.some((w) => w.includes("slippage"))).toBe(true);
      expect(report.formatted).toContain("WARNINGS");

      console.log(
        "Adversarial warnings:",
        report.warnings,
      );
    },
  );
});
