/**
 * Venice API budget tracker. Captures x-venice-balance-usd headers to determine
 * budget tier (normal/conservation/critical).
 *
 * @module @maw/agent/logging/budget
 */
let lastKnownBalance: number | null = null;
let totalCallCount = 0;

export function updateBudget(responseHeaders: Record<string, string>) {
  const balanceHeader = responseHeaders["x-venice-balance-usd"];
  if (!balanceHeader) return;

  const parsed = parseFloat(balanceHeader);
  if (isNaN(parsed)) return;

  lastKnownBalance = parsed;
  totalCallCount++;
}

export function getBudgetState() {
  return {
    remainingUsd: lastKnownBalance,
    totalCalls: totalCallCount,
    tier: getBudgetTier(),
  };
}

type BudgetTier = "normal" | "conservation" | "critical";

export function getBudgetTier(): BudgetTier {
  if (lastKnownBalance === null) return "normal";
  if (lastKnownBalance < 0.5) return "critical";
  if (lastKnownBalance < 2) return "conservation";
  return "normal";
}

export function resetBudgetState() {
  lastKnownBalance = null;
  totalCallCount = 0;
}
