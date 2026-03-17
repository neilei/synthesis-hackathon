import { describe, it, expect } from "vitest";
import {
  UNIVERSAL_DIMENSIONS,
  getDimensionsForIntent,
  buildEvaluationSchema,
  computeCompositeScore,
} from "../dimensions.js";

describe("evaluation dimensions", () => {
  it("universal dimensions have weights summing to 1.0", () => {
    const total = UNIVERSAL_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it("getDimensionsForIntent returns universal for rebalance", () => {
    const dims = getDimensionsForIntent("rebalance");
    expect(dims.length).toBe(3);
    expect(dims.map((d) => d.tag)).toEqual([
      "decision-quality",
      "execution-quality",
      "goal-progress",
    ]);
  });

  it("buildEvaluationSchema creates valid zod schema", () => {
    const dims = getDimensionsForIntent("rebalance");
    const schema = buildEvaluationSchema(dims);
    const valid = schema.safeParse({
      decisionQualityScore: 85,
      decisionQualityReasoning: "Good decision",
      executionQualityScore: 72,
      executionQualityReasoning: "Okay execution",
      goalProgressScore: 91,
      goalProgressReasoning: "Great progress",
    });
    expect(valid.success).toBe(true);
  });

  it("buildEvaluationSchema rejects scores out of range", () => {
    const dims = getDimensionsForIntent("rebalance");
    const schema = buildEvaluationSchema(dims);
    const invalid = schema.safeParse({
      decisionQualityScore: 150,
      decisionQualityReasoning: "test",
      executionQualityScore: 72,
      executionQualityReasoning: "test",
      goalProgressScore: 91,
      goalProgressReasoning: "test",
    });
    expect(invalid.success).toBe(false);
  });

  it("computeCompositeScore applies weights correctly", () => {
    const dims = getDimensionsForIntent("rebalance");
    const scores = {
      "decision-quality": 80,
      "execution-quality": 70,
      "goal-progress": 90,
    };
    const composite = computeCompositeScore(dims, scores);
    // 80*0.4 + 70*0.3 + 90*0.3 = 32 + 21 + 27 = 80
    expect(composite).toBeCloseTo(80);
  });
});
