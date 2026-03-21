/**
 * Shared test fixtures for agent unit tests.
 */
import type { IntentParse } from "../venice/schemas.js";

/** Create a valid IntentParse with optional overrides. */
export function makeIntent(overrides: Partial<IntentParse> = {}): IntentParse {
  return {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxPerTradeUsd: 200,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
    ...overrides,
  };
}

