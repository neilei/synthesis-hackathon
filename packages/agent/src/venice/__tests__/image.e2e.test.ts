import { describe, it, expect } from "vitest";
import { generateImagePrompt, generateAgentAvatar, avatarPath } from "../image.js";
import { existsSync, unlinkSync } from "node:fs";

describe("Venice image generation (e2e)", () => {
  it("generates a real image prompt via Venice LLM", async () => {
    const prompt = await generateImagePrompt({
      targetAllocation: { ETH: 0.7, USDC: 0.3 },
      dailyBudgetUsd: 500,
      timeWindowDays: 14,
      driftThreshold: 0.03,
      maxSlippage: 0.005,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 200,
    });

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(20);
    console.log("Generated prompt:", prompt);
  }, 30_000);

  it("generates and saves a real avatar image", async () => {
    const testId = "e2e-test-avatar";
    const path = avatarPath(testId);

    // Clean up from previous runs
    if (existsSync(path)) unlinkSync(path);

    const result = await generateAgentAvatar(testId, {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 3,
      maxPerTradeUsd: 100,
    });

    expect(result).toBe(path);
    expect(existsSync(path)).toBe(true);

    console.log("Avatar saved to:", result);

    // Clean up
    if (existsSync(path)) unlinkSync(path);
  }, 60_000);
});
