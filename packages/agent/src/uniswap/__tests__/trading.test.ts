/**
 * Unit tests for Uniswap Trading API client: quote, approval, swap creation.
 *
 * @module @maw/agent/uniswap/trading.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock config
vi.mock("../../config.js", () => ({
  env: {
    UNISWAP_API_KEY: "test-api-key",
  },
  UNISWAP_API_BASE: "https://trade-api.gateway.uniswap.org/v1",
  CONTRACTS: {
    PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
}));

import { checkApproval, getQuote, createSwap } from "../trading.js";
import type { QuoteResponse } from "../schemas.js";

describe("Uniswap Trading API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const defaultApprovalParams = {
    token: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    amount: "1000",
    chainId: 1,
    walletAddress: "0xwallet0000000000000000000000000000000000" as Address,
  };

  describe("checkApproval", () => {
    it("sends correct request to /check_approval", async () => {
      const mockResponse = {
        approval: {
          tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
          spender: "0xabcdef1234567890abcdef1234567890abcdef12",
          amount: "1000000",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await checkApproval({ ...defaultApprovalParams, amount: "1000000", chainId: 11155111 });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://trade-api.gateway.uniswap.org/v1/check_approval",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-key": "test-api-key",
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.token).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(body.chainId).toBe(11155111);
      expect(result.approval?.tokenAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      });

      await expect(
        checkApproval(defaultApprovalParams),
      ).rejects.toThrow("Uniswap API /check_approval failed (400)");
    });

    it("throws on invalid response shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ unexpected: "data" }),
      });

      await expect(
        checkApproval(defaultApprovalParams),
      ).rejects.toThrow("Uniswap API /check_approval response validation failed");
    });

    it("handles approval: null (token already approved)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ approval: null }),
      });

      const result = await checkApproval({
        token: "0x1234567890abcdef1234567890abcdef12345678" as Address,
        amount: "1000000",
        chainId: 11155111,
        walletAddress: "0xwallet0000000000000000000000000000000000" as Address,
      });

      expect(result.approval).toBeNull();
    });

    it("throws when hex strings lack 0x prefix", async () => {
      const mockResponse = {
        approval: {
          tokenAddress: "no-hex-prefix",
          spender: "0xabcdef1234567890abcdef1234567890abcdef12",
          amount: "1000000",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(
        checkApproval(defaultApprovalParams),
      ).rejects.toThrow("Uniswap API /check_approval response validation failed");
    });
  });

  describe("getQuote", () => {
    it("sends correct request to /quote", async () => {
      const mockQuote = {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await getQuote({
        tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
        tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        amount: "1000000000000000",
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: "0xf13021F02E23a8113C1bD826575a1682F6Fac927" as Address,
      });

      expect(result.requestId).toBe("req-123");
      expect(result.quote.output.amount).toBe("3500000");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tokenIn).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
      expect(body.tokenOut).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      expect(body.type).toBe("EXACT_INPUT");
      expect(body.slippageTolerance).toBe(0.5);
    });

    it("uses custom slippage tolerance", async () => {
      const mockQuote = {
        requestId: "req-456",
        quote: {
          chainId: 1,
          input: { token: "0xA000000000000000000000000000000000000000", amount: "100" },
          output: { token: "0xB000000000000000000000000000000000000000", amount: "200" },
          swapper: "0xC000000000000000000000000000000000000000",
          slippage: { tolerance: 1.0 },
        },
        routing: "CLASSIC",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      await getQuote({
        tokenIn: "0xA000000000000000000000000000000000000000" as Address,
        tokenOut: "0xB000000000000000000000000000000000000000" as Address,
        amount: "100",
        type: "EXACT_INPUT",
        chainId: 1,
        swapper: "0xC000000000000000000000000000000000000000" as Address,
        slippageTolerance: 1.0,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.slippageTolerance).toBe(1.0);
    });

    it("throws on invalid quote response", async () => {
      const invalidQuote = {
        requestId: "req-789",
        quote: {
          chainId: "not-a-number",
          input: { token: "0xA000000000000000000000000000000000000000", amount: "100" },
          output: { token: "0xB000000000000000000000000000000000000000", amount: "200" },
          swapper: "0xC000000000000000000000000000000000000000",
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(invalidQuote),
      });

      await expect(
        getQuote({
          tokenIn: "0xA000000000000000000000000000000000000000" as Address,
          tokenOut: "0xB000000000000000000000000000000000000000" as Address,
          amount: "100",
          type: "EXACT_INPUT",
          chainId: 1,
          swapper: "0xC000000000000000000000000000000000000000" as Address,
        }),
      ).rejects.toThrow("Uniswap API /quote response validation failed");
    });
  });

  describe("createSwap", () => {
    it("sends quote to /swap endpoint", async () => {
      const mockSwap = {
        swap: {
          chainId: 11155111,
          to: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
          data: "0xabcdef1234567890",
          value: "0",
        },
        requestId: "req-456",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSwap),
      });

      const quoteResponse: QuoteResponse = {
        requestId: "req-123",
        quote: {
          chainId: 11155111,
          input: { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: "1000" },
          output: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "3500" },
          swapper: "0xf13021F02E23a8113C1bD826575a1682F6Fac927",
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
      };

      const result = await createSwap(quoteResponse);

      expect(result.swap.to).toBe("0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD");
      expect(result.swap.data).toBe("0xabcdef1234567890");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.simulateTransaction).toBe(true);
    });

    it("includes permit data and signature when provided", async () => {
      const mockSwap = {
        swap: {
          to: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
          data: "0xabcdef",
          value: "0",
        },
        requestId: "req-swap-permit",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSwap),
      });

      const quoteWithPermit: QuoteResponse = {
        requestId: "req-123",
        quote: {
          chainId: 11155111,
          input: { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: "1000" },
          output: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "3500" },
          swapper: "0xf13021F02E23a8113C1bD826575a1682F6Fac927",
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
        permitData: {
          domain: { name: "Permit2" },
          types: { PermitWitnessTransferFrom: [{ name: "permitted", type: "TokenPermissions" }] },
          values: { permitted: {} },
        },
      };

      await createSwap(quoteWithPermit, "0xsig123abcdef" as Hex);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.permitData).toBeDefined();
      expect(body.signature).toBe("0xsig123abcdef");
    });

    it("throws on invalid swap response", async () => {
      const invalidSwap = {
        swap: {
          to: "missing-hex-prefix",
          data: "0xabcdef",
          value: "0",
        },
        requestId: "req-invalid",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(invalidSwap),
      });

      const quoteResponse: QuoteResponse = {
        requestId: "req-123",
        quote: {
          chainId: 11155111,
          input: { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: "1000" },
          output: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "3500" },
          swapper: "0xf13021F02E23a8113C1bD826575a1682F6Fac927",
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
      };

      await expect(createSwap(quoteResponse)).rejects.toThrow(
        "Uniswap API /swap response validation failed",
      );
    });
  });
});
