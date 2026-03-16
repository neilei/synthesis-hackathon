/**
 * Unit tests for Permit2 approval and signing utilities.
 *
 * @module @veil/agent/uniswap/permit2.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

vi.mock("../config.js", () => ({
  CONTRACTS: {
    PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  },
}));

// ---------------------------------------------------------------------------
// Mock viem – parseAbi must return a passthrough so the real module can
// define its ABI constants at import time.
// ---------------------------------------------------------------------------

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    // keep parseAbi functional so ABI consts resolve
  };
});

import { ensurePermit2Approval, signPermit2Data, derivePrimaryType } from "./permit2.js";

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeMockPublicClient(allowance: bigint = 0n) {
  return {
    readContract: vi.fn().mockResolvedValue(allowance),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  } as unknown as import("viem").PublicClient;
}

function makeMockWalletClient() {
  return {
    writeContract: vi.fn().mockResolvedValue("0xapprovalhash" as Hex),
    signTypedData: vi.fn().mockResolvedValue("0xsignature" as Hex),
    chain: { id: 1, name: "mainnet" },
    account: {
      address: "0xOwnerAddress" as Address,
      type: "local" as const,
    },
  } as unknown as import("viem").WalletClient;
}

const TOKEN = "0xTokenAddress" as Address;
const OWNER = "0xOwnerAddress" as Address;

// ---------------------------------------------------------------------------
// ensurePermit2Approval
// ---------------------------------------------------------------------------

describe("ensurePermit2Approval", () => {
  it("skips approval when existing allowance is above 2^128", async () => {
    const highAllowance = 2n ** 128n + 1n;
    const publicClient = makeMockPublicClient(highAllowance);
    const walletClient = makeMockWalletClient();

    const result = await ensurePermit2Approval(
      publicClient,
      walletClient,
      TOKEN,
      OWNER,
    );

    expect(result).toBe(false);
    expect(publicClient.readContract).toHaveBeenCalledTimes(1);
    expect(
      (walletClient as unknown as { writeContract: ReturnType<typeof vi.fn> })
        .writeContract,
    ).not.toHaveBeenCalled();
  });

  it("skips approval when allowance is exactly at the boundary (2^128 is NOT > 2^128)", async () => {
    // The code checks `currentAllowance > 2n ** 128n`, so exactly 2^128 should trigger approval
    const boundaryAllowance = 2n ** 128n;
    const publicClient = makeMockPublicClient(boundaryAllowance);
    const walletClient = makeMockWalletClient();

    const result = await ensurePermit2Approval(
      publicClient,
      walletClient,
      TOKEN,
      OWNER,
    );

    expect(result).toBe(true);
    expect(
      (walletClient as unknown as { writeContract: ReturnType<typeof vi.fn> })
        .writeContract,
    ).toHaveBeenCalledTimes(1);
  });

  it("sends approval tx when allowance is low", async () => {
    const lowAllowance = 1000n;
    const publicClient = makeMockPublicClient(lowAllowance);
    const walletClient = makeMockWalletClient();

    const result = await ensurePermit2Approval(
      publicClient,
      walletClient,
      TOKEN,
      OWNER,
    );

    expect(result).toBe(true);

    // Verify writeContract was called with correct args
    const writeCall = (
      walletClient as unknown as { writeContract: ReturnType<typeof vi.fn> }
    ).writeContract.mock.calls[0][0];
    expect(writeCall.address).toBe(TOKEN);
    expect(writeCall.functionName).toBe("approve");
    expect(writeCall.args[0]).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    ); // PERMIT2
    expect(writeCall.args[1]).toBe(2n ** 256n - 1n); // max uint256
  });

  it("waits for transaction receipt after approval", async () => {
    const publicClient = makeMockPublicClient(0n);
    const walletClient = makeMockWalletClient();

    await ensurePermit2Approval(publicClient, walletClient, TOKEN, OWNER);

    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: "0xapprovalhash",
    });
  });

  it("sends approval tx when allowance is zero", async () => {
    const publicClient = makeMockPublicClient(0n);
    const walletClient = makeMockWalletClient();

    const result = await ensurePermit2Approval(
      publicClient,
      walletClient,
      TOKEN,
      OWNER,
    );

    expect(result).toBe(true);
    expect(
      (walletClient as unknown as { writeContract: ReturnType<typeof vi.fn> })
        .writeContract,
    ).toHaveBeenCalledTimes(1);
  });

  it("passes owner and PERMIT2 to readContract allowance check", async () => {
    const publicClient = makeMockPublicClient(2n ** 200n);
    const walletClient = makeMockWalletClient();

    await ensurePermit2Approval(publicClient, walletClient, TOKEN, OWNER);

    const readCall = (
      publicClient as unknown as { readContract: ReturnType<typeof vi.fn> }
    ).readContract.mock.calls[0][0];
    expect(readCall.address).toBe(TOKEN);
    expect(readCall.functionName).toBe("allowance");
    expect(readCall.args[0]).toBe(OWNER);
    expect(readCall.args[1]).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    ); // PERMIT2
  });
});

// ---------------------------------------------------------------------------
// signPermit2Data
// ---------------------------------------------------------------------------

describe("signPermit2Data", () => {
  it("calls signTypedData with correct parameters", async () => {
    const walletClient = makeMockWalletClient();

    const permitData = {
      domain: {
        name: "Permit2",
        chainId: 1,
        verifyingContract: "0xPermit2Contract" as Address,
      },
      types: {
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "SlippageSwap" },
        ],
      },
      values: {
        permitted: { token: "0xToken", amount: "1000000" },
        spender: "0xSpender",
        nonce: "1",
        deadline: "9999999999",
      },
    };

    const result = await signPermit2Data(walletClient, permitData);

    expect(result).toBe("0xsignature");

    const signCall = (
      walletClient as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData.mock.calls[0][0];

    expect(signCall.account).toBe(walletClient.account);
    expect(signCall.domain).toEqual(permitData.domain);
    expect(signCall.types).toEqual(permitData.types);
    expect(signCall.primaryType).toBe("PermitWitnessTransferFrom");
    expect(signCall.message).toEqual(permitData.values);
  });

  it("returns the hex signature from signTypedData", async () => {
    const walletClient = makeMockWalletClient();
    (
      walletClient as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData.mockResolvedValue("0xdeadbeef" as Hex);

    const permitData = {
      domain: { name: "Permit2" },
      types: { PermitWitnessTransferFrom: [] },
      values: { permitted: {} },
    };

    const result = await signPermit2Data(walletClient, permitData);
    expect(result).toBe("0xdeadbeef");
  });

  it("uses walletClient.account for signing", async () => {
    const walletClient = makeMockWalletClient();

    const permitData = {
      domain: {},
      types: { PermitWitnessTransferFrom: [] },
      values: {},
    };

    await signPermit2Data(walletClient, permitData);

    const signCall = (
      walletClient as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData.mock.calls[0][0];
    expect(signCall.account).toBe(walletClient.account);
  });
});

// ---------------------------------------------------------------------------
// derivePrimaryType
// ---------------------------------------------------------------------------

describe("derivePrimaryType", () => {
  it("returns PermitWitnessTransferFrom for Universal Router types", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    };
    expect(derivePrimaryType(types)).toBe("PermitWitnessTransferFrom");
  });

  it("returns PermitSingle for allowance-based types", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
      ],
    };
    expect(derivePrimaryType(types)).toBe("PermitSingle");
  });

  it("returns the single non-EIP712Domain key", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      SimpleType: [{ name: "value", type: "uint256" }],
    };
    expect(derivePrimaryType(types)).toBe("SimpleType");
  });

  it("throws when no non-EIP712Domain types exist", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
    };
    expect(() => derivePrimaryType(types)).toThrow(
      "No non-EIP712Domain types found in typed data",
    );
  });
});
