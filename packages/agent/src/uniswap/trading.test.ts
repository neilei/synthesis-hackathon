/**
 * Unit tests for Uniswap Trading API client: quote, approval, swap creation.
 *
 * @module @veil/agent/uniswap/trading.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock config
vi.mock("../config.js", () => ({
  env: {
    UNISWAP_API_KEY: "test-api-key",
  },
  UNISWAP_API_BASE: "https://trade-api.gateway.uniswap.org/v1",
  CONTRACTS: {
    PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
}));

import { checkApproval, getQuote, createSwap, executeFullSwap } from "./trading.js";

describe("Uniswap Trading API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("checkApproval", () => {
    it("sends correct request to /check_approval", async () => {
      const mockResponse = {
        approval: {
          tokenAddress: "0xtoken",
          spender: "0xspender",
          amount: "1000000",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await checkApproval({
        token: "0xtoken" as Address,
        amount: "1000000",
        chainId: 11155111,
        walletAddress: "0xwallet" as Address,
      });

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
      expect(body.token).toBe("0xtoken");
      expect(body.chainId).toBe(11155111);
      expect(result.approval.tokenAddress).toBe("0xtoken");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      });

      await expect(
        checkApproval({
          token: "0xtoken" as Address,
          amount: "1000",
          chainId: 1,
          walletAddress: "0xwallet" as Address,
        }),
      ).rejects.toThrow("Uniswap API /check_approval failed (400)");
    });
  });

  describe("getQuote", () => {
    it("sends correct request to /quote", async () => {
      const mockQuote = {
        requestId: "req-123",
        quote: {
          chainId: 11155111,
          input: { token: "0xWETH", amount: "1000000000000000" },
          output: { token: "0xUSDC", amount: "3500000" },
          swapper: "0xwallet",
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await getQuote({
        tokenIn: "0xWETH" as Address,
        tokenOut: "0xUSDC" as Address,
        amount: "1000000000000000",
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: "0xwallet" as Address,
      });

      expect(result.requestId).toBe("req-123");
      expect(result.quote.output.amount).toBe("3500000");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tokenIn).toBe("0xWETH");
      expect(body.tokenOut).toBe("0xUSDC");
      expect(body.type).toBe("EXACT_INPUT");
      expect(body.slippageTolerance).toBe(0.5);
    });

    it("uses custom slippage tolerance", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ requestId: "x", quote: {}, routing: "CLASSIC" }),
      });

      await getQuote({
        tokenIn: "0xA" as Address,
        tokenOut: "0xB" as Address,
        amount: "100",
        type: "EXACT_INPUT",
        chainId: 1,
        swapper: "0xC" as Address,
        slippageTolerance: 1.0,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.slippageTolerance).toBe(1.0);
    });
  });

  describe("createSwap", () => {
    it("sends quote to /swap endpoint", async () => {
      const mockSwap = {
        swap: {
          chainId: 11155111,
          to: "0xrouter" as Address,
          data: "0xcalldata" as Hex,
          value: "0",
        },
        requestId: "req-456",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSwap),
      });

      const quoteResponse = {
        requestId: "req-123",
        quote: {
          chainId: 11155111,
          input: { token: "0xWETH" as Address, amount: "1000" },
          output: { token: "0xUSDC" as Address, amount: "3500" },
          swapper: "0xwallet" as Address,
          slippage: { tolerance: 0.5 },
        },
        routing: "CLASSIC",
      };

      const result = await createSwap(quoteResponse);

      expect(result.swap.to).toBe("0xrouter");
      expect(result.swap.data).toBe("0xcalldata");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.simulateTransaction).toBe(true);
    });

    it("includes permit data and signature when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ swap: {}, requestId: "x" }),
      });

      const quoteWithPermit = {
        requestId: "req-123",
        quote: {} as any,
        routing: "CLASSIC",
        permitData: {
          domain: { name: "Permit2" },
          types: { PermitWitnessTransferFrom: [] },
          values: { permitted: {} },
        },
      };

      await createSwap(quoteWithPermit, "0xsig123" as Hex);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.permitData).toBeDefined();
      expect(body.signature).toBe("0xsig123");
    });
  });

  describe("executeFullSwap", () => {
    it("orchestrates full swap flow", async () => {
      // Mock check_approval — no approval needed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            approval: {
              tokenAddress: "0xWETH",
              spender: "0xPermit2",
              amount: "1000",
            },
          }),
      });

      // Mock quote — no permitData
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: "req-1",
            quote: {
              chainId: 11155111,
              input: { token: "0xWETH", amount: "1000" },
              output: { token: "0xUSDC", amount: "3500" },
              swapper: "0xwallet",
              slippage: { tolerance: 0.5 },
            },
            routing: "CLASSIC",
          }),
      });

      // Mock swap
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            swap: {
              chainId: 11155111,
              to: "0xrouter",
              data: "0xswapdata",
              value: "0",
            },
            requestId: "req-2",
          }),
      });

      const mockSendTx = vi.fn().mockResolvedValue("0xtxhash" as Hex);
      const mockSignTypedData = vi.fn().mockResolvedValue("0xsig" as Hex);

      const result = await executeFullSwap({
        tokenIn: "0xWETH" as Address,
        tokenOut: "0xUSDC" as Address,
        amount: "1000",
        chainId: 11155111,
        walletAddress: "0xwallet" as Address,
        signTypedData: mockSignTypedData,
        sendTransaction: mockSendTx,
      });

      expect(result.txHash).toBe("0xtxhash");
      expect(mockSendTx).toHaveBeenCalledTimes(1); // Only swap tx, no approval
      expect(mockSignTypedData).not.toHaveBeenCalled(); // No permitData
    });

    it("sends approval tx when required", async () => {
      // Mock check_approval — approval needed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            approval: {
              tokenAddress: "0xWETH",
              spender: "0xPermit2",
              amount: "1000",
              transactionRequest: {
                to: "0xWETH",
                data: "0xapprovedata",
                value: "0",
              },
            },
          }),
      });

      // Mock quote
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            requestId: "req-1",
            quote: {
              chainId: 1,
              input: { token: "0xWETH", amount: "1000" },
              output: { token: "0xUSDC", amount: "3500" },
              swapper: "0xwallet",
              slippage: { tolerance: 0.5 },
            },
            routing: "CLASSIC",
          }),
      });

      // Mock swap
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            swap: { to: "0xrouter", data: "0xswapdata", value: "0" },
            requestId: "req-2",
          }),
      });

      const mockSendTx = vi.fn().mockResolvedValue("0xtxhash" as Hex);

      await executeFullSwap({
        tokenIn: "0xWETH" as Address,
        tokenOut: "0xUSDC" as Address,
        amount: "1000",
        chainId: 1,
        walletAddress: "0xwallet" as Address,
        signTypedData: vi.fn(),
        sendTransaction: mockSendTx,
      });

      // Approval tx + swap tx = 2 calls
      expect(mockSendTx).toHaveBeenCalledTimes(2);
      expect(mockSendTx.mock.calls[0][0].data).toBe("0xapprovedata");
    });
  });
});
