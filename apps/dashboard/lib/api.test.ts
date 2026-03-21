/**
 * Unit tests for client-side API fetch wrappers.
 *
 * @module @maw/dashboard/lib/api.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchNonce,
  verifySignature,
  parseIntent,
  createIntent,
  fetchIntents,
  fetchIntentDetail,
  deleteIntent,
  getIntentLogsUrl,
} from "./api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

describe("fetchNonce", () => {
  it("calls /api/auth/nonce with wallet and returns nonce", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ nonce: "abc123" }),
    });

    const result = await fetchNonce("0xWALLET");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/nonce?wallet=0xWALLET",
    );
    expect(result).toBe("abc123");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    await expect(fetchNonce("0xWALLET")).rejects.toThrow(
      "Failed to fetch nonce",
    );
  });
});

describe("verifySignature", () => {
  it("posts wallet and signature, returns token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "jwt-token" }),
    });

    const result = await verifySignature("0xWALLET", "0xSIG");

    expect(mockFetch).toHaveBeenCalledWith("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ wallet: "0xWALLET", signature: "0xSIG" }),
    });
    expect(result).toBe("jwt-token");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(verifySignature("0xW", "0xS")).rejects.toThrow(
      "Auth verification failed",
    );
  });
});

// ---------------------------------------------------------------------------
// Intent API
// ---------------------------------------------------------------------------

describe("parseIntent", () => {
  it("POSTs intent text and returns parsed + audit", async () => {
    const mockResponse = {
      parsed: {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 200,
        timeWindowDays: 7,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
        maxTradesPerDay: 10,
        maxPerTradeUsd: 200,
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
      json: () => Promise.resolve(mockResponse),
    });

    const result = await parseIntent("60/40 ETH/USDC");

    expect(mockFetch).toHaveBeenCalledWith("/api/parse-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "60/40 ETH/USDC" }),
    });
    expect(result).toEqual(mockResponse);
  });

  it("throws with error message on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Venice timeout" }),
    });

    await expect(parseIntent("test")).rejects.toThrow("Venice timeout");
  });

  it("throws generic message when error body is unparseable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(parseIntent("test")).rejects.toThrow("Unknown error");
  });
});

describe("createIntent", () => {
  it("POSTs intent body with auth token", async () => {
    const mockResponse = {
      intent: { id: "abc", walletAddress: "0x1" },
      audit: { allows: [], prevents: [], worstCase: "", warnings: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const body = {
      intentText: "60/40",
      parsedIntent: {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 200,
        timeWindowDays: 7,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
        maxTradesPerDay: 10,
        maxPerTradeUsd: 200,
      },
      permissions: "[{\"type\":\"native-token-periodic\",\"context\":\"0xabc\",\"token\":\"ETH\"}]",
      delegationManager: "0xDM1",
      dependencies: "[]",
    };

    const result = await createIntent("my-token", body);

    expect(mockFetch).toHaveBeenCalledWith("/api/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer my-token",
      },
      credentials: "include",
      body: JSON.stringify(body),
    });
    expect(result).toEqual(mockResponse);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    await expect(
      createIntent("bad-token", {
        intentText: "x",
        parsedIntent: {} as never,
        permissions: "[]",
        delegationManager: "0x",
        dependencies: "[]",
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("fetchIntents", () => {
  it("calls GET /api/intents with wallet and auth", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: "1" }, { id: "2" }]),
    });

    const result = await fetchIntents("0xWALLET", "token");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents?wallet=0xWALLET",
      { headers: { Authorization: "Bearer token" }, credentials: "include" },
    );
    expect(result).toHaveLength(2);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(fetchIntents("0xW", "t")).rejects.toThrow(
      "Failed to fetch intents",
    );
  });
});

describe("fetchIntentDetail", () => {
  it("calls GET /api/intents/:id with auth", async () => {
    const detail = { id: "abc", logs: [], liveState: null };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(detail),
    });

    const result = await fetchIntentDetail("abc", "token");

    expect(mockFetch).toHaveBeenCalledWith("/api/intents/abc?limit=10000", {
      headers: { Authorization: "Bearer token" },
      credentials: "include",
    });
    expect(result).toEqual(detail);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(fetchIntentDetail("abc", "t")).rejects.toThrow(
      "Failed to fetch intent",
    );
  });
});

describe("deleteIntent", () => {
  it("calls DELETE /api/intents/:id with auth", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deleteIntent("abc", "token");

    expect(mockFetch).toHaveBeenCalledWith("/api/intents/abc", {
      method: "DELETE",
      headers: { Authorization: "Bearer token" },
      credentials: "include",
    });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(deleteIntent("abc", "t")).rejects.toThrow(
      "Failed to delete intent",
    );
  });
});

describe("getIntentLogsUrl", () => {
  it("returns the correct URL", () => {
    expect(getIntentLogsUrl("my-intent")).toBe("/api/intents/my-intent/logs");
  });
});
