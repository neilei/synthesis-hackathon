/**
 * E2E tests for Permit2 approval against live Sepolia contracts.
 *
 * @module @veil/agent/uniswap/permit2.e2e.test
 */
import { describe, it, expect } from "vitest";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env, CONTRACTS } from "../../config.js";
import { ensurePermit2Approval, signPermit2Data } from "../permit2.js";

/**
 * E2E tests for Permit2 on Sepolia.
 * These hit real Sepolia RPC.
 */

describe("Permit2 E2E (Sepolia)", () => {
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  it("Permit2 contract is deployed on Sepolia", async () => {
    const code = await publicClient.getCode({
      address: CONTRACTS.PERMIT2,
    });

    expect(code).toBeDefined();
    expect(code!.length).toBeGreaterThan(2);
  });

  it("can check USDC allowance for Permit2 on Sepolia", async () => {
    // This reads the ERC-20 allowance — should not throw
    const allowance = await publicClient.readContract({
      address: CONTRACTS.USDC_SEPOLIA,
      abi: [
        {
          name: "allowance",
          type: "function",
          stateMutability: "view",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "allowance",
      args: [account.address, CONTRACTS.PERMIT2],
    });

    expect(typeof allowance).toBe("bigint");
    expect(allowance).toBeGreaterThanOrEqual(0n);
  });

  it("signPermit2Data signs typed data correctly", async () => {
    const permitData = {
      domain: {
        name: "Permit2",
        chainId: 11155111,
        verifyingContract: CONTRACTS.PERMIT2,
      },
      types: {
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      values: {
        permitted: {
          token: CONTRACTS.USDC_SEPOLIA,
          amount: "1000000",
        },
        spender: "0x0000000000000000000000000000000000000001",
        nonce: "0",
        deadline: "9999999999",
      },
    };

    const signature = await signPermit2Data(walletClient, permitData);

    expect(signature).toBeDefined();
    expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);
    // EIP-712 signatures are 65 bytes = 130 hex chars + "0x" prefix
    expect(signature.length).toBe(132);
  });
});
