/**
 * Unit tests for Permit2 EIP-712 signing utilities.
 *
 * @module @maw/agent/uniswap/permit2.test
 */
import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";

import { signPermit2Data, derivePrimaryType } from "../permit2.js";

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeMockWalletClient() {
  return {
    signTypedData: vi.fn().mockResolvedValue("0xsignature" as Hex),
    chain: { id: 1, name: "mainnet" },
    account: {
      address: "0xOwnerAddress" as Address,
      type: "local" as const,
    },
  } as unknown as import("viem").WalletClient;
}

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
