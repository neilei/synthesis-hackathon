/**
 * E2E tests for audit report generation with the new ERC-7715 permissions
 * data shape. Verifies the full pipeline: parse intent → generate audit
 * with permission metadata → verify report structure and content.
 *
 * These tests run without mocks against the real audit module to verify
 * the integration between IntentParse, permission metadata, adversarial
 * detection, and formatted report generation.
 *
 * @module @maw/agent/delegation/audit.e2e.test
 */
import { describe, it, expect } from "vitest";
import { generateDetailedAudit } from "../audit.js";
import type { IntentParse } from "../../venice/schemas.js";

// Representative intents matching what the frontend would send
const STANDARD_INTENT: IntentParse = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  maxTradesPerDay: 10,
  maxPerTradeUsd: 5,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

const AGGRESSIVE_INTENT: IntentParse = {
  targetAllocation: { ETH: 0.9, USDC: 0.1 },
  dailyBudgetUsd: 5000,
  timeWindowDays: 60,
  maxTradesPerDay: 50,
  maxPerTradeUsd: 5000,
  maxSlippage: 0.1,
  driftThreshold: 0.02,
};

const ETH_ONLY_INTENT: IntentParse = {
  targetAllocation: { ETH: 1.0 },
  dailyBudgetUsd: 100,
  timeWindowDays: 3,
  maxTradesPerDay: 5,
  maxPerTradeUsd: 100,
  maxSlippage: 0.01,
  driftThreshold: 0.1,
};

