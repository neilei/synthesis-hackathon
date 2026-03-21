import type { AgentLogEntry } from "@veil/common";

export interface CycleSnapshot {
  allocation: Record<string, number>;
  drift: number;
  totalValue: number;
  ethPrice: number;
}

export interface CycleProgress {
  /** Number of completed milestone steps. */
  completed: number;
  /** Expected total milestone steps (adjusts as cycle progresses). */
  total: number;
  /** Human-readable label for the step currently being processed (null when complete). */
  pendingLabel: string | null;
}

export interface CycleGroup {
  cycle: number | null;
  entries: AgentLogEntry[];
  snapshot: CycleSnapshot | null;
  hasError: boolean;
  didRebalance: boolean;
  /** True when a safety_block prevented a swap the agent wanted to execute. */
  wasSafetyBlocked: boolean;
  /** True when the cycle has a terminal entry (cycle_complete or cycle_error). */
  isComplete: boolean;
  /** Step progress for the cycle. */
  progress: CycleProgress;
}

// ---------------------------------------------------------------------------
// Cycle progress computation
// ---------------------------------------------------------------------------
//
// The agent loop emits log entries in a known order, but the exact sequence
// varies based on runtime conditions:
//
// ALWAYS (market data gathering):
//   1. price_fetch
//   2. portfolio_check
//   3. pool_data_fetch
//
// CONDITIONAL (only if drift >= threshold):
//   4. rebalance_decision
//
// CONDITIONAL (only if decision says rebalance):
//   5. quote_received
//   6. swap_executed  OR  swap_failed
//   7. judge_completed  OR  judge_failed
//
// ALWAYS (terminal):
//   8. cycle_complete  OR  cycle_error
//
// Additionally, budget_check only fires when budgetTier !== "normal" (rare).
// permit2_approval, token_pull, permissions_missing,
// and safety_block are intermediate events that don't affect the step count.

/** Milestone actions that count toward progress (in order). */
const MILESTONES_MARKET = ["price_fetch", "portfolio_check", "pool_data_fetch"] as const;

/** Labels shown while a step is pending. */
const PENDING_LABELS: Record<string, string> = {
  price_fetch: "Fetching price",
  portfolio_check: "Checking portfolio",
  pool_data_fetch: "Fetching pool data",
  rebalance_decision: "Analyzing drift",
  quote_received: "Getting quote",
  swap_result: "Executing swap",
  judge_result: "Evaluating result",
  cycle_complete: "Completing cycle",
};

