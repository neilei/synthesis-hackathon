/**
 * E2E tests for portfolio balance fetching against live Sepolia RPC.
 *
 * @module @veil/agent/data/portfolio.e2e.test
 */
import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { getPortfolioBalance } from "./portfolio.js";

const AGENT_ADDRESS =
  "0xf13021F02E23a8113C1bD826575a1682F6Fac927" as Address;

describe("getPortfolioBalance (e2e)", () => {
  it(
    "returns real balances with correct shape for agent on Sepolia",
    { timeout: 30000 },
    async () => {
      const ethPriceUsd = 2000;

      const result = await getPortfolioBalance(
        AGENT_ADDRESS,
        "sepolia",
        ethPriceUsd,
      );

      // --- Shape validation ---
      expect(result.address).toBe(AGENT_ADDRESS);

      // ETH balance fields
      expect(typeof result.balances.ETH.raw).toBe("bigint");
      expect(typeof result.balances.ETH.formatted).toBe("string");
      expect(typeof result.balances.ETH.usdValue).toBe("number");

      // USDC balance fields
      expect(typeof result.balances.USDC.raw).toBe("bigint");
      expect(typeof result.balances.USDC.formatted).toBe("string");
      expect(typeof result.balances.USDC.usdValue).toBe("number");

      // Aggregate fields
      expect(typeof result.totalUsdValue).toBe("number");
      expect(typeof result.allocation.ETH).toBe("number");
      expect(typeof result.allocation.USDC).toBe("number");
      expect(typeof result.timestamp).toBe("number");
    },
  );

  it(
    "wallet is funded — ETH balance should be non-zero on Sepolia",
    { timeout: 30000 },
    async () => {
      const ethPriceUsd = 2000;

      const result = await getPortfolioBalance(
        AGENT_ADDRESS,
        "sepolia",
        ethPriceUsd,
      );

      // Wallet is funded with ~1.0 ETH on Sepolia
      expect(result.balances.ETH.raw).toBeGreaterThan(0n);
      expect(Number(result.balances.ETH.formatted)).toBeGreaterThan(0);
      expect(result.balances.ETH.usdValue).toBeGreaterThan(0);
    },
  );

  it(
    "USD value math is consistent",
    { timeout: 30000 },
    async () => {
      const ethPriceUsd = 2500;

      const result = await getPortfolioBalance(
        AGENT_ADDRESS,
        "sepolia",
        ethPriceUsd,
      );

      // ethUsdValue = parseFloat(formatted) * ethPriceUsd
      const expectedEthUsd =
        parseFloat(result.balances.ETH.formatted) * ethPriceUsd;
      expect(result.balances.ETH.usdValue).toBeCloseTo(expectedEthUsd, 2);

      // usdcUsdValue = parseFloat(formatted) — USDC is $1
      const expectedUsdcUsd = parseFloat(result.balances.USDC.formatted);
      expect(result.balances.USDC.usdValue).toBeCloseTo(expectedUsdcUsd, 2);

      // totalUsdValue = ethUsdValue + usdcUsdValue
      const expectedTotal =
        result.balances.ETH.usdValue + result.balances.USDC.usdValue;
      expect(result.totalUsdValue).toBeCloseTo(expectedTotal, 2);
    },
  );

  it(
    "allocation percentages sum to 1.0 when portfolio has value",
    { timeout: 30000 },
    async () => {
      const ethPriceUsd = 2000;

      const result = await getPortfolioBalance(
        AGENT_ADDRESS,
        "sepolia",
        ethPriceUsd,
      );

      if (result.totalUsdValue > 0) {
        const allocSum = result.allocation.ETH + result.allocation.USDC;
        expect(allocSum).toBeCloseTo(1.0, 5);

        // Each allocation is between 0 and 1
        expect(result.allocation.ETH).toBeGreaterThanOrEqual(0);
        expect(result.allocation.ETH).toBeLessThanOrEqual(1);
        expect(result.allocation.USDC).toBeGreaterThanOrEqual(0);
        expect(result.allocation.USDC).toBeLessThanOrEqual(1);
      }
    },
  );

  it(
    "different ETH prices produce different USD values but same raw balances",
    { timeout: 30000 },
    async () => {
      const [result1, result2] = await Promise.all([
        getPortfolioBalance(AGENT_ADDRESS, "sepolia", 1000),
        getPortfolioBalance(AGENT_ADDRESS, "sepolia", 5000),
      ]);

      // Raw balances are the same (same on-chain data)
      expect(result1.balances.ETH.raw).toBe(result2.balances.ETH.raw);
      expect(result1.balances.USDC.raw).toBe(result2.balances.USDC.raw);

      // But USD values differ based on price input
      if (result1.balances.ETH.raw > 0n) {
        expect(result2.balances.ETH.usdValue).toBeGreaterThan(
          result1.balances.ETH.usdValue,
        );
      }
    },
  );

  it(
    "timestamp is recent (within last 30 seconds)",
    { timeout: 30000 },
    async () => {
      const before = Date.now();
      const result = await getPortfolioBalance(
        AGENT_ADDRESS,
        "sepolia",
        2000,
      );
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    },
  );
});
