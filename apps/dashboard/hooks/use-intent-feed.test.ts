/**
 * Tests for the useIntentFeed hook — historical load + SSE live updates.
 *
 * @module @veil/dashboard/hooks/use-intent-feed.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useIntentFeed } from "./use-intent-feed";

// ---------------------------------------------------------------------------
// Mock fetchIntentDetail
// ---------------------------------------------------------------------------
const mockFetchIntentDetail = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchIntentDetail: (...args: unknown[]) => mockFetchIntentDetail(...args),
}));

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  options: Record<string, unknown>;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string, options?: Record<string, unknown>) {
    this.url = url;
    this.options = options ?? {};
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: (e: MessageEvent) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }

  close() {
    this.closed = true;
  }

  // Test helper: simulate an SSE event
  emit(event: string, data: string, id?: string) {
    const listeners = this.listeners[event] ?? [];
    for (const listener of listeners) {
      listener({ data, lastEventId: id ?? "" } as MessageEvent);
    }
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  mockFetchIntentDetail.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIntentFeed", () => {
  it("loads historical entries on mount", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({
      logs: [
        { timestamp: "2026-03-18T00:00:00Z", sequence: 0, action: "worker_start" },
        { timestamp: "2026-03-18T00:01:00Z", sequence: 1, action: "price_fetch", cycle: 1 },
      ],
    });

    const { result } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].action).toBe("worker_start");
    expect(result.current.entries[1].action).toBe("price_fetch");
    expect(mockFetchIntentDetail).toHaveBeenCalledWith("intent-1", "token-1");
  });

  it("returns empty entries when intentId is null", async () => {
    const { result } = renderHook(() => useIntentFeed(null, "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toEqual([]);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("returns empty entries when token is null", async () => {
    const { result } = renderHook(() => useIntentFeed("intent-1", null));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toEqual([]);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("connects EventSource to correct URL with credentials", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({ logs: [] });

    renderHook(() => useIntentFeed("my-intent", "tok"));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    expect(MockEventSource.instances[0].url).toBe(
      "/api/intents/my-intent/events",
    );
    expect(MockEventSource.instances[0].options).toEqual({
      withCredentials: true,
    });
  });

  it("appends live SSE entries", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({
      logs: [
        { timestamp: "2026-03-18T00:00:00Z", sequence: 0, action: "worker_start" },
      ],
    });

    const { result } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);

    // Simulate SSE event
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit(
        "log",
        JSON.stringify({
          timestamp: "2026-03-18T00:02:00Z",
          sequence: 2,
          action: "price_fetch",
          cycle: 1,
        }),
      );
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[1].action).toBe("price_fetch");
    expect(result.current.entries[1].sequence).toBe(2);
  });

  it("deduplicates SSE entries by sequence", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({
      logs: [
        { timestamp: "2026-03-18T00:00:00Z", sequence: 0, action: "worker_start" },
      ],
    });

    const { result } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const es = MockEventSource.instances[0];

    // Send same sequence twice
    act(() => {
      es.emit(
        "log",
        JSON.stringify({
          timestamp: "2026-03-18T00:02:00Z",
          sequence: 0,
          action: "worker_start",
        }),
      );
    });

    // Should still be 1 — duplicate was rejected
    expect(result.current.entries).toHaveLength(1);
  });

  it("skips malformed SSE data", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({ logs: [] });

    const { result } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const es = MockEventSource.instances[0];

    act(() => {
      es.emit("log", "not-valid-json");
    });

    expect(result.current.entries).toHaveLength(0);
  });

  it("reloads historical on SSE error (reconnect)", async () => {
    mockFetchIntentDetail
      .mockResolvedValueOnce({
        logs: [
          { timestamp: "2026-03-18T00:00:00Z", sequence: 0, action: "worker_start" },
        ],
      })
      .mockResolvedValueOnce({
        logs: [
          { timestamp: "2026-03-18T00:00:00Z", sequence: 0, action: "worker_start" },
          { timestamp: "2026-03-18T00:01:00Z", sequence: 1, action: "price_fetch", cycle: 1 },
        ],
      });

    const { result } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);

    // Simulate SSE error → triggers historical reload
    const es = MockEventSource.instances[0];
    await act(async () => {
      es.onerror?.();
      // Wait for the historical reload promise
      await vi.waitFor(() => expect(mockFetchIntentDetail).toHaveBeenCalledTimes(2));
    });

    expect(result.current.entries).toHaveLength(2);
  });

  it("closes EventSource on unmount", async () => {
    mockFetchIntentDetail.mockResolvedValueOnce({ logs: [] });

    const { unmount } = renderHook(() =>
      useIntentFeed("intent-1", "token-1"),
    );

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);

    unmount();

    expect(es.closed).toBe(true);
  });
});
