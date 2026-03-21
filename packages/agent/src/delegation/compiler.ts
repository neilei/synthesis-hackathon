/**
 * Intent compilation pipeline. Parses natural language via Venice LLM into structured
 * IntentParse, detects adversarial parameters.
 *
 * Note: Delegation creation has moved to the browser via ERC-7715 (MetaMask Flask).
 * The backend now receives pre-signed permissions and redeems them via ERC-7710.
 * See redeemer.ts for the pull-token functions.
 *
 * @module @maw/agent/delegation/compiler
 */
import { reasoningLlm } from "../venice/llm.js";
import {
  IntentParseLlmSchema,
  IntentParseSchema,
  type IntentParse,
} from "../venice/schemas.js";

// ---------------------------------------------------------------------------
// compileIntent — parse natural language into IntentParse via Venice LLM
// ---------------------------------------------------------------------------

export async function compileIntent(intentText: string): Promise<IntentParse> {
  // Use the LLM-specific schema with explicit array for targetAllocation.
  // Venice/Gemini drops dynamic keys from z.record() in function calling mode
  // because Zod 4 emits `propertyNames` which isn't supported.
  const structuredLlm = reasoningLlm.withStructuredOutput(
    IntentParseLlmSchema,
    { method: "functionCalling" },
  );

  const raw = await structuredLlm.invoke([
    {
      role: "system",
      content: `You are a DeFi intent parser. Given a natural language description of a portfolio rebalancing strategy, extract the structured parameters.

Rules:
- targetAllocation is an array of { token, percentage } pairs that must sum to approximately 1.0
- dailyBudgetUsd is the maximum USD value of trades per day
- timeWindowDays is how many days the delegation should last
- maxTradesPerDay is how many trades per day are allowed (default 10 if not specified)
- maxPerTradeUsd is the maximum USD value of any single trade (default to dailyBudgetUsd if not specified)
- maxSlippage is expressed as a decimal (e.g., 0.5% = 0.005). Default to 0.005 if not specified.
- driftThreshold is expressed as a decimal (e.g., 5% = 0.05). Default to 0.05 if not specified.`,
    },
    { role: "user", content: intentText },
  ]);

  // Convert array-format allocation to Record for downstream consumption
  const allocation: Record<string, number> = {};
  for (const entry of raw.targetAllocation) {
    allocation[entry.token.toUpperCase()] = entry.percentage;
  }

  const intent: IntentParse = {
    targetAllocation: allocation,
    dailyBudgetUsd: raw.dailyBudgetUsd,
    timeWindowDays: raw.timeWindowDays,
    maxTradesPerDay: raw.maxTradesPerDay,
    maxPerTradeUsd: raw.maxPerTradeUsd,
    maxSlippage: raw.maxSlippage,
    driftThreshold: raw.driftThreshold,
  };

  // Post-validate with the canonical schema
  const validated = IntentParseSchema.safeParse(intent);
  if (!validated.success) {
    throw new Error(
      `LLM output failed schema validation: ${validated.error.message}`,
    );
  }

  return validated.data;
}
