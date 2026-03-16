/**
 * Unit tests for POST /api/deploy proxy route.
 *
 * @module @veil/dashboard/app/api/deploy/route.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3100/api/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/deploy", () => {
  it("proxies intent to agent server and returns response", async () => {
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

    const request = makeRequest({
      intent: "60/40 ETH/USDC, $200/day, 7 days",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3147/api/deploy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "60/40 ETH/USDC, $200/day, 7 days",
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(data.parsed.targetAllocation).toEqual({ ETH: 0.6, USDC: 0.4 });
  });

  it("forwards 400 from agent server when intent is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Missing intent" }),
    });

    const request = makeRequest({});
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing intent");
  });

  it("forwards 409 when agent is already running", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "Agent already running" }),
    });

    const request = makeRequest({ intent: "test" });
    const response = await POST(request);

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toBe("Agent already running");
  });

  it("returns 502 when agent server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const request = makeRequest({ intent: "test" });
    const response = await POST(request);

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBe("Could not connect to the agent server. Make sure it's running.");
  });

  it("forwards 500 from agent server on Venice failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ error: "Venice API rate limited" }),
    });

    const request = makeRequest({ intent: "60/40 ETH/USDC" });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Venice API rate limited");
  });
});
