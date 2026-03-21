/**
 * Delegation parameter computation and audit report generation.
 * Pure functions with no external dependencies — usable in both
 * browser (dashboard) and server (agent) contexts.
 *
 * @module @veil/common/delegation
 */
import type { ParsedIntent, AuditReport } from "./schemas.js";
import { SECONDS_PER_DAY } from "./constants.js";

/** Absolute floor — never price ETH below this regardless of live price. */
export const ETH_PRICE_ABSOLUTE_FLOOR_USD = 500;
const CONSERVATIVE_ETH_PRICE_USD = ETH_PRICE_ABSOLUTE_FLOOR_USD;
const SAFETY_MAX_DAILY_BUDGET_USD = 1_000;
const SAFETY_MAX_TIME_WINDOW_DAYS = 30;
const SAFETY_MAX_SLIPPAGE = 0.02;

// ---------------------------------------------------------------------------
// Delegation parameter computation
// ---------------------------------------------------------------------------

/** Compute delegation expiry as unix timestamp (seconds). */
export function computeExpiryTimestamp(timeWindowDays: number): number {
  return Math.floor(Date.now() / 1000) + timeWindowDays * SECONDS_PER_DAY;
}

/**
 * Compute a conservative ETH price floor from a live price.
 * Halves the live price to give headroom for drops, but never goes
 * below ETH_PRICE_ABSOLUTE_FLOOR_USD ($500).
 *
 * Users can override this in their intent prompt:
 *   "... with ETH floor price $1500" → pass as ethPriceFloor
 *   "... with ETH price $2000"       → pass as liveEthPrice
 */
export function computeConservativeEthPrice(
  liveEthPrice?: number,
  ethPriceFloor?: number,
): number {
  if (ethPriceFloor != null) {
    return Math.max(ethPriceFloor, ETH_PRICE_ABSOLUTE_FLOOR_USD);
  }
  if (liveEthPrice != null) {
    return Math.max(liveEthPrice / 2, ETH_PRICE_ABSOLUTE_FLOOR_USD);
  }
  return CONSERVATIVE_ETH_PRICE_USD;
}

/**
 * Compute the token amount per period for an ERC-7715 periodic permission.
 * For ETH: converts daily USD budget to wei using a conservative price.
 *   - If liveEthPrice is provided, uses livePrice/2 (never below $500 floor).
 *   - If ethPriceFloor is provided, uses that directly (never below $500).
 *   - Otherwise falls back to $500.
 * For USDC: converts daily USD budget to USDC units (6 decimals).
 */
export function computePeriodAmount(
  dailyBudgetUsd: number,
  token: "ETH" | "USDC",
  liveEthPrice?: number,
  ethPriceFloor?: number,
): bigint {
  if (dailyBudgetUsd === 0) return 0n;
  if (token === "USDC") {
    return BigInt(Math.ceil(dailyBudgetUsd * 1e6));
  }
  const price = computeConservativeEthPrice(liveEthPrice, ethPriceFloor);
  const ethAmount = dailyBudgetUsd / price;
  return BigInt(Math.ceil(ethAmount * 1e18));
}

// ---------------------------------------------------------------------------
// Adversarial intent detection
// ---------------------------------------------------------------------------

export interface AdversarialWarning {
  field: string;
  value: number;
  threshold: number;
  message: string;
}

/**
 * Check an intent for parameters that exceed safety thresholds.
 * Returns warnings (does not block deployment).
 */
export function detectAdversarialIntent(
  intent: ParsedIntent,
): AdversarialWarning[] {
  const warnings: AdversarialWarning[] = [];

  if (intent.dailyBudgetUsd > SAFETY_MAX_DAILY_BUDGET_USD) {
    warnings.push({
      field: "dailyBudgetUsd",
      value: intent.dailyBudgetUsd,
      threshold: SAFETY_MAX_DAILY_BUDGET_USD,
      message: `Daily budget $${intent.dailyBudgetUsd} exceeds $${SAFETY_MAX_DAILY_BUDGET_USD.toLocaleString()} safety threshold`,
    });
  }

  if (intent.timeWindowDays > SAFETY_MAX_TIME_WINDOW_DAYS) {
    warnings.push({
      field: "timeWindowDays",
      value: intent.timeWindowDays,
      threshold: SAFETY_MAX_TIME_WINDOW_DAYS,
      message: `Time window ${intent.timeWindowDays} days exceeds ${SAFETY_MAX_TIME_WINDOW_DAYS}-day safety threshold`,
    });
  }

  if (intent.maxSlippage > SAFETY_MAX_SLIPPAGE) {
    warnings.push({
      field: "maxSlippage",
      value: intent.maxSlippage,
      threshold: SAFETY_MAX_SLIPPAGE,
      message: `Max slippage ${(intent.maxSlippage * 100).toFixed(1)}% exceeds ${SAFETY_MAX_SLIPPAGE * 100}% safety threshold`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Audit report generation
// ---------------------------------------------------------------------------

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Generate a human-readable audit report from a parsed intent.
 * This is the "lightweight" audit — it doesn't inspect the delegation object,
 * just the intent parameters. Used in the dashboard before signing.
 */
export function generateAuditReport(intent: ParsedIntent): AuditReport {
  const totalBudget = intent.dailyBudgetUsd * intent.timeWindowDays;
  const totalTrades = intent.maxTradesPerDay * intent.timeWindowDays;
  const slippagePct = (intent.maxSlippage * 100).toFixed(1);
  const driftPct = (intent.driftThreshold * 100).toFixed(1);

  const allocSummary = Object.entries(intent.targetAllocation)
    .map(([token, pct]) => `${token}: ${(pct * 100).toFixed(0)}%`)
    .join(", ");

  const allows = [
    `Trade up to $${intent.dailyBudgetUsd}/day for ${intent.timeWindowDays} days`,
    `Maximum ${intent.maxTradesPerDay} trades per day (${totalTrades} total)`,
    ...(intent.maxPerTradeUsd > 0
      ? [`Maximum $${intent.maxPerTradeUsd} per individual trade`]
      : []),
    `Slippage up to ${slippagePct}%`,
    `Rebalance when drift exceeds ${driftPct}%`,
    `Target allocation: ${allocSummary}`,
  ];

  const expiryDate = new Date(
    Date.now() + intent.timeWindowDays * SECONDS_PER_DAY * 1000,
  );
  const expiryStr = expiryDate.toISOString().split("T")[0];

  const prevents = [
    `Spending more than ${formatUsd(totalBudget)} total`,
    `More than ${totalTrades} trades over the full period`,
    ...(intent.maxPerTradeUsd > 0
      ? [`Any single trade exceeding $${intent.maxPerTradeUsd}`]
      : []),
    `Any activity after ${expiryStr}`,
    `Transfers to non-approved contract targets`,
    `Trading tokens outside the delegation scope`,
  ];

  const slippageLoss = totalBudget * intent.maxSlippage;
  const worstCase =
    `Maximum possible loss: ${formatUsd(totalBudget)} principal ` +
    `+ ${formatUsd(slippageLoss)} slippage ` +
    `= ${formatUsd(totalBudget + slippageLoss)} over ${intent.timeWindowDays} days`;

  const adversarial = detectAdversarialIntent(intent);
  const warnings = adversarial.map((w) => w.message);

  return { allows, prevents, worstCase, warnings };
}
