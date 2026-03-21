/**
 * Unit tests for ERC-7710 pull functions via erc7710WalletActions.
 *
 * @module @veil/agent/delegation/redeemer.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Hex, Address } from "viem";

// Use vi.hoisted so mock fns are available inside vi.mock factories
const {
  mockSendTransaction,
  mockSendTransactionWithDelegation,
  mockGetCode,
  mockWaitForTransactionReceipt,
} = vi.hoisted(() => ({
  mockSendTransaction: vi.fn().mockResolvedValue("0xDeployTx" as Hex),
  mockSendTransactionWithDelegation: vi.fn().mockResolvedValue("0xPullTx" as Hex),
  mockGetCode: vi.fn().mockResolvedValue("0x1234"),
  mockWaitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: vi.fn().mockReturnValue({
      account: { address: "0xAgentAddress" },
      chain: { id: 1, name: "mock" },
      sendTransaction: mockSendTransaction,
      extend: vi.fn().mockReturnValue({
        sendTransactionWithDelegation: mockSendTransactionWithDelegation,
      }),
    }),
    createPublicClient: vi.fn().mockReturnValue({
      getCode: mockGetCode,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    }),
    http: vi.fn().mockReturnValue("http-transport"),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: "0xAgentAddress",
    type: "local",
  }),
}));

vi.mock("@metamask/smart-accounts-kit/actions", () => ({
  erc7710WalletActions: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../../config.js", () => ({
  rpcTransport: vi.fn().mockReturnValue("http-transport"),
}));

vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  pullNativeToken,
  pullErc20Token,
  deploySmartAccountIfNeeded,
} from "../redeemer.js";

const chain = { id: 11155111, name: "sepolia" } as Parameters<typeof pullNativeToken>[0]["chain"];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCode.mockResolvedValue("0x1234"); // default: deployed
  mockSendTransactionWithDelegation.mockResolvedValue("0xPullTx" as Hex);
});

describe("deploySmartAccountIfNeeded", () => {
  it("returns null if smart account is already deployed", async () => {
    mockGetCode.mockResolvedValue("0x1234");
    const result = await deploySmartAccountIfNeeded({
      agentKey: "0xabc123" as `0x${string}`,
      chain,
      smartAccountAddress: "0xSmartAccount" as Address,
      dependencies: [],
    });
    expect(result).toBeNull();
  });

  it("deploys using first dependency factory if not deployed", async () => {
    mockGetCode.mockResolvedValue("0x");
    mockSendTransaction.mockResolvedValueOnce("0xDeployTx" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });

    const result = await deploySmartAccountIfNeeded({
      agentKey: "0xabc123" as `0x${string}`,
      chain,
      smartAccountAddress: "0xSmartAccount" as Address,
      dependencies: [
        { factory: "0xFactory" as Address, factoryData: "0xFactoryData" as Hex },
      ],
    });

    expect(result).toBe("0xDeployTx");
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xFactory",
        data: "0xFactoryData",
      }),
    );
  });

  it("throws if not deployed and no dependencies", async () => {
    mockGetCode.mockResolvedValue("0x");
    await expect(
      deploySmartAccountIfNeeded({
        agentKey: "0xabc123" as `0x${string}`,
        chain,
        smartAccountAddress: "0xSmartAccount" as Address,
        dependencies: [],
      }),
    ).rejects.toThrow("no dependencies provided");
  });

  it("throws if deployment receipt is not success", async () => {
    mockGetCode.mockResolvedValue("0x");
    mockSendTransaction.mockResolvedValueOnce("0xDeployTx" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });

    await expect(
      deploySmartAccountIfNeeded({
        agentKey: "0xabc123" as `0x${string}`,
        chain,
        smartAccountAddress: "0xSmartAccount" as Address,
        dependencies: [
          { factory: "0xFactory" as Address, factoryData: "0xFactoryData" as Hex },
        ],
      }),
    ).rejects.toThrow("deployment failed");
  });
});

describe("pullNativeToken", () => {
  it("calls sendTransactionWithDelegation with correct params", async () => {
    const result = await pullNativeToken({
      agentKey: "0xabc123" as `0x${string}`,
      chain,
      agentAddress: "0xAgentAddress" as Address,
      amount: 100000000000000000n,
      permissionsContext: "0xdeadbeef" as Hex,
      delegationManager: "0xDelegationManager" as Address,
    });

    expect(mockSendTransactionWithDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xAgentAddress",
        data: "0x",
        value: 100000000000000000n,
        permissionsContext: "0xdeadbeef",
        delegationManager: "0xDelegationManager",
      }),
    );
    expect(result).toBe("0xPullTx");
  });
});

describe("pullErc20Token", () => {
  it("encodes transfer() calldata for ERC-20 pull", async () => {
    const result = await pullErc20Token({
      agentKey: "0xabc123" as `0x${string}`,
      chain,
      agentAddress: "0xf13021F02E23a8113C1bD826575a1682F6Fac927" as Address,
      tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
      amount: 200000000n,
      permissionsContext: "0xdeadbeef" as Hex,
      delegationManager: "0xDelegationManager" as Address,
    });

    expect(mockSendTransactionWithDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        value: 0n,
        permissionsContext: "0xdeadbeef",
        delegationManager: "0xDelegationManager",
      }),
    );
    // Verify data starts with transfer() selector (0xa9059cbb)
    const call = mockSendTransactionWithDelegation.mock.calls[0][0];
    expect(call.data.startsWith("0xa9059cbb")).toBe(true);
    expect(result).toBe("0xPullTx");
  });
});
