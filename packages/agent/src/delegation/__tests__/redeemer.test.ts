/**
 * Unit tests for delegation redemption: smart account deployment, funding, and redeem encoding.
 *
 * @module @veil/agent/delegation/redeemer.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Hex } from "viem";

// Use vi.hoisted so mock fns are available inside vi.mock factories
const {
  mockSendTransaction,
  mockGetCode,
  mockGetBalance,
  mockWaitForTransactionReceipt,
} = vi.hoisted(() => ({
  mockSendTransaction: vi.fn().mockResolvedValue("0xTxHash"),
  mockGetCode: vi.fn().mockResolvedValue("0x1234"),
  mockGetBalance: vi.fn().mockResolvedValue(1000000000000000000n), // 1 ETH
  mockWaitForTransactionReceipt: vi
    .fn()
    .mockResolvedValue({ status: "success" }),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createWalletClient: vi.fn().mockReturnValue({
      account: { address: "0xAgentAddress" },
      chain: { id: 1, name: "mock" },
      sendTransaction: mockSendTransaction,
    }),
    createPublicClient: vi.fn().mockReturnValue({
      getCode: mockGetCode,
      getBalance: mockGetBalance,
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

// --- Mock @metamask/smart-accounts-kit ---
vi.mock("@metamask/smart-accounts-kit", () => ({
  createExecution: vi.fn().mockReturnValue({
    target: "0xTarget",
    callData: "0xCalldata",
    value: 0n,
  }),
  ExecutionMode: { SingleDefault: "0x00" },
  getSmartAccountsEnvironment: vi.fn().mockReturnValue({
    DelegationManager: "0xMockDelegationManager",
  }),
}));

// --- Mock @metamask/smart-accounts-kit/contracts ---
vi.mock("@metamask/smart-accounts-kit/contracts", () => ({
  DelegationManager: {
    encode: {
      redeemDelegations: vi.fn().mockReturnValue("0xRedeemCalldata"),
    },
  },
}));
vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { createExecution, ExecutionMode } from "@metamask/smart-accounts-kit";
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts";
import {
  redeemDelegation,
  deployDelegatorIfNeeded,
  fundDelegatorIfNeeded,
  type RedeemParams,
} from "../redeemer.js";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: account is deployed and has enough balance
  mockGetCode.mockResolvedValue("0x1234");
  mockGetBalance.mockResolvedValue(1000000000000000000n);
});

describe("deployDelegatorIfNeeded", () => {
  const mockSmartAccount = {
    address: "0xSmartAccountAddress",
    getFactoryArgs: vi.fn().mockResolvedValue({
      factory: "0xFactory",
      factoryData: "0xFactoryData",
    }),
  } as any;
  const chain = { id: 1, name: "mainnet" } as any;

  it("returns null if smart account is already deployed", async () => {
    mockGetCode.mockResolvedValue("0x1234");
    const result = await deployDelegatorIfNeeded(
      mockSmartAccount,
      "0xabc123" as `0x${string}`,
      chain,
    );
    expect(result).toBeNull();
  });

  it("deploys smart account if not deployed", async () => {
    mockGetCode.mockResolvedValue("0x");
    mockSendTransaction.mockResolvedValueOnce("0xDeployTx");
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      status: "success",
    });

    const result = await deployDelegatorIfNeeded(
      mockSmartAccount,
      "0xabc123" as `0x${string}`,
      chain,
    );

    expect(result).toBe("0xDeployTx");
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xFactory",
        data: "0xFactoryData",
      }),
    );
  });

  it("throws if deployment receipt is not success", async () => {
    mockGetCode.mockResolvedValue("0x");
    mockSendTransaction.mockResolvedValueOnce("0xDeployTx");
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    await expect(
      deployDelegatorIfNeeded(
        mockSmartAccount,
        "0xabc123" as `0x${string}`,
        chain,
      ),
    ).rejects.toThrow("Smart account deployment failed");
  });
});

describe("fundDelegatorIfNeeded", () => {
  const mockSmartAccount = {
    address: "0xSmartAccountAddress",
  } as any;
  const chain = { id: 1, name: "mainnet" } as any;

  it("returns null if balance is sufficient", async () => {
    mockGetBalance.mockResolvedValue(2000000000000000000n); // 2 ETH
    const result = await fundDelegatorIfNeeded(
      mockSmartAccount,
      "0xabc123" as `0x${string}`,
      chain,
      1000000000000000000n, // need 1 ETH
    );
    expect(result).toBeNull();
  });

  it("transfers deficit if balance is insufficient", async () => {
    mockGetBalance.mockResolvedValue(0n);
    mockSendTransaction.mockResolvedValueOnce("0xFundTx");
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      status: "success",
    });

    const result = await fundDelegatorIfNeeded(
      mockSmartAccount,
      "0xabc123" as `0x${string}`,
      chain,
      1000000000000000000n, // need 1 ETH
    );

    expect(result).toBe("0xFundTx");
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xSmartAccountAddress",
      }),
    );
  });

  it("throws if funding tx fails", async () => {
    mockGetBalance.mockResolvedValue(0n);
    mockSendTransaction.mockResolvedValueOnce("0xFundTx");
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    await expect(
      fundDelegatorIfNeeded(
        mockSmartAccount,
        "0xabc123" as `0x${string}`,
        chain,
        1000000000000000000n,
      ),
    ).rejects.toThrow("Funding delegator smart account failed");
  });
});

describe("redeemDelegation", () => {
  const mockDelegation = {
    delegator: "0xDelegator",
    delegate: "0xDelegate",
    authority: "0x0",
    caveats: [],
    salt: 0n,
    signature: "0xSig",
  } as any;

  const mockSmartAccount = {
    address: "0xSmartAccountAddress",
    getFactoryArgs: vi.fn().mockResolvedValue({
      factory: "0xFactory",
      factoryData: "0xFactoryData",
    }),
  } as any;

  const chain = { id: 1, name: "mainnet" } as any;

  function makeRedeemParams(
    callOverrides: Partial<RedeemParams["call"]> = {},
  ): RedeemParams {
    return {
      delegation: mockDelegation,
      delegatorSmartAccount: mockSmartAccount,
      call: { to: "0xTargetContract" as Hex, ...callOverrides },
    };
  }

  it("calls createExecution with the correct call params", async () => {
    const params = makeRedeemParams({ data: "0xCalldata" as Hex, value: 100n });

    await redeemDelegation("0xabc123" as `0x${string}`, chain, params);

    expect(createExecution).toHaveBeenCalledWith({
      target: "0xTargetContract",
      callData: "0xCalldata",
      value: 100n,
    });
  });

  it("calls DelegationManager.encode.redeemDelegations", async () => {
    const params = makeRedeemParams({ data: "0xCalldata" as Hex, value: 100n });

    await redeemDelegation("0xabc123" as `0x${string}`, chain, params);

    expect(DelegationManager.encode.redeemDelegations).toHaveBeenCalledWith({
      delegations: [[mockDelegation]],
      modes: [ExecutionMode.SingleDefault],
      executions: [[expect.any(Object)]],
    });
  });

  it("sends tx to DelegationManager with encoded calldata", async () => {
    const params = makeRedeemParams();

    await redeemDelegation("0xabc123" as `0x${string}`, chain, params);

    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xMockDelegationManager",
        data: "0xRedeemCalldata",
      }),
    );
  });

  it("returns the transaction hash", async () => {
    const params = makeRedeemParams();

    const txHash = await redeemDelegation(
      "0xabc123" as `0x${string}`,
      chain,
      params,
    );
    expect(txHash).toBe("0xTxHash");
  });

  it("uses default data (0x) and value (0n) when not provided", async () => {
    const params = makeRedeemParams();

    await redeemDelegation("0xabc123" as `0x${string}`, chain, params);

    expect(createExecution).toHaveBeenCalledWith({
      target: "0xTargetContract",
      callData: "0x",
      value: 0n,
    });
  });

  it("funds delegator if call has ETH value and balance is insufficient", async () => {
    mockGetBalance.mockResolvedValue(0n); // Smart account has no ETH

    const params = makeRedeemParams({ value: 1000000000000000n });

    await redeemDelegation("0xabc123" as `0x${string}`, chain, params);

    // Should have called sendTransaction at least twice: fund + redeem
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });
});
