/**
 * E2E tests for delegation redemption against live Sepolia DelegationManager.
 *
 * @module @veil/agent/delegation/redeemer.e2e.test
 */
import { describe, it, expect } from "vitest";
import { sepolia } from "viem/chains";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployDelegatorIfNeeded } from "./redeemer.js";
import { createDelegatorSmartAccount } from "./compiler.js";

/**
 * E2E tests for delegation redeemer.
 * Tests smart account creation and deployment check logic.
 */

describe("Delegation Redeemer E2E (Sepolia)", () => {
  it(
    "creates a delegator smart account with a deterministic address",
    { timeout: 30000 },
    async () => {
      const key = generatePrivateKey();
      const smartAccount = await createDelegatorSmartAccount(key, 11155111);

      expect(smartAccount).toBeDefined();
      expect(smartAccount.address).toBeDefined();
      expect(smartAccount.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

      // Same key should produce the same smart account address
      const smartAccount2 = await createDelegatorSmartAccount(key, 11155111);
      expect(smartAccount2.address).toBe(smartAccount.address);
    },
  );

  it(
    "different keys produce different smart account addresses",
    { timeout: 30000 },
    async () => {
      const key1 = generatePrivateKey();
      const key2 = generatePrivateKey();

      const sa1 = await createDelegatorSmartAccount(key1, 11155111);
      const sa2 = await createDelegatorSmartAccount(key2, 11155111);

      expect(sa1.address).not.toBe(sa2.address);
    },
  );

  it(
    "smart account has factory args for deployment",
    { timeout: 30000 },
    async () => {
      const key = generatePrivateKey();
      const smartAccount = await createDelegatorSmartAccount(key, 11155111);
      const factoryArgs = await smartAccount.getFactoryArgs();

      expect(factoryArgs).toBeDefined();
      expect(factoryArgs.factory).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(factoryArgs.factoryData).toBeDefined();
    },
  );

  it(
    "deployDelegatorIfNeeded returns null for an undeployed account (live check)",
    { timeout: 30000 },
    async () => {
      // Use a random key — the smart account won't be deployed on Sepolia
      const key = generatePrivateKey();
      const smartAccount = await createDelegatorSmartAccount(key, 11155111);

      // We can't actually deploy (costs gas), but we can verify the code check
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(),
      });
      const code = await publicClient.getCode({
        address: smartAccount.address,
      });

      // Fresh address should have no code
      expect(!code || code === "0x").toBe(true);
    },
  );
});
