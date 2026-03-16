/**
 * Unit tests for GET /api/state proxy route.
 *
 * @module @veil/dashboard/app/api/state/route.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/state", () => {
  it("proxies to agent server and returns response", async () => {
    const mockState = {
      cycle: 1,
      running: true,
      totalValue: 2154.3,
      drift: 0.356,
      trades: 0,
      totalSpent: 0,
      budgetTier: "normal",
      allocation: { ETH: 0.956, USDC: 0.044 },
      target: { ETH: 0.6, USDC: 0.4 },
      ethPrice: 2091.18,
      feed: [],
      transactions: [],
      audit: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockState),
    });

    const response = await GET();
    const data = await response.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3147/api/state",
      { cache: "no-store" },
    );
    expect(response.status).toBe(200);
    expect(data).toEqual(mockState);
  });

  it("forwards non-200 status from agent server", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal error" }),
    });

    const response = await GET();

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Internal error");
  });

  it("returns 502 when agent server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await GET();

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBe("Could not connect to the agent server. Make sure it's running.");
  });

  it("returns 502 when agent server returns invalid JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    // The route calls res.json() which would throw — caught by the outer catch
    const response = await GET();

    expect(response.status).toBe(502);
  });
});
