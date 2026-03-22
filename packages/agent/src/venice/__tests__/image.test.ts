/**
 * Unit tests for Venice image generation — prompt generation and avatar flow.
 * All external calls (LLM, fetch) are mocked.
 *
 * @module @maw/agent/venice/image.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../config.js", () => ({
  env: {
    VENICE_API_KEY: "test-key",
    VENICE_BASE_URL: "https://api.venice.ai/api/v1/",
  },
}));

vi.mock("../../logging/budget.js", () => ({
  updateBudget: vi.fn(),
}));

// Mock the LLM to return a canned prompt
vi.mock("../llm.js", () => ({
  FAST_MODEL: "qwen3-5-9b",
  getVeniceLlm: () => ({
    invoke: vi.fn().mockResolvedValue({
      content:
        "A bloated creature made of candlestick charts sitting in a swamp of liquidity",
    }),
  }),
}));

// Mock fetch globally for the image API + download
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  generateImagePrompt,
  generateAgentAvatar,
  avatarPath,
} from "../image.js";
import type { IntentParse } from "../schemas.js";

const SAMPLE_INTENT: IntentParse = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  driftThreshold: 0.05,
  maxSlippage: 0.01,
  maxTradesPerDay: 3,
  maxPerTradeUsd: 100,
};

describe("generateImagePrompt", () => {
  it("returns a string prompt > 10 chars", async () => {
    const prompt = await generateImagePrompt(SAMPLE_INTENT);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(10);
  });
});

describe("generateAgentAvatar", () => {
  const testIntentId = "test-avatar-gen";
  const testPath = avatarPath(testIntentId);

  beforeEach(() => {
    mockFetch.mockReset();
    // Clean up any leftover test files
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("generates and saves an avatar image", async () => {
    // Mock Venice image API response and image download
    mockFetch.mockImplementation((url: unknown) => {
      if (typeof url === "string" && url.includes("images/generations")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ url: "https://example.com/fake-image.webp" }],
            }),
        });
      }
      // Mock image download
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
    });

    const result = await generateAgentAvatar(testIntentId, SAMPLE_INTENT);

    expect(result).toBe(testPath);
    expect(existsSync(testPath)).toBe(true);
  });

  it("throws on API failure", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("error"),
      }),
    );

    await expect(
      generateAgentAvatar(testIntentId, {
        targetAllocation: { ETH: 0.5, USDC: 0.5 },
        dailyBudgetUsd: 100,
        timeWindowDays: 3,
        driftThreshold: 0.05,
        maxSlippage: 0.01,
        maxTradesPerDay: 3,
        maxPerTradeUsd: 50,
      }),
    ).rejects.toThrow("Venice image API 500");
  });
});

describe("avatarPath", () => {
  it("returns path under data/images with .webp extension", () => {
    const path = avatarPath("my-intent-123");
    expect(path).toBe(join("data", "images", "my-intent-123.webp"));
  });
});
