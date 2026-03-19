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
    criteria: `Did the agent's decision to trade respect the user's delegated constraints?
Consider: Was the portfolio drift above the user's configured drift threshold?
Was the proposed trade size within the daily budget and per-trade limit?
Did the agent's stated reasoning reference actual portfolio data?
Was the timing justified by drift urgency rather than trading for its own sake?
A trade that correctly identifies drift above threshold and sizes within limits scores well.`,
    weight: 0.4,
  },
  {
    tag: "execution-quality",
    name: "Execution Quality",
    criteria: `Was the trade technically well-executed within the user's constraints?
Consider: Was actual slippage within the user's configured maximum?
Was the delegation path used when available (preferred over direct tx)?
Did the swap complete successfully on-chain?
Do NOT penalize for gas costs relative to trade size — the user chose the trade size limits.
A successful swap with slippage under the max that used the delegation path scores well.`,
    weight: 0.3,
  },
  {
    tag: "goal-progress",
    name: "Goal Progress",
    criteria: `Did this trade move the portfolio in the correct direction toward the user's target allocation?
Consider: Was drift reduced (compare before vs after)?
Was the sell/buy token pair the right choice to reduce the largest drift?
Was portfolio value preserved through the transaction (no excessive loss)?
Any trade that reduces drift in the correct direction scores well, regardless of magnitude.
Do NOT penalize small trades — the user's per-trade limit determines trade size.`,
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