function computeProgress(entries: AgentLogEntry[]): CycleProgress {
  const actions = new Set(entries.map((e) => e.action));
  const isTerminal = actions.has("cycle_complete") || actions.has("cycle_error");

  // Count completed market data milestones (always 3)
  let completed = 0;
  for (const m of MILESTONES_MARKET) {
    if (actions.has(m)) completed++;
  }

  // Determine cycle phase
  const hasDecision = actions.has("rebalance_decision");
  const willRebalance = entries.some(
    (e) =>
      e.action === "rebalance_decision" &&
      e.result != null &&
      typeof e.result === "object" &&
      "shouldRebalance" in e.result &&
      (e.result as Record<string, unknown>).shouldRebalance === true,
  );
  const hasSwapResult = actions.has("swap_executed") || actions.has("swap_failed");
  const hasJudgeResult = actions.has("judge_completed") || actions.has("judge_failed");
  const hasQuote = actions.has("quote_received");
  const hasSafetyBlock = actions.has("safety_block");

  if (hasDecision) completed++;
  if (hasSafetyBlock) completed++;
  if (hasQuote) completed++;
  if (hasSwapResult) completed++;
  if (hasJudgeResult) completed++;
  if (isTerminal) completed++;

  // Determine expected total based on how far we've progressed:
  //
  // Before decision: 3 market + decision + cycle_complete = 5
  //   (we don't know yet if there will be a swap)
  // After decision (hold): 3 market + decision + cycle_complete = 5
  // After decision (rebalance, safety blocked): 3 market + decision + safety_block + complete = 6
  // After decision (rebalance): 3 market + decision + quote + swap + judge + complete = 8
  // Low-drift hold (no decision): 3 market + cycle_complete = 4
  //   (drift was below threshold, Venice wasn't even called)
  let total: number;
  if (isTerminal && !hasDecision) {
    // Cycle ended without a decision — low-drift hold (3 market + complete)
    total = completed;
  } else if (!hasDecision) {
    // In progress, haven't reached decision yet — show base total
    total = 5;
  } else if (willRebalance && hasSafetyBlock) {
    // Decision was rebalance but safety block prevented the swap
    total = 6;
  } else if (willRebalance) {
    total = 8;
  } else {
    // Decision was hold
    total = 5;
  }

  // Find the next pending step label
  let pendingLabel: string | null = null;
  if (!isTerminal) {
    if (!actions.has("price_fetch")) {
      pendingLabel = PENDING_LABELS.price_fetch;
    } else if (!actions.has("portfolio_check")) {
      pendingLabel = PENDING_LABELS.portfolio_check;
    } else if (!actions.has("pool_data_fetch")) {
      pendingLabel = PENDING_LABELS.pool_data_fetch;
    } else if (!hasDecision) {
      pendingLabel = PENDING_LABELS.rebalance_decision;
    } else if (willRebalance && !hasSafetyBlock) {
      if (!hasQuote) {
        pendingLabel = PENDING_LABELS.quote_received;
      } else if (!hasSwapResult) {
        pendingLabel = PENDING_LABELS.swap_result;
      } else if (!hasJudgeResult) {
        pendingLabel = PENDING_LABELS.judge_result;
      } else {
        pendingLabel = PENDING_LABELS.cycle_complete;
      }
    } else {
      pendingLabel = PENDING_LABELS.cycle_complete;
    }
  }

  return { completed, total, pendingLabel };
}

// ---------------------------------------------------------------------------
// Snapshot extraction
// ---------------------------------------------------------------------------

function extractSnapshot(entries: AgentLogEntry[]): CycleSnapshot | null {
  const complete = entries.find((e) => e.action === "cycle_complete");
  if (!complete?.result) return null;
  const r = complete.result;
  if (
    typeof r.allocation !== "object" ||
    r.allocation === null ||
    typeof r.drift !== "number" ||
    typeof r.totalValue !== "number" ||
    typeof r.ethPrice !== "number"
  ) {
    return null;
  }
  return {
    allocation: r.allocation as Record<string, number>,
    drift: r.drift,
    totalValue: r.totalValue,
    ethPrice: r.ethPrice,
  };
}

// ---------------------------------------------------------------------------
// Group feed entries by cycle
// ---------------------------------------------------------------------------

export function groupFeedByCycle(feed: AgentLogEntry[]): CycleGroup[] {
  if (feed.length === 0) return [];

  // Deduplicate entries by sequence number (multiple concurrent loops can
  // produce duplicate log rows — keep only the first occurrence).
  const seen = new Set<number>();
  const deduped: AgentLogEntry[] = [];
  for (const entry of feed) {
    if (seen.has(entry.sequence)) continue;
    seen.add(entry.sequence);
    deduped.push(entry);
  }

  const map = new Map<number | null, AgentLogEntry[]>();
  const order: (number | null)[] = [];

  for (const entry of deduped) {
    const key = entry.cycle ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    const group = map.get(key);
    if (group) group.push(entry);
  }

  return order.map((key) => {
    const entries = map.get(key) ?? [];
    return {
      cycle: key,
      entries,
      snapshot: key !== null ? extractSnapshot(entries) : null,
      hasError: entries.some((e) => !!e.error),
      didRebalance: entries.some((e) => e.action === "swap_executed"),
      wasSafetyBlocked: entries.some((e) => e.action === "safety_block"),
      isComplete: entries.some((e) => e.action === "cycle_complete" || e.action === "cycle_error"),
      progress: key !== null
        ? computeProgress(entries)
        : { completed: entries.length, total: entries.length, pendingLabel: null },
    };
  });
}