describe("audit report generation with ERC-7715 permissions (e2e)", () => {
  describe("standard intent with both permissions granted", () => {
    const permissionInfo = {
      permissionCount: 2,
      types: ["native-token-periodic", "erc20-token-periodic"],
      hasDelegationManager: true,
    };

    it("generates a complete report with all sections", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      expect(report.allows.length).toBeGreaterThan(0);
      expect(report.prevents.length).toBeGreaterThan(0);
      expect(report.worstCase).toBeTruthy();
      expect(report.intentMatch).toBeTruthy();
      expect(report.formatted).toContain("DELEGATION AUDIT REPORT");
      expect(report.formatted).toContain("END AUDIT REPORT");
    });

    it("reflects correct budget calculations", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      // Daily: $200, Window: 7 days, Total: $1,400
      expect(report.allows.some((a) => a.includes("$200/day"))).toBe(true);
      expect(report.allows.some((a) => a.includes("7 days"))).toBe(true);
      expect(report.prevents.some((p) => p.includes("1,400"))).toBe(true);
    });

    it("includes per-trade limit in both allows and prevents", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      expect(report.allows.some((a) => a.includes("$5") && a.includes("per individual trade"))).toBe(true);
      expect(report.prevents.some((p) => p.includes("$5") && p.includes("single trade"))).toBe(true);
    });

    it("shows correct allocation in allows", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      expect(report.allows.some((a) => a.includes("ETH: 60%"))).toBe(true);
      expect(report.allows.some((a) => a.includes("USDC: 40%"))).toBe(true);
    });

    it("calculates worst case with slippage correctly", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      // Total: $1,400 + slippage: $1,400 * 0.005 = $7.00
      expect(report.worstCase).toContain("1,400");
      expect(report.worstCase).toContain("7.00");
    });

    it("shows granted permissions in intent match", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      expect(report.intentMatch).toContain("Permissions granted: 2");
      expect(report.intentMatch).toContain("native-token-periodic");
      expect(report.intentMatch).toContain("erc20-token-periodic");
      expect(report.intentMatch).toContain("DelegationManager: YES");
    });

    it("has no warnings for a safe standard intent", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, permissionInfo);

      expect(report.warnings).toHaveLength(0);
    });
  });

  describe("intent without permissions (pending grant)", () => {
    it("shows pending status when no permission info", () => {
      const report = generateDetailedAudit(STANDARD_INTENT);

      expect(report.intentMatch).toContain("pending user grant");
      expect(report.intentMatch).toContain("MetaMask Flask");
    });

    it("still generates full allows/prevents/worstCase", () => {
      const report = generateDetailedAudit(STANDARD_INTENT);

      expect(report.allows.length).toBeGreaterThan(0);
      expect(report.prevents.length).toBeGreaterThan(0);
      expect(report.worstCase).toBeTruthy();
    });
  });

  describe("aggressive intent triggers warnings", () => {
    const permissionInfo = {
      permissionCount: 2,
      types: ["native-token-periodic", "erc20-token-periodic"],
      hasDelegationManager: true,
    };

    it("detects high budget warning", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, permissionInfo);

      expect(report.warnings.some((w) => w.includes("$5000"))).toBe(true);
    });

    it("detects long time window warning", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, permissionInfo);

      expect(report.warnings.some((w) => w.includes("60 days"))).toBe(true);
    });

    it("detects high slippage warning", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, permissionInfo);

      expect(report.warnings.some((w) => w.includes("10.0%"))).toBe(true);
    });

    it("calculates correct worst case for aggressive intent", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, permissionInfo);

      // Total: $5000 * 60 = $300,000 + slippage: $300,000 * 0.1 = $30,000
      expect(report.worstCase).toContain("300,000");
      expect(report.worstCase).toContain("30000.00");
    });

    it("formatted report includes WARNING section markers", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, permissionInfo);

      expect(report.formatted).toContain("--- WARNINGS ---");
      expect(report.formatted).toContain("[!]");
    });
  });

  describe("ETH-only intent (single permission type)", () => {
    const permissionInfo = {
      permissionCount: 1,
      types: ["native-token-periodic"],
      hasDelegationManager: true,
    };

    it("shows single permission type", () => {
      const report = generateDetailedAudit(ETH_ONLY_INTENT, permissionInfo);

      expect(report.intentMatch).toContain("Permissions granted: 1");
      expect(report.intentMatch).toContain("native-token-periodic");
      expect(report.intentMatch).not.toContain("erc20-token-periodic");
    });

    it("shows only ETH allocation", () => {
      const report = generateDetailedAudit(ETH_ONLY_INTENT, permissionInfo);

      expect(report.allows.some((a) => a.includes("ETH: 100%"))).toBe(true);
      expect(report.allows.some((a) => a.includes("USDC"))).toBe(false);
    });
  });

  describe("permission info edge cases", () => {
    it("handles zero permissions gracefully", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, {
        permissionCount: 0,
        types: [],
        hasDelegationManager: false,
      });

      expect(report.intentMatch).toContain("Permissions granted: 0");
      expect(report.intentMatch).toContain("DelegationManager: NO");
    });

    it("handles permission without delegation manager", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, {
        permissionCount: 1,
        types: ["native-token-periodic"],
        hasDelegationManager: false,
      });

      expect(report.intentMatch).toContain("DelegationManager: NO");
    });
  });

  describe("formatted report structure", () => {
    it("follows correct section order", () => {
      const report = generateDetailedAudit(STANDARD_INTENT, {
        permissionCount: 2,
        types: ["native-token-periodic", "erc20-token-periodic"],
        hasDelegationManager: true,
      });

      const lines = report.formatted.split("\n");
      const sectionOrder = lines
        .filter((l) => l.startsWith("---") || l.startsWith("==="))
        .map((l) => l.trim());

      expect(sectionOrder[0]).toContain("DELEGATION AUDIT REPORT");
      expect(sectionOrder[1]).toContain("ALLOWS");
      expect(sectionOrder[2]).toContain("PREVENTS");
      expect(sectionOrder[3]).toContain("WORST CASE");
      expect(sectionOrder[4]).toContain("INTENT MATCH");
      expect(sectionOrder[sectionOrder.length - 1]).toContain("END AUDIT REPORT");
    });

    it("uses correct prefixes for items", () => {
      const report = generateDetailedAudit(AGGRESSIVE_INTENT, {
        permissionCount: 2,
        types: ["native-token-periodic", "erc20-token-periodic"],
        hasDelegationManager: true,
      });

      const lines = report.formatted.split("\n");
      // Allows use [+]
      expect(lines.some((l) => l.includes("[+]"))).toBe(true);
      // Prevents use [-]
      expect(lines.some((l) => l.includes("[-]"))).toBe(true);
      // Warnings use [!]
      expect(lines.some((l) => l.includes("[!]"))).toBe(true);
    });
  });
});
