/**
 * Unit tests for Uniswap Trading API Zod validation schemas.
 *
 * @module @veil/agent/uniswap/schemas.test
 */
import { describe, it, expect } from "vitest";
import {
  ApprovalResponseSchema,
  QuoteResponseSchema,
  SwapResponseSchema,
  PermitDataSchema,
} from "../schemas.js";

describe("ApprovalResponseSchema", () => {
  it("accepts valid approval response", () => {
    const valid = {
      approval: {
        tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
        spender: "0xabcdef1234567890abcdef1234567890abcdef12",
        amount: "1000000",
      },
    };
    const result = ApprovalResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts approval with transactionRequest", () => {
    const valid = {
      approval: {
        tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
        spender: "0xabcdef1234567890abcdef1234567890abcdef12",
        amount: "1000000",
        transactionRequest: {
          to: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          data: "0xabcdef",
          value: "0",
        },
      },
    };
    const result = ApprovalResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing approval object", () => {
    const result = ApprovalResponseSchema.safeParse({ unexpected: "data" });
    expect(result.success).toBe(false);
  });

  it("rejects non-hex tokenAddress", () => {
    const invalid = {
      approval: {
        tokenAddress: "not-hex",
        spender: "0xabcdef1234567890abcdef1234567890abcdef12",
        amount: "1000000",
      },
    };
    const result = ApprovalResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("QuoteResponseSchema", () => {
  const validQuote = {
    requestId: "req-123",
    quote: {
      chainId: 11155111,
      input: { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: "1000000000000000" },
      output: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "3500000" },
      swapper: "0xf13021F02E23a8113C1bD826575a1682F6Fac927",
      slippage: { tolerance: 0.5 },
    },
    routing: "CLASSIC",
  };

  it("accepts valid quote response", () => {
    const result = QuoteResponseSchema.safeParse(validQuote);
    expect(result.success).toBe(true);
  });

  it("accepts quote with permitData", () => {
    const withPermit = {
      ...validQuote,
      permitData: {
        domain: { name: "Permit2", chainId: 1 },
        types: { PermitWitnessTransferFrom: [{ name: "permitted", type: "TokenPermissions" }] },
        values: { permitted: { token: "0xabc", amount: "100" } },
      },
    };
    const result = QuoteResponseSchema.safeParse(withPermit);
    expect(result.success).toBe(true);
  });

  it("accepts slippage as a plain number", () => {
    const withNumericSlippage = {
      ...validQuote,
      quote: { ...validQuote.quote, slippage: 0.5 },
    };
    const result = QuoteResponseSchema.safeParse(withNumericSlippage);
    expect(result.success).toBe(true);
  });

  it("accepts null permitData", () => {
    const withNullPermit = {
      ...validQuote,
      permitData: null,
    };
    const result = QuoteResponseSchema.safeParse(withNullPermit);
    expect(result.success).toBe(true);
  });

  it("rejects non-numeric chainId", () => {
    const invalid = {
      ...validQuote,
      quote: { ...validQuote.quote, chainId: "not-a-number" },
    };
    const result = QuoteResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing requestId", () => {
    const { requestId, ...noId } = validQuote;
    const result = QuoteResponseSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it("rejects non-hex token addresses", () => {
    const invalid = {
      ...validQuote,
      quote: {
        ...validQuote.quote,
        input: { token: "no-hex-prefix", amount: "100" },
      },
    };
    const result = QuoteResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("SwapResponseSchema", () => {
  it("accepts valid swap response", () => {
    const valid = {
      swap: {
        to: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        data: "0xabcdef1234567890",
        value: "0",
      },
      requestId: "req-456",
    };
    const result = SwapResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts swap with optional chainId and gasLimit", () => {
    const valid = {
      swap: {
        chainId: 11155111,
        to: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        data: "0xabcdef",
        value: "1000",
        gasLimit: "300000",
      },
      requestId: "req-789",
    };
    const result = SwapResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.swap.chainId).toBe(11155111);
      expect(result.data.swap.gasLimit).toBe("300000");
    }
  });

  it("rejects non-hex 'to' address", () => {
    const invalid = {
      swap: {
        to: "missing-hex-prefix",
        data: "0xabcdef",
        value: "0",
      },
      requestId: "req-invalid",
    };
    const result = SwapResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing swap object", () => {
    const result = SwapResponseSchema.safeParse({ requestId: "req-no-swap" });
    expect(result.success).toBe(false);
  });
});

describe("PermitDataSchema", () => {
  it("accepts valid permit data", () => {
    const valid = {
      domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      types: {
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      values: { permitted: { token: "0xabc", amount: "100" }, spender: "0xdef" },
    };
    const result = PermitDataSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing domain", () => {
    const invalid = {
      types: { Foo: [{ name: "bar", type: "uint256" }] },
      values: { bar: 1 },
    };
    const result = PermitDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects types entries without name/type fields", () => {
    const invalid = {
      domain: { name: "Test" },
      types: { Foo: [{ wrong: "shape" }] },
      values: { bar: 1 },
    };
    const result = PermitDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("preserves all domain fields through passthrough", () => {
    const valid = {
      domain: { name: "Permit2", chainId: 1, verifyingContract: "0xabc", extraField: "preserved" },
      types: { Foo: [{ name: "x", type: "uint256" }] },
      values: { x: 42 },
    };
    const result = PermitDataSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain.extraField).toBe("preserved");
    }
  });
});
