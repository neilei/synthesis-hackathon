/**
 * Evaluation dimensions for LLM-judged swap quality scoring.
 * Each dimension has a tag, name, criteria prompt, and weight.
 * The schema builder creates a Zod schema dynamically from dimensions,
 * which is used as structured output for Venice LLM evaluation.
 *
 * @module @veil/agent/identity/dimensions
 */
import { z } from "zod";

export interface EvaluationDimension {
  tag: string;
  name: string;
  criteria: string;
  weight: number;
}

function toCamelCase(tag: string): string {
  return tag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export const UNIVERSAL_DIMENSIONS: EvaluationDimension[] = [
  {
    tag: "decision-quality",
    name: "Decision Quality",
    criteria: `Was the decision to trade right now justified by the evidence?
Consider: the relationship between current drift and the threshold,
remaining budget and time, market liquidity relative to trade size,
and whether the agent's stated reasoning is coherent and consistent
with the data it had.`,
    weight: 0.4,
  },
  {
    tag: "execution-quality",
    name: "Execution Quality",
    criteria: `How well was the trade technically executed?
Consider: actual slippage relative to the allowed maximum, gas
efficiency, whether the preferred delegation path was used, and the
total cost of execution (fees + slippage) relative to the trade size.`,
    weight: 0.3,
  },
  {
    tag: "goal-progress",
    name: "Goal Progress",
    criteria: `Did this trade meaningfully advance the portfolio toward its target?
Consider: drift reduction (before vs after), how close the resulting
allocation is to the target, and whether portfolio value was preserved
through the transaction.`,
    weight: 0.3,
  },
];

const INTENT_DIMENSIONS: Record<string, EvaluationDimension[]> = {
  rebalance: [], // no additional dimensions beyond universal for now
};

export function getDimensionsForIntent(
  intentType: string,
): EvaluationDimension[] {
  const specific = INTENT_DIMENSIONS[intentType] ?? [];
  return [...UNIVERSAL_DIMENSIONS, ...specific];
}

export function buildEvaluationSchema(
  dimensions: EvaluationDimension[],
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const dim of dimensions) {
    const camel = toCamelCase(dim.tag);
    shape[`${camel}Score`] = z.number().int().min(0).max(100);
    shape[`${camel}Reasoning`] = z.string();
  }
  return z.object(shape);
}

export function computeCompositeScore(
  dimensions: EvaluationDimension[],
  scores: Record<string, number>,
): number {
  let total = 0;
  let weightSum = 0;
  for (const dim of dimensions) {
    const score = scores[dim.tag];
    if (score !== undefined) {
      total += score * dim.weight;
      weightSum += dim.weight;
    }
  }
  return weightSum > 0 ? total / weightSum : 0;
}
