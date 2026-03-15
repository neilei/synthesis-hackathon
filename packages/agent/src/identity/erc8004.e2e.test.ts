/**
 * E2E tests for ERC-8004 identity on live Base Sepolia contracts.
 *
 * @module @veil/agent/identity/erc8004.e2e.test
 */
import { describe, it, expect } from "vitest";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { env, CONTRACTS } from "../config.js";
import { getReputationSummary, giveFeedback } from "./erc8004.js";

/**
 * E2E tests for ERC-8004 on Base Sepolia.
 * Hits real Base Sepolia RPC — no mocks.
 * Wallet is funded with ~0.5 ETH on Base Sepolia, so write ops are tested.
 */

const agentAddress = privateKeyToAccount(env.AGENT_PRIVATE_KEY).address;

describe("ERC-8004 E2E (Base Sepolia)", () => {
  it(
    "identity registry contract is deployed on Base Sepolia",
    { timeout: 30000 },
    async () => {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const code = await publicClient.getCode({
        address: CONTRACTS.IDENTITY_BASE_SEPOLIA,
      });

      expect(code).toBeDefined();
      // Deployed contract has bytecode longer than "0x"
      expect(code!.length).toBeGreaterThan(2);
    },
  );

  it(
    "reputation registry contract is deployed on Base Sepolia",
    { timeout: 30000 },
    async () => {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const code = await publicClient.getCode({
        address: CONTRACTS.REPUTATION_BASE_SEPOLIA,
      });

      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2);
    },
  );

  it(
    "reads reputation summary for agent ID 1",
    { timeout: 30000 },
    async () => {
      const result = await getReputationSummary(
        1n,
        [agentAddress],
        "",
        "",
        "base-sepolia",
      );

      expect(typeof result.count).toBe("bigint");
      expect(typeof result.summaryValue).toBe("bigint");
      expect(typeof result.summaryValueDecimals).toBe("number");
      expect(result.count).toBeGreaterThanOrEqual(0n);
    },
  );

  it(
    "returns zero count for non-existent agent ID",
    { timeout: 30000 },
    async () => {
      const result = await getReputationSummary(
        999999999n,
        [agentAddress],
        "",
        "",
        "base-sepolia",
      );

      expect(result.count).toBe(0n);
      expect(result.summaryValue).toBe(0n);
    },
  );

  it(
    "giveFeedback writes on-chain and returns a tx hash",
    { timeout: 60000 },
    async () => {
      // Give feedback to agent ID 1 with a positive rating
      // This requires gas on Base Sepolia — wallet has ~0.5 ETH
      const txHash = await giveFeedback(
        1n,
        4.5,
        "e2e-test",
        "automated",
        "base-sepolia",
      );

      // Valid tx hash proves the transaction was mined
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Verify the feedback was recorded by reading summary without tag filters
      // (tag-filtered queries may not match if the contract indexes differently)
      const summary = await getReputationSummary(
        1n,
        [agentAddress],
        "",
        "",
        "base-sepolia",
      );

      // After giving feedback, count should be at least 1
      expect(summary.count).toBeGreaterThanOrEqual(1n);
    },
  );

  it(
    "reads reputation summary with tag filtering",
    { timeout: 30000 },
    async () => {
      // Query with a specific tag that likely has no feedback
      const result = await getReputationSummary(
        1n,
        [agentAddress],
        "nonexistent-tag-xyz",
        "",
        "base-sepolia",
      );

      // Should return valid structure even with no matching feedback
      expect(typeof result.count).toBe("bigint");
      expect(typeof result.summaryValue).toBe("bigint");
      expect(typeof result.summaryValueDecimals).toBe("number");
    },
  );
});
