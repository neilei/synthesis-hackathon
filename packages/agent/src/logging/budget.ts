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

export function getRecommendedModel(): string {
  const tier = getBudgetTier();
  switch (tier) {
    case "critical":
      return "qwen3-4b"; // cheapest, no web search
    case "conservation":
      return "qwen3-4b"; // cheap model only
    case "normal":
    default:
      return "auto"; // use whatever the caller wants
  }
}

export function resetBudgetState() {
  lastKnownBalance = null;
  totalCallCount = 0;
}
