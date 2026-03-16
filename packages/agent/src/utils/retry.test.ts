/**
 * @module @veil/agent/utils/retry.test
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

vi.mock("../logging/logger.js", () => ({
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

  it("does not retry on non-retryable status (400)", async () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-retryable status (401)", async () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-retryable status (403)", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("forbidden");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-retryable status (404)", async () => {
    const err = Object.assign(new Error("not found"), { status: 404 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-retryable status (422)", async () => {
    const err = Object.assign(new Error("unprocessable"), { status: 422 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("unprocessable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 status", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 status", async () => {
    const err500 = Object.assign(new Error("server error"), { status: 500 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err500)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 status", async () => {
    const err503 = Object.assign(new Error("service unavailable"), {
      status: 503,
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err503)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

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
