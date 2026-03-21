/**
 * Unit tests for environment config validation and contract address constants.
 *
 * @module @maw/agent/config.test
 */
import { describe, it, expect } from "vitest";
import { env, CONTRACTS, CHAINS, UNISWAP_API_BASE } from "../config.js";

describe("config", () => {
  describe("env", () => {
    it("loads VENICE_API_KEY", () => {
      expect(env.VENICE_API_KEY).toBeDefined();
      expect(env.VENICE_API_KEY.length).toBeGreaterThan(0);
    });

    it("loads VENICE_BASE_URL", () => {
      expect(env.VENICE_BASE_URL).toBe("https://api.venice.ai/api/v1/");
    });

    it("loads UNISWAP_API_KEY", () => {
      expect(env.UNISWAP_API_KEY).toBeDefined();
      expect(env.UNISWAP_API_KEY.length).toBeGreaterThan(0);
    });

    it("loads AGENT_PRIVATE_KEY as 0x-prefixed hex", () => {
      expect(env.AGENT_PRIVATE_KEY).toMatch(/^0x[0-9a-fA-F]+$/);
    });

  });

  describe("CONTRACTS", () => {
    it("has DelegationManager address", () => {
      expect(CONTRACTS.DELEGATION_MANAGER).toBe(
        "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
      );
    });

    it("has Permit2 address", () => {
      expect(CONTRACTS.PERMIT2).toBe(
        "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      );
    });

    it("has Sepolia token addresses", () => {
      expect(CONTRACTS.WETH_SEPOLIA).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CONTRACTS.USDC_SEPOLIA).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("has Base token addresses", () => {
      expect(CONTRACTS.WETH_BASE).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CONTRACTS.USDC_BASE).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("has ERC-8004 addresses for Base Sepolia and Mainnet", () => {
      expect(CONTRACTS.IDENTITY_BASE_SEPOLIA).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CONTRACTS.REPUTATION_BASE_SEPOLIA).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CONTRACTS.IDENTITY_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CONTRACTS.REPUTATION_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe("CHAINS", () => {
    it("has sepolia with correct chain id", () => {
      expect(CHAINS.sepolia.id).toBe(11155111);
    });

    it("has base-sepolia with correct chain id", () => {
      expect(CHAINS["base-sepolia"].id).toBe(84532);
    });

    it("has base with correct chain id", () => {
      expect(CHAINS.base.id).toBe(8453);
    });
  });

  describe("constants", () => {
    it("has Uniswap API base URL", () => {
      expect(UNISWAP_API_BASE).toBe(
        "https://trade-api.gateway.uniswap.org/v1",
      );
    });
  });
});
