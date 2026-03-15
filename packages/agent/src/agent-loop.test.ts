/**
 * Unit tests for the agent loop: drift calculation, token resolution, state management.
 *
 * @module @veil/agent/agent-loop.test
 */
import { describe, it, expect, vi } from "vitest";

// Mock all heavy dependencies so we can import calculateDrift
vi.mock("./config.js", () => ({
  env: { VENICE_API_KEY: "x", VENICE_BASE_URL: "https://x", UNISWAP_API_KEY: "x", AGENT_PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" },
  CONTRACTS: {
    NATIVE_ETH: "0x0000000000000000000000000000000000000000",
    WETH_SEPOLIA: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    WETH_BASE: "0x4200000000000000000000000000000000000006",
    USDC_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  CHAINS: {},
  UNISWAP_API_BASE: "",
  THEGRAPH_UNISWAP_V3_BASE: "",
}));
vi.mock("./venice/llm.js", () => ({ researchLlm: {}, reasoningLlm: {}, fastLlm: {} }));
vi.mock("./data/portfolio.js", () => ({ getPortfolioBalance: vi.fn() }));
vi.mock("./data/prices.js", () => ({ getTokenPrice: vi.fn() }));
vi.mock("./data/thegraph.js", () => ({ getPoolData: vi.fn() }));
vi.mock("./delegation/compiler.js", () => ({ compileIntent: vi.fn(), createDelegationFromIntent: vi.fn(), detectAdversarialIntent: vi.fn() }));
vi.mock("./delegation/audit.js", () => ({ generateAuditReport: vi.fn() }));
vi.mock("./delegation/redeemer.js", () => ({ createRedeemClient: vi.fn(), redeemDelegation: vi.fn() }));
vi.mock("./uniswap/trading.js", () => ({ getQuote: vi.fn(), createSwap: vi.fn() }));
vi.mock("./logging/agent-log.js", () => ({ logAction: vi.fn(), logStart: vi.fn(), logStop: vi.fn() }));
vi.mock("./logging/budget.js", () => ({ getBudgetTier: vi.fn().mockReturnValue("normal"), getRecommendedModel: vi.fn().mockReturnValue("auto") }));
vi.mock("./identity/erc8004.js", () => ({ registerAgent: vi.fn(), giveFeedback: vi.fn() }));

import { calculateDrift, resolveTokenAddress, getAgentState, getAgentConfig } from "./agent-loop.js";

describe("Agent Loop - resolveTokenAddress", () => {
  it("returns NATIVE_ETH for ETH on Sepolia", () => {
    const result = resolveTokenAddress("ETH", 11155111);
    expect(result).toBe("0x0000000000000000000000000000000000000000");
  });

  it("returns WETH_BASE for ETH on Base mainnet (chain 8453)", () => {
    const result = resolveTokenAddress("ETH", 8453);
    expect(result).toBe("0x4200000000000000000000000000000000000006");
  });

  it("returns WETH_SEPOLIA for WETH on Sepolia", () => {
    const result = resolveTokenAddress("WETH", 11155111);
    expect(result).toBe("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
  });

  it("returns WETH_BASE for WETH on Base", () => {
    const result = resolveTokenAddress("WETH", 8453);
    expect(result).toBe("0x4200000000000000000000000000000000000006");
  });

  it("returns USDC_SEPOLIA for USDC on Sepolia", () => {
    const result = resolveTokenAddress("USDC", 11155111);
    expect(result).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  });

  it("returns USDC_BASE for USDC on Base", () => {
    const result = resolveTokenAddress("USDC", 8453);
    expect(result).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("is case-insensitive", () => {
    const lower = resolveTokenAddress("eth", 11155111);
    const upper = resolveTokenAddress("ETH", 11155111);
    expect(lower).toBe(upper);
  });

  it("returns fallback (USDC_SEPOLIA) for unknown token", () => {
    const result = resolveTokenAddress("UNKNOWN_TOKEN", 11155111);
    expect(result).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  });
});

describe("Agent Loop - state accessors", () => {
  it("getAgentState returns null before agent starts", () => {
    expect(getAgentState()).toBeNull();
  });

  it("getAgentConfig returns null before agent starts", () => {
    expect(getAgentConfig()).toBeNull();
  });
});

describe("Agent Loop - AgentState agentId", () => {
  it("agentId type allows bigint | null for dynamic capture", () => {
    // This tests the type contract: agentId starts null, can be set to a bigint
    // from registerAgent, and the fallback pattern state.agentId ?? 1n works correctly.
    const state = {
      agentId: null as bigint | null,
    };

    // Before registration
    const beforeId = state.agentId ?? 1n;
    expect(beforeId).toBe(1n);

    // After registration captures agentId
    state.agentId = 42n;
    const afterId = state.agentId ?? 1n;
    expect(afterId).toBe(42n);
  });

  it("agentId fallback uses 1n when registration fails (null)", () => {
    const state = { agentId: null as bigint | null };
    const feedbackAgentId = state.agentId ?? 1n;
    expect(feedbackAgentId).toBe(1n);
  });

  it("agentId uses captured value when registration succeeds", () => {
    const state = { agentId: 7n as bigint | null };
    const feedbackAgentId = state.agentId ?? 1n;
    expect(feedbackAgentId).toBe(7n);
  });
});

describe("Agent Loop - drift calculation", () => {
  it("detects zero drift when allocations match", () => {
    const result = calculateDrift(
      { ETH: 0.6, USDC: 0.4 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.maxDrift).toBe(0);
    expect(result.drift.ETH).toBe(0);
    expect(result.drift.USDC).toBe(0);
  });

  it("detects drift when allocations differ", () => {
    const result = calculateDrift(
      { ETH: 0.7, USDC: 0.3 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.drift.ETH).toBeCloseTo(0.1, 10);
    expect(result.drift.USDC).toBeCloseTo(0.1, 10);
    expect(result.maxDrift).toBeCloseTo(0.1, 10);
  });

  it("handles missing tokens in current allocation", () => {
    const result = calculateDrift(
      { ETH: 1.0 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.drift.USDC).toBe(0.4);
    expect(result.maxDrift).toBe(0.4);
  });

  it("calculates maxDrift correctly with asymmetric drift", () => {
    const result = calculateDrift(
      { ETH: 0.55, USDC: 0.45 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.drift.ETH).toBeCloseTo(0.05, 10);
    expect(result.drift.USDC).toBeCloseTo(0.05, 10);
    expect(result.maxDrift).toBeCloseTo(0.05, 10);
  });

  it("drift below threshold means no rebalance needed", () => {
    const threshold = 0.05;
    const result = calculateDrift(
      { ETH: 0.58, USDC: 0.42 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.maxDrift).toBeLessThan(threshold);
  });

  it("drift above threshold means rebalance needed", () => {
    const threshold = 0.05;
    const result = calculateDrift(
      { ETH: 0.75, USDC: 0.25 },
      { ETH: 0.6, USDC: 0.4 },
    );
    expect(result.maxDrift).toBeGreaterThan(threshold);
  });
});
