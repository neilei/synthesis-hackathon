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
    maxSlippage: 0.005,
    driftThreshold: 0.05,
    ...overrides,
  };
}

/** Create a sample delegation object for audit tests. */
export function makeSampleDelegation(overrides: Record<string, unknown> = {}) {
  return {
    delegate: "0xagent",
    delegator: "0xdelegator",
    authority:
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    caveats: [
      {
        enforcer: "0x1234",
        terms: "0x",
        args: "0x",
      },
    ],
    salt: "0x01",
    signature: "0xsigned",
    ...overrides,
  };
}
