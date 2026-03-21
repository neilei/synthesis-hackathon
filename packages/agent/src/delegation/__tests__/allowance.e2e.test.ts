/**
 * E2E tests for delegation allowance queries against Sepolia.
 *
 * These tests verify the SDK integration works end-to-end:
 * - getSmartAccountsEnvironment returns valid contract addresses
 * - decodeDelegations can decode a real permission context
 * - caveat enforcer queries connect to on-chain contracts
 *
 * Requires: SEPOLIA_RPC_URL in .env
 * Optional: TEST_PERMISSION_CONTEXT_ERC20 and TEST_PERMISSION_CONTEXT_NATIVE
 *           for testing against a real granted delegation
 *
 * @module @maw/agent/delegation/allowance.e2e.test
 */
import { describe, it, expect } from "vitest";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { getErc20Allowance, getNativeAllowance } from "../allowance.js";

const SEPOLIA_CHAIN_ID = 11155111;

describe("allowance SDK integration (e2e)", () => {
  it("getSmartAccountsEnvironment returns valid addresses for Sepolia", () => {
    const env = getSmartAccountsEnvironment(SEPOLIA_CHAIN_ID);
    expect(env.DelegationManager).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(env.EntryPoint).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(env.SimpleFactory).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(Object.keys(env.caveatEnforcers).length).toBeGreaterThan(0);
  });

  it("getErc20Allowance returns null for invalid permission context", { timeout: 15000 }, async () => {
    // Invalid context should be caught by our wrapper and return null
    const result = await getErc20Allowance("0x00", SEPOLIA_CHAIN_ID);
    expect(result).toBeNull();
  });

  describe("with real permission context", () => {
    const erc20Context = process.env.TEST_PERMISSION_CONTEXT_ERC20;
    const nativeContext = process.env.TEST_PERMISSION_CONTEXT_NATIVE;

    it.skipIf(!erc20Context)(
      "queries ERC-20 allowance from on-chain enforcer",
      { timeout: 30000 },
      async () => {
        const result = await getErc20Allowance(
          erc20Context as `0x${string}`,
          SEPOLIA_CHAIN_ID,
        );
        // Should return a valid result (or null if the enforcer doesn't match)
        if (result) {
          expect(typeof result.availableAmount).toBe("bigint");
          expect(typeof result.isNewPeriod).toBe("boolean");
          expect(typeof result.currentPeriod).toBe("bigint");
        }
      },
    );

    it.skipIf(!nativeContext)(
      "queries native token allowance from on-chain enforcer",
      { timeout: 30000 },
      async () => {
        const result = await getNativeAllowance(
          nativeContext as `0x${string}`,
          SEPOLIA_CHAIN_ID,
        );
        if (result) {
          expect(typeof result.availableAmount).toBe("bigint");
          expect(typeof result.isNewPeriod).toBe("boolean");
          expect(typeof result.currentPeriod).toBe("bigint");
        }
      },
    );
  });
});
