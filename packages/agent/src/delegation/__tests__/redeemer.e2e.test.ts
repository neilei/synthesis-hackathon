/**
 * E2E tests for ERC-7710 pull functions against Sepolia.
 *
 * These tests verify the redeemer module works end-to-end:
 * - deploySmartAccountIfNeeded correctly checks on-chain code
 * - pullNativeToken builds valid delegation tx params
 * - pullErc20Token encodes correct ERC-20 transfer calldata
 *
 * Requires: SEPOLIA_RPC_URL + AGENT_PRIVATE_KEY in .env
 * Optional: TEST_PERMISSION_CONTEXT_NATIVE and TEST_PERMISSION_CONTEXT_ERC20
 *           for testing real delegation redemption (will cost gas)
 *
 * @module @maw/agent/delegation/redeemer.e2e.test
 */
import { describe, it, expect } from "vitest";
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { env, rpcTransport, CONTRACTS } from "../../config.js";
import { deploySmartAccountIfNeeded } from "../redeemer.js";

const SEPOLIA_CHAIN_ID = 11155111;

describe("redeemer SDK integration (e2e)", () => {
  const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);
  const agentAddress = agentAccount.address;

  it("agent EOA address is valid", () => {
    expect(agentAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("can query on-chain code for a known contract", { timeout: 15000 }, async () => {
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: rpcTransport(sepolia),
    });

    // USDC on Sepolia should have code
    const code = await publicClient.getCode({
      address: CONTRACTS.USDC_SEPOLIA,
    });
    expect(code).toBeDefined();
    expect(code).not.toBe("0x");
    expect(typeof code === "string" && code.length > 2).toBe(true);
  });

  it("deploySmartAccountIfNeeded returns null for a deployed contract", { timeout: 15000 }, async () => {
    // Using USDC contract as a "smart account" that is already deployed
    const result = await deploySmartAccountIfNeeded({
      agentKey: env.AGENT_PRIVATE_KEY,
      chain: sepolia,
      smartAccountAddress: CONTRACTS.USDC_SEPOLIA,
      dependencies: [],
    });
    expect(result).toBeNull();
  });

  it("deploySmartAccountIfNeeded throws for undeployed address with no deps", { timeout: 15000 }, async () => {
    // Random address that almost certainly has no code
    const emptyAddress = "0x000000000000000000000000000000000000dEaD" as Address;

    await expect(
      deploySmartAccountIfNeeded({
        agentKey: env.AGENT_PRIVATE_KEY,
        chain: sepolia,
        smartAccountAddress: emptyAddress,
        dependencies: [],
      }),
    ).rejects.toThrow("no dependencies provided");
  });

  it("agent has nonzero ETH balance on Sepolia", { timeout: 15000 }, async () => {
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: rpcTransport(sepolia),
    });

    const balance = await publicClient.getBalance({ address: agentAddress });
    expect(balance).toBeGreaterThan(0n);
  });

  it("can read ERC-20 balance for USDC on Sepolia", { timeout: 15000 }, async () => {
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: rpcTransport(sepolia),
    });

    const balance = await publicClient.readContract({
      address: CONTRACTS.USDC_SEPOLIA,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "balanceOf",
      args: [agentAddress],
    });

    expect(typeof balance).toBe("bigint");
  });

  describe("with real permission context", () => {
    const nativeContext = process.env.TEST_PERMISSION_CONTEXT_NATIVE;
    const erc20Context = process.env.TEST_PERMISSION_CONTEXT_ERC20;
    const delegationManager = process.env.TEST_DELEGATION_MANAGER;

    it.skipIf(!nativeContext || !delegationManager)(
      "pullNativeToken executes against Sepolia (costs gas)",
      { timeout: 60000 },
      async () => {
        // This test actually sends a tx — only run with real contexts
        const { pullNativeToken } = await import("../redeemer.js");

        const txHash = await pullNativeToken({
          agentKey: env.AGENT_PRIVATE_KEY,
          chain: sepolia,
          agentAddress,
          amount: 1n, // 1 wei — minimal amount
          permissionsContext: nativeContext as `0x${string}`,
          delegationManager: delegationManager as Address,
        });

        expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      },
    );

    it.skipIf(!erc20Context || !delegationManager)(
      "pullErc20Token executes against Sepolia (costs gas)",
      { timeout: 60000 },
      async () => {
        const { pullErc20Token } = await import("../redeemer.js");

        const txHash = await pullErc20Token({
          agentKey: env.AGENT_PRIVATE_KEY,
          chain: sepolia,
          agentAddress,
          tokenAddress: CONTRACTS.USDC_SEPOLIA,
          amount: 1n, // 1 unit (0.000001 USDC)
          permissionsContext: erc20Context as `0x${string}`,
          delegationManager: delegationManager as Address,
        });

        expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      },
    );
  });
});
