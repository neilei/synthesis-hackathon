/**
 * @module @veil/agent/utils/retry.test
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry.js";

vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, { label: "test", maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it.each([400, 401, 403, 404, 422])(
    "does not retry on non-retryable status (%i)",
    async (status) => {
      const err = Object.assign(new Error(`error ${status}`), { status });
      const fn = vi.fn().mockRejectedValue(err);
      await expect(
        withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
      ).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500, 503])(
    "retries on %i status",
    async (status) => {
      const err = Object.assign(new Error(`error ${status}`), { status });
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
      const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    },
  );

  it("retries on generic network error (no status)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
