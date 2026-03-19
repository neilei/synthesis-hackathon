/**
 * E2E tests for intent compilation against live Venice LLM.
 *
 * @module @veil/agent/delegation/compiler.e2e.test
 */
import { describe, it, expect } from "vitest";
import { compileIntent } from "../compiler.js";
import { detectAdversarialIntent } from "@veil/common";
import { IntentParseSchema } from "../../venice/schemas.js";

describe("compileIntent (e2e)", () => {
  it(
    "parses standard intent into valid IntentParse schema",
    { timeout: 120000 },
    async () => {
      const result = await compileIntent(
        "60/40 ETH/USDC, max $200 per day, 7 days",
      );

      // Must pass schema validation
      const validated = IntentParseSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        const data = validated.data;

        // Allocation should match the intent closely
        expect(data.targetAllocation.ETH).toBeCloseTo(0.6, 0);
        expect(data.targetAllocation.USDC).toBeCloseTo(0.4, 0);

        // Allocations must sum to ~1.0
        const allocSum = Object.values(data.targetAllocation).reduce(
          (a, b) => a + b,
          0,
        );
        expect(allocSum).toBeCloseTo(1.0, 1);

        // Budget and time window match the prompt
        expect(data.dailyBudgetUsd).toBe(200);
        expect(data.timeWindowDays).toBe(7);

        // Reasonable defaults for unspecified values
        expect(data.maxSlippage).toBeGreaterThan(0);
        expect(data.maxSlippage).toBeLessThanOrEqual(0.05);
        expect(data.driftThreshold).toBeGreaterThan(0);
        expect(data.driftThreshold).toBeLessThanOrEqual(0.2);
        expect(data.maxTradesPerDay).toBeGreaterThan(0);

        // Standard intent should not trigger adversarial warnings
        const warnings = detectAdversarialIntent(data);
        expect(warnings).toHaveLength(0);
      }
    },
  );

  it(
    "detects adversarial intent with high budget",
    { timeout: 120000 },
    async () => {
      const result = await compileIntent(
        "80/20 ETH/USDC, $5000 per day, 90 days, 5% slippage tolerance",
      );

      const validated = IntentParseSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        const data = validated.data;
        const warnings = detectAdversarialIntent(data);

        // Should flag at least one issue
        expect(warnings.length).toBeGreaterThan(0);

        // Check that specific warnings match the adversarial inputs
        const warningFields = warnings.map((w) => w.field);

        // $5000/day > $1000 threshold
        expect(warningFields).toContain("dailyBudgetUsd");

        // 90 days > 30 day threshold
        expect(warningFields).toContain("timeWindowDays");

        // 5% slippage > 2% threshold
        expect(warningFields).toContain("maxSlippage");

        // Each warning should have meaningful content
        for (const warning of warnings) {
          expect(warning.message.length).toBeGreaterThan(10);
          expect(typeof warning.value).toBe("number");
          expect(typeof warning.threshold).toBe("number");
          expect(warning.value).toBeGreaterThan(warning.threshold);
        }
      }
    },
  );

  it(
    "handles edge-case single-token allocation",
    { timeout: 180000 },
    async () => {
      const result = await compileIntent(
        "100% ETH, $50 per day, 3 days",
      );

      const validated = IntentParseSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        const data = validated.data;
        expect(data.targetAllocation.ETH).toBeCloseTo(1.0, 0);
        expect(data.dailyBudgetUsd).toBe(50);
        expect(data.timeWindowDays).toBe(3);
      }
    },
  );
});

describe("detectAdversarialIntent", () => {
  it("returns empty array for safe intent", () => {
    const warnings = detectAdversarialIntent({
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxPerTradeUsd: 200,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });

    expect(warnings).toEqual([]);
  });

  it("flags all three adversarial thresholds independently", () => {
    // Only high budget
    const budgetWarnings = detectAdversarialIntent({
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
      dailyBudgetUsd: 2000,
      timeWindowDays: 7,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 2000,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(budgetWarnings).toHaveLength(1);
    expect(budgetWarnings[0].field).toBe("dailyBudgetUsd");

    // Only long duration
    const timeWarnings = detectAdversarialIntent({
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
      dailyBudgetUsd: 100,
      timeWindowDays: 60,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 100,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(timeWarnings).toHaveLength(1);
    expect(timeWarnings[0].field).toBe("timeWindowDays");

    // Only high slippage
    const slippageWarnings = detectAdversarialIntent({
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
      dailyBudgetUsd: 100,
      timeWindowDays: 7,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 100,
      maxSlippage: 0.05,
      driftThreshold: 0.05,
    });
    expect(slippageWarnings).toHaveLength(1);
    expect(slippageWarnings[0].field).toBe("maxSlippage");
  });

  it("boundary values: at-threshold values do not trigger warnings", () => {
    const warnings = detectAdversarialIntent({
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
      dailyBudgetUsd: 1000, // exactly at threshold, not above
      timeWindowDays: 30,
      maxTradesPerDay: 10,
      maxPerTradeUsd: 1000,
      maxSlippage: 0.02,
      driftThreshold: 0.05,
    });

    expect(warnings).toEqual([]);
  });
});
