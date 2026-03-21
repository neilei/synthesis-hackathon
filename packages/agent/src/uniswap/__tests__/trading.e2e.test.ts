/**
 * E2E tests for Uniswap Trading API against live gateway.
 *
 * @module @maw/agent/uniswap/trading.e2e.test
 */
import { describe, it, expect } from "vitest";
import { getQuote } from "../trading.js";
import { env, CONTRACTS } from "../../config.js";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits } from "viem";

describe("Uniswap Trading API (e2e)", () => {
  const agentAddress = privateKeyToAccount(env.AGENT_PRIVATE_KEY).address;

  it(
    "gets a native ETH -> USDC quote on Sepolia",
    { timeout: 30000 },
    async () => {
      const quote = await getQuote({
        tokenIn: CONTRACTS.NATIVE_ETH,
        tokenOut: CONTRACTS.USDC_SEPOLIA,
        amount: parseUnits("0.0001", 18).toString(),
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: agentAddress,
      });

      expect(quote).toBeDefined();
      expect(quote.requestId).toBeDefined();
      expect(typeof quote.requestId).toBe("string");

      expect(quote.quote).toBeDefined();
      expect(quote.quote.chainId).toBe(11155111);
      expect(quote.quote.swapper.toLowerCase()).toBe(
        agentAddress.toLowerCase(),
      );

      // Output amount should be a positive number string
      expect(BigInt(quote.quote.output.amount)).toBeGreaterThan(0n);

      expect(quote.routing).toBeDefined();
      expect(typeof quote.routing).toBe("string");

      console.log("Quote received:", {
        requestId: quote.requestId,
        inputAmount: quote.quote.input.amount,
        outputAmount: quote.quote.output.amount,
        routing: quote.routing,
        hasPermitData: !!quote.permitData,
      });
    },
  );

  it(
    "gets a USDC -> native ETH quote on Sepolia",
    { timeout: 30000 },
    async () => {
      const quote = await getQuote({
        tokenIn: CONTRACTS.USDC_SEPOLIA,
        tokenOut: CONTRACTS.NATIVE_ETH,
        amount: parseUnits("1", 6).toString(), // 1 USDC
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: agentAddress,
        protocols: ["V3"], // V4 pools on Sepolia are broken
      });

      expect(quote).toBeDefined();
      expect(quote.requestId).toBeDefined();
      expect(BigInt(quote.quote.output.amount)).toBeGreaterThan(0n);

      console.log("Reverse quote received:", {
        inputAmount: quote.quote.input.amount,
        outputAmount: quote.quote.output.amount,
        routing: quote.routing,
      });
    },
  );

  it(
    "USDC -> ETH quote includes permitData for Permit2 signing",
    { timeout: 30000 },
    async () => {
      const quote = await getQuote({
        tokenIn: CONTRACTS.USDC_SEPOLIA,
        tokenOut: CONTRACTS.NATIVE_ETH,
        amount: parseUnits("1", 6).toString(), // 1 USDC
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: agentAddress,
        protocols: ["V3"], // V4 pools on Sepolia are broken
      });

      expect(quote).toBeDefined();
      expect(BigInt(quote.quote.output.amount)).toBeGreaterThan(0n);

      // ERC-20 sells should include Permit2 data for gasless approval
      // Note: permitData may be null if the swapper already has Permit2 approval
      // or if the routing doesn't require it (e.g., WRAP/UNWRAP routes)
      if (quote.permitData) {
        expect(quote.permitData.domain).toBeDefined();
        expect(quote.permitData.types).toBeDefined();
        expect(quote.permitData.values).toBeDefined();
        console.log("Permit2 data present:", {
          domain: quote.permitData.domain,
          hasTypes: Object.keys(quote.permitData.types).length > 0,
        });
      } else {
        console.log("No permitData returned (swapper may already have approval or route does not require it)");
      }
    },
  );

  it(
    "gets a WETH -> USDC quote on Sepolia",
    { timeout: 30000 },
    async () => {
      const quote = await getQuote({
        tokenIn: CONTRACTS.WETH_SEPOLIA,
        tokenOut: CONTRACTS.USDC_SEPOLIA,
        amount: parseUnits("0.0001", 18).toString(),
        type: "EXACT_INPUT",
        chainId: 11155111,
        swapper: agentAddress,
        slippageTolerance: 1.0,
      });

      expect(quote).toBeDefined();
      expect(BigInt(quote.quote.output.amount)).toBeGreaterThan(0n);

      console.log("WETH->USDC quote:", {
        inputAmount: quote.quote.input.amount,
        outputAmount: quote.quote.output.amount,
        routing: quote.routing,
      });
    },
  );
});
