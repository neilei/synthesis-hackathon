/**
 * E2E tests for the full delegation creation and signing flow on Sepolia.
 *
 * @module @veil/agent/delegation/delegation.e2e.test
 */
import { describe, it, expect } from "vitest";
import { encodePacked } from "viem";
import type { Address, Hex } from "viem";
import { createDelegationFromIntent } from "../compiler.js";
import { generateAuditReport } from "../audit.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import type { IntentParse } from "../../venice/schemas.js";

describe("Delegation creation + signing (e2e)", () => {
  // Use real MetaMask Smart Accounts Kit — off-chain only, no gas
  const delegatorKey = generatePrivateKey();
  const agentKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentKey);

  const testIntent: IntentParse = {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  };

  it(
    "creates and signs a delegation from intent",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        testIntent,
        delegatorKey,
        agentAccount.address,
        11155111, // Sepolia
      );

      expect(result).toBeDefined();
      expect(result.delegation).toBeDefined();
      expect(result.delegation.signature).toBeDefined();
      expect(typeof result.delegation.signature).toBe("string");
      expect(result.delegation.signature).not.toBe("0x");
      expect(result.delegation.signature!.length).toBeGreaterThan(10);
      expect(result.delegatorSmartAccount).toBeDefined();
      expect(result.delegatorSmartAccount.address).toBeDefined();

      console.log("Delegation created:", {
        delegatorSmartAccount: result.delegatorSmartAccount.address,
        signature: result.delegation.signature?.slice(0, 20) + "...",
      });
    },
  );

  it(
    "includes ValueLteEnforcer caveat with correct encoding",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        testIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const environment = getSmartAccountsEnvironment(11155111);
      const valueLteAddress = environment.caveatEnforcers.ValueLteEnforcer as Address;

      const caveats = result.delegation.caveats;

      // Find ALL ValueLteEnforcer caveats
      const valueLteCaveats = caveats.filter(
        (c: { enforcer: string }) => c.enforcer.toLowerCase() === valueLteAddress.toLowerCase(),
      );

      // Should have exactly ONE ValueLteEnforcer (from the scope config, not a manual caveat)
      expect(valueLteCaveats).toHaveLength(1);

      // Verify encoding: 200 * 7 / 500 = 2.8 ETH => ceil(2.8e18) wei
      const expectedMaxValueWei = BigInt(Math.ceil(2.8 * 1e18));
      const expectedTerms = encodePacked(["uint256"], [expectedMaxValueWei]);
      expect(valueLteCaveats[0]!.terms).toBe(expectedTerms);

      // Should have 5 caveats total: AllowedTargets, AllowedMethods, ValueLte (from scope),
      // TimestampEnforcer, LimitedCallsEnforcer (from our manual caveats)
      expect(caveats).toHaveLength(5);

      console.log("ValueLteEnforcer caveat verified:", {
        enforcer: valueLteCaveats[0]!.enforcer,
        terms: (valueLteCaveats[0]!.terms as string).slice(0, 20) + "...",
        totalCaveats: caveats.length,
      });
    },
  );

  it(
    "generates audit report for delegation",
    { timeout: 30000 },
    async () => {
      const result = await createDelegationFromIntent(
        testIntent,
        delegatorKey,
        agentAccount.address,
        11155111,
      );

      const report = generateAuditReport(testIntent, result.delegation);

      expect(report.allows.length).toBeGreaterThan(0);
      expect(report.prevents.length).toBeGreaterThan(0);
      expect(report.worstCase).toContain("$");
      expect(report.warnings).toHaveLength(0); // safe intent, no warnings
      expect(report.formatted).toContain("ALLOWS");
      expect(report.formatted).toContain("PREVENTS");
      expect(report.formatted).toContain("WORST CASE");

      console.log("\n" + report.formatted);
    },
  );
});
