/**
 * Unit tests for client-side API fetch wrappers.
 *
 * @module @veil/dashboard/lib/api.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAgentState, deployAgent } from "./api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchAgentState", () => {
  it("calls /api/state and returns parsed JSON", async () => {
    const mockState = {
      cycle: 3,
      running: true,
      ethPrice: 2000,
      totalValue: 1500,
      drift: 0.02,
      trades: 1,
      totalSpent: 45,
      budgetTier: "$200",
      allocation: { ETH: 0.58, USDC: 0.42 },
      target: { ETH: 0.6, USDC: 0.4 },
      feed: [],
      transactions: [],
      audit: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockState),
    });

    const result = await fetchAgentState();

    expect(mockFetch).toHaveBeenCalledWith("/api/state");
    expect(result).toEqual(mockState);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: "Agent server unreachable" }),
    });

    await expect(fetchAgentState()).rejects.toThrow(
      "Failed to fetch state: unable to reach the agent server",
    );
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchAgentState()).rejects.toThrow("Failed to fetch");
  });
});

describe("deployAgent", () => {
  it("POSTs intent and returns parsed response", async () => {
    const mockResponse = {
      parsed: {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 200,
        timeWindowDays: 7,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
        maxTradesPerDay: 10,
      },
      audit: {
        allows: ["Swap ETH/USDC"],
        prevents: ["External transfers"],
        worstCase: "Max loss: $200",
        warnings: [],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await deployAgent("60/40 ETH/USDC, $200/day, 7 days");

    expect(mockFetch).toHaveBeenCalledWith("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "60/40 ETH/USDC, $200/day, 7 days" }),
    });
    expect(result).toEqual(mockResponse);
  });

  it("throws with server error message on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ error: "Venice API rate limited" }),
    });

    await expect(deployAgent("test")).rejects.toThrow(
      "Venice API rate limited",
    );
  });

  it("throws generic message when error body is unparseable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(deployAgent("test")).rejects.toThrow("Unknown error");
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(deployAgent("test")).rejects.toThrow("Failed to fetch");
  });

  it("throws with status code when error body has no error field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: "something else" }),
    });

    await expect(deployAgent("test")).rejects.toThrow("Deploy failed: 422");
  });
});
