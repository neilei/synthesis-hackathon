/**
 * Unit tests for on-chain delegation allowance queries.
 *
 * @module @maw/agent/delegation/allowance.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Hex } from "viem";

const mockGetErc20Amount = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    availableAmount: 200000000n, // 200 USDC
    isNewPeriod: false,
    currentPeriod: 1n,
  }),
);

const mockGetNativeAmount = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    availableAmount: 500000000000000000n, // 0.5 ETH
    isNewPeriod: true,
    currentPeriod: 0n,
  }),
);

const mockDecodeDelegations = vi.hoisted(() =>
  vi.fn().mockReturnValue([
    {
      delegate: "0xAgent",
      delegator: "0xUser",
      authority: "0x0",
      caveats: [],
      salt: "0x0",
      signature: "0x0",
    },
  ]),
);

vi.mock("@metamask/smart-accounts-kit", () => ({
  getSmartAccountsEnvironment: vi.fn().mockReturnValue({
    DelegationManager: "0xDM",
    EntryPoint: "0xEP",
    SimpleFactory: "0xSF",
    implementations: {},
    caveatEnforcers: {},
  }),
  createCaveatEnforcerClient: vi.fn().mockReturnValue({
    getErc20PeriodTransferEnforcerAvailableAmount: mockGetErc20Amount,
    getNativeTokenPeriodTransferEnforcerAvailableAmount: mockGetNativeAmount,
  }),
}));

vi.mock("@metamask/smart-accounts-kit/utils", () => ({
  decodeDelegations: mockDecodeDelegations,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      chain: { id: 11155111 },
    }),
  };
});

vi.mock("../../config.js", () => ({
  rpcTransport: vi.fn().mockReturnValue("http-transport"),
}));

vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getErc20Allowance, getNativeAllowance } from "../allowance.js";

const MOCK_CONTEXT = "0xdeadbeef" as Hex;
const CHAIN_ID = 11155111;

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mocks
  mockGetErc20Amount.mockResolvedValue({
    availableAmount: 200000000n,
    isNewPeriod: false,
    currentPeriod: 1n,
  });
  mockGetNativeAmount.mockResolvedValue({
    availableAmount: 500000000000000000n,
    isNewPeriod: true,
    currentPeriod: 0n,
  });
  mockDecodeDelegations.mockReturnValue([
    {
      delegate: "0xAgent",
      delegator: "0xUser",
      authority: "0x0",
      caveats: [],
      salt: "0x0",
      signature: "0x0",
    },
  ]);
});

describe("getErc20Allowance", () => {
  it("returns allowance when SDK succeeds", async () => {
    const result = await getErc20Allowance(MOCK_CONTEXT, CHAIN_ID);

    expect(result).toEqual({
      availableAmount: 200000000n,
      isNewPeriod: false,
      currentPeriod: 1n,
    });
  });

  it("passes first decoded delegation to enforcer", async () => {
    await getErc20Allowance(MOCK_CONTEXT, CHAIN_ID);

    expect(mockGetErc20Amount).toHaveBeenCalledWith({
      delegation: expect.objectContaining({
        delegate: "0xAgent",
        delegator: "0xUser",
      }),
    });
  });

  it("returns null when SDK throws", async () => {
    mockGetErc20Amount.mockRejectedValue(new Error("contract call failed"));

    const result = await getErc20Allowance(MOCK_CONTEXT, CHAIN_ID);
    expect(result).toBeNull();
  });

  it("returns null when no delegations decoded", async () => {
    mockDecodeDelegations.mockReturnValue([]);

    const result = await getErc20Allowance(MOCK_CONTEXT, CHAIN_ID);
    expect(result).toBeNull();
  });
});

describe("getNativeAllowance", () => {
  it("returns allowance when SDK succeeds", async () => {
    const result = await getNativeAllowance(MOCK_CONTEXT, CHAIN_ID);

    expect(result).toEqual({
      availableAmount: 500000000000000000n,
      isNewPeriod: true,
      currentPeriod: 0n,
    });
  });

  it("passes first decoded delegation to enforcer", async () => {
    await getNativeAllowance(MOCK_CONTEXT, CHAIN_ID);

    expect(mockGetNativeAmount).toHaveBeenCalledWith({
      delegation: expect.objectContaining({
        delegate: "0xAgent",
        delegator: "0xUser",
      }),
    });
  });

  it("returns null when SDK throws", async () => {
    mockGetNativeAmount.mockRejectedValue(new Error("contract call failed"));

    const result = await getNativeAllowance(MOCK_CONTEXT, CHAIN_ID);
    expect(result).toBeNull();
  });

  it("returns null when no delegations decoded", async () => {
    mockDecodeDelegations.mockReturnValue([]);

    const result = await getNativeAllowance(MOCK_CONTEXT, CHAIN_ID);
    expect(result).toBeNull();
  });
});
