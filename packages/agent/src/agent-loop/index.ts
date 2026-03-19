/**
 * Main agent orchestrator. Compiles intent into a delegation, then runs a monitoring
 * loop: check drift, reason via Venice, quote and execute swaps on Uniswap, log
 * results. Exposes singleton state for the dashboard server.
 *
 * @module @veil/agent/agent-loop
 */
import type { SwapRecord } from "@veil/common";
import { AIMessage } from "@langchain/core/messages";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, base } from "viem/chains";
import type { Delegation, MetaMaskSmartAccount } from "@metamask/smart-accounts-kit";

import { env } from "../config.js";
import type { IntentParse } from "../venice/schemas.js";
import { RebalanceDecisionSchema } from "../venice/schemas.js";
import { reasoningLlm, fastLlm, FAST_MODEL, RESEARCH_MODEL, REASONING_MODEL } from "../venice/llm.js";
import { detectAdversarialIntent } from "@veil/common";
import {
  compileIntent,
  createDelegationFromIntent,
} from "../delegation/compiler.js";
import { generateDetailedAudit, type DetailedAuditReport } from "../delegation/audit.js";
import { logAction, logStart, logStop } from "../logging/agent-log.js";
import { getBudgetTier } from "../logging/budget.js";
import { registerAgent } from "../identity/erc8004.js";
import { generateAgentAvatar } from "../venice/image.js";
import { logger } from "../logging/logger.js";
import { withRetry } from "../utils/retry.js";

import { gatherMarketData, type MarketData } from "./market-data.js";
import { executeSwap } from "./swap.js";

// Re-export extracted modules for convenience
export { gatherMarketData, type MarketData } from "./market-data.js";
export { executeSwap, resolveTokenAddress } from "./swap.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  intent: IntentParse;
  delegatorKey: `0x${string}`;
  agentKey: `0x${string}`;
  chainId: number;
  intervalMs: number;
  maxCycles?: number; // for demo mode — stop after N cycles
  /** Signal to abort the loop from outside (e.g. worker stop) */
  signal?: AbortSignal;
  /** Called after each cycle with the current state for external persistence */
  onCycleComplete?: (state: AgentState) => void;
  /** Per-intent logger for writing cycle data to intent-specific JSONL */
  intentLogger?: import("../logging/intent-log.js").IntentLogger;
  /** Intent ID for per-intent registration URI */
  intentId?: string;
  /** Pre-existing ERC-8004 agent ID from database (persisted from previous run) */
  existingAgentId?: bigint;
  /** Callback to persist newly registered agentId to database */
  onAgentIdRegistered?: (agentId: string) => void;
  /** Resume from a previous cycle count (persisted from DB on restart) */
  initialCycle?: number;
  /** Resume from a previous trade count */
  initialTradesExecuted?: number;
  /** Resume from a previous total spent */
  initialTotalSpentUsd?: number;
}

export interface AgentState {
  delegation: Delegation | null;
  delegatorSmartAccount: MetaMaskSmartAccount | null;
  tradesExecuted: number;
  totalSpentUsd: number;
  running: boolean;
  cycle: number;
  // Live data exposed for dashboard
  ethPrice: number;
  drift: number;
  allocation: Record<string, number>;
  totalValue: number;
  budgetTier: string;
  transactions: SwapRecord[];
  audit: DetailedAuditReport | null;
  agentId: bigint | null;
  deployError: string | null;
}

// ---------------------------------------------------------------------------
// Drift calculation (exported for testing)
// ---------------------------------------------------------------------------

export function calculateDrift(
  currentAllocation: Record<string, number>,
  targetAllocation: Record<string, number>,
): { drift: Record<string, number>; maxDrift: number } {
  const drift: Record<string, number> = {};
  let maxDrift = 0;

  for (const token of Object.keys(targetAllocation)) {
    const current = currentAllocation[token] ?? 0;
    const target = targetAllocation[token]!;
    const d = Math.abs(current - target);
    drift[token] = d;
    if (d > maxDrift) maxDrift = d;
  }

  return { drift, maxDrift };
}

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

export async function runAgentLoop(config: AgentConfig): Promise<AgentState> {
  const agentAccount = privateKeyToAccount(config.agentKey);
  const agentAddress = agentAccount.address;
  const chain = config.chainId === 8453 ? base : sepolia;

  const state: AgentState = {
    delegation: null,
    delegatorSmartAccount: null,
    tradesExecuted: config.initialTradesExecuted ?? 0,
    totalSpentUsd: config.initialTotalSpentUsd ?? 0,
    running: true,
    cycle: config.initialCycle ?? 0,
    ethPrice: 0,
    drift: 0,
    allocation: {},
    totalValue: 0,
    budgetTier: "normal",
    transactions: [],
    audit: null,
    agentId: null,
    deployError: null,
  };

  logStart();

  // Log privacy guarantee — Venice no-data-retention policy
  logAction("privacy_guarantee", {
    tool: "venice-inference",
    result: {
      provider: "venice.ai",
      dataRetention: "none",
      includeVeniceSystemPrompt: false,
      modelsUsed: [FAST_MODEL, RESEARCH_MODEL, REASONING_MODEL],
      rationale: "DeFi reasoning traces contain alpha-sensitive portfolio data; no-retention inference prevents strategy leakage",
    },
  });
  config.intentLogger?.log("privacy_guarantee", {
    tool: "venice-inference",
    result: { provider: "venice.ai", dataRetention: "none", modelsUsed: [FAST_MODEL, RESEARCH_MODEL, REASONING_MODEL] },
  });

  // Check for existing agentId (persisted from previous run)
  if (config.existingAgentId != null) {
    state.agentId = config.existingAgentId;
    logger.info({ agentId: config.existingAgentId.toString() }, "Resuming with existing ERC-8004 agent ID");
    logAction("erc8004_register", {
      tool: "erc8004-identity",
      result: { agentId: config.existingAgentId.toString(), source: "database" },
    });
    config.intentLogger?.log("erc8004_register", {
      tool: "erc8004-identity",
      result: { agentId: config.existingAgentId.toString(), source: "database" },
    });
  } else {
    // Register new identity for this intent
    try {
      const intentId = config.intentId ?? "unknown";
      const agentURI = `https://api.veil.moe/api/intents/${intentId}/identity.json`;
      const { txHash, agentId } = await withRetry(
        () => registerAgent(agentURI, "base-sepolia"),
        { label: "erc8004:register", maxRetries: 3 },
      );
      logger.info({ txHash, agentId: agentId?.toString() }, "ERC-8004 agent registered");
      if (agentId != null) {
        state.agentId = agentId;
        // Persist to DB so it survives restarts
        config.onAgentIdRegistered?.(agentId.toString());
      }
      logAction("erc8004_register", {
        tool: "erc8004-identity",
        result: { txHash, agentId: agentId?.toString() },
      });
      config.intentLogger?.log("erc8004_register", {
        tool: "erc8004-identity",
        result: { txHash, agentId: agentId?.toString() },
      });
    } catch (err) {
      logger.error({ err }, "ERC-8004 registration failed after retries");
      logAction("erc8004_register_failed", {
        tool: "erc8004-identity",
        error: err instanceof Error ? err.message : String(err),
      });
      config.intentLogger?.log("erc8004_register_failed", {
        tool: "erc8004-identity",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Generate unique avatar image for this agent
  if (state.agentId != null && config.intentId) {
    try {
      await generateAgentAvatar(config.intentId, config.intent);
      logger.info({ intentId: config.intentId }, "Agent avatar generated");
      config.intentLogger?.log("avatar_generated", {
        tool: "venice-image",
        result: { intentId: config.intentId, model: "nano-banana-2" },
      });
    } catch (err) {
      logger.warn({ err, intentId: config.intentId }, "Avatar generation failed — continuing with fallback SVG");
      config.intentLogger?.log("avatar_generation_failed", {
        tool: "venice-image",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // HARD GATE: Do not enter the main loop without an on-chain identity.
  // Without an agentId, no judge evaluation can happen, and the agent
  // would trade without on-chain accountability.
  if (state.agentId == null) {
    const msg = "Cannot start agent: ERC-8004 identity registration failed. No agentId available.";
    logger.error(msg);
    state.deployError = msg;
    state.running = false;
    logAction("agent_halted", { error: msg });
    config.intentLogger?.log("agent_halted", { error: msg });
    return state;
  }

  logger.info("=== VEIL AGENT STARTING ===");
  logger.info(`Agent address: ${agentAddress}`);
  logger.info(`Chain: ${chain.name} (${config.chainId})`);
  logger.info(
    `Target: ${Object.entries(config.intent.targetAllocation)
      .map(([t, v]) => `${t}: ${(v * 100).toFixed(0)}%`)
      .join(", ")}`,
  );
  logger.info(
    `Budget: $${config.intent.dailyBudgetUsd}/day × ${config.intent.timeWindowDays} days`,
  );
  logger.info(`Drift threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%`);

  // --- Step 1: Adversarial check ---
  const warnings = detectAdversarialIntent(config.intent);
  if (warnings.length > 0) {
    logger.warn("ADVERSARIAL WARNINGS:");
    for (const w of warnings) {
      logger.warn(`  - ${w.message}`);
    }
    logAction("adversarial_check", {
      result: { warnings: warnings.map((w) => w.message) },
    });
    config.intentLogger?.log("adversarial_check", {
      result: { warnings: warnings.map((w) => w.message) },
    });
  }

  // --- Step 2: Create delegation ---
  logger.info("Creating delegation...");
  const startDelegation = Date.now();
  try {
    const delegationResult = await createDelegationFromIntent(
      config.intent,
      config.delegatorKey,
      agentAddress,
      config.chainId,
    );
    state.delegation = delegationResult.delegation;
    state.delegatorSmartAccount = delegationResult.delegatorSmartAccount;
    logAction("delegation_created", {
      tool: "metamask-delegation",
      duration_ms: Date.now() - startDelegation,
      result: {
        delegate: agentAddress,
        delegator: "delegator" in state.delegation ? state.delegation.delegator : "unknown",
        signature: state.delegation.signature?.slice(0, 20) + "...",
        caveatsCount:
          "caveats" in state.delegation && Array.isArray(state.delegation.caveats)
            ? state.delegation.caveats.length
            : 0,
      },
    });
    config.intentLogger?.log("delegation_created", {
      tool: "metamask-delegation",
      duration_ms: Date.now() - startDelegation,
      result: {
        delegate: agentAddress,
        caveatsCount:
          "caveats" in state.delegation && Array.isArray(state.delegation.caveats)
            ? state.delegation.caveats.length
            : 0,
      },
    });
    logger.info(
      `Delegation signed: ${state.delegation.signature?.slice(0, 20)}...`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAction("delegation_failed", { error: msg });
    config.intentLogger?.log("delegation_failed", { error: msg });
    logger.error({ err }, "Failed to create delegation");
    state.deployError = msg;
    logStop("delegation_failed");
    return state;
  }

  // --- Step 3: Audit report ---
  const report = generateDetailedAudit(config.intent, state.delegation);
  state.audit = report;
  logger.info("\n" + report.formatted);
  logAction("audit_report", {
    result: {
      allows: report.allows,
      prevents: report.prevents,
      worstCase: report.worstCase,
      warnings: report.warnings,
    },
  });
  config.intentLogger?.log("audit_report", {
    result: {
      allows: report.allows,
      prevents: report.prevents,
      worstCase: report.worstCase,
      warnings: report.warnings,
    },
  });

  // --- Step 4: Main loop ---
  logger.info("Entering monitoring loop...");

  while (state.running) {
    // Check abort signal before each cycle
    if (config.signal?.aborted) {
      logger.info("Abort signal received. Stopping agent.");
      state.running = false;
      break;
    }

    state.cycle++;
    const cycleStart = Date.now();

    try {
      await runCycle(config, state, agentAddress, chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, cycle: state.cycle }, "Cycle error");
      logAction("cycle_error", {
        cycle: state.cycle,
        parameters: { cycle: state.cycle },
        error: msg,
      });
      config.intentLogger?.log("cycle_error", {
        cycle: state.cycle,
        error: msg,
      });
    }

    const cycleResult = {
      tradesExecuted: state.tradesExecuted,
      totalSpentUsd: state.totalSpentUsd,
      budgetTier: getBudgetTier(),
      allocation: state.allocation,
      drift: state.drift,
      totalValue: state.totalValue,
      ethPrice: state.ethPrice,
    };

    logAction("cycle_complete", {
      cycle: state.cycle,
      parameters: { cycle: state.cycle },
      duration_ms: Date.now() - cycleStart,
      result: cycleResult,
    });

    // Write cycle data to per-intent log
    if (config.intentLogger) {
      config.intentLogger.log("cycle_complete", {
        cycle: state.cycle,
        duration_ms: Date.now() - cycleStart,
        result: cycleResult,
      });
    }

    // Notify external observer (worker persistence)
    config.onCycleComplete?.(state);

    // Budget guard
    const maxBudget =
      config.intent.dailyBudgetUsd * config.intent.timeWindowDays;
    if (state.totalSpentUsd >= maxBudget) {
      logger.info("Budget exhausted. Stopping agent.");
      state.running = false;
      break;
    }

    // Trade limit guard
    const maxTrades =
      config.intent.maxTradesPerDay * config.intent.timeWindowDays;
    if (state.tradesExecuted >= maxTrades) {
      logger.info("Trade limit reached. Stopping agent.");
      state.running = false;
      break;
    }

    // Max cycles guard (demo mode)
    if (config.maxCycles && state.cycle >= config.maxCycles) {
      logger.info(`Demo mode: completed ${config.maxCycles} cycle(s). Stopping.`);
      state.running = false;
      break;
    }

    // Check abort signal before sleeping
    if (config.signal?.aborted) {
      logger.info("Abort signal received. Stopping agent.");
      state.running = false;
      break;
    }

    // Wait for next cycle (interruptible via abort signal)
    if (state.running) {
      logger.info(
        `Sleeping ${config.intervalMs / 1000}s until next cycle...`,
      );
      await abortableSleep(config.intervalMs, config.signal);
    }
  }

  logStop("loop_ended");
  logger.info("=== VEIL AGENT STOPPED ===");
  return state;
}

// ---------------------------------------------------------------------------
// Rebalance decision via Venice
// ---------------------------------------------------------------------------

async function getRebalanceDecision(
  config: AgentConfig,
  state: AgentState,
  market: MarketData & { drift: Record<string, number>; maxDrift: number },
): Promise<{ shouldRebalance: boolean; reasoning: string; marketContext?: string | null; targetSwap?: { sellToken: string; buyToken: string; sellAmount: string; maxSlippage: string } | null }> {
  logger.info("Drift detected. Consulting Venice for rebalance decision...");

  const llmForReasoning = market.budgetTier === "normal" ? reasoningLlm : fastLlm;
  const startReasoning = Date.now();
  const structuredReasoning =
    llmForReasoning.withStructuredOutput(RebalanceDecisionSchema, {
      method: "functionCalling",
      includeRaw: true,
    });

  const rawResponse = await structuredReasoning.invoke([
    {
      role: "system",
      content: `You are a DeFi portfolio rebalancing agent. Analyze the current portfolio state and decide if a rebalance is needed.

Current portfolio:
${JSON.stringify(market.portfolio.allocation, null, 2)}

Target allocation:
${JSON.stringify(config.intent.targetAllocation, null, 2)}

Current drift: ${JSON.stringify(market.drift, null, 2)} (max: ${(market.maxDrift * 100).toFixed(1)}%)
Drift threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%
ETH price: $${market.ethPrice.price.toFixed(2)}
${market.poolContext ? `\nLiquidity data:\n${market.poolContext}\n\nUse the TVL and volume data above to assess whether sufficient liquidity exists for the proposed swap size. If the swap amount is >1% of pool TVL, consider reducing the trade size or splitting across cycles.` : ""}
Trades executed: ${state.tradesExecuted}
Total spent: $${state.totalSpentUsd.toFixed(2)} / $${(config.intent.dailyBudgetUsd * config.intent.timeWindowDays).toFixed(2)}

HARD RULES — violations will be rejected by the safety system:
1. The sellAmount MUST NOT exceed $${config.intent.maxPerTradeUsd > 0 ? config.intent.maxPerTradeUsd : config.intent.dailyBudgetUsd} in USD value (per-trade limit).
2. The sellAmount MUST NOT exceed $${(config.intent.dailyBudgetUsd * config.intent.timeWindowDays - state.totalSpentUsd).toFixed(2)} remaining total budget.
3. maxSlippage MUST NOT exceed ${(config.intent.maxSlippage * 100).toFixed(2)}%.
4. Only trade tokens in the target allocation: ${Object.keys(config.intent.targetAllocation).join(", ")}.
5. If shouldRebalance is true, targetSwap MUST be provided with valid sellAmount.

Size the trade to make meaningful progress on drift while staying well within these limits.`,
    },
    {
      role: "user",
      content:
        "Should the portfolio be rebalanced now? Consider current market conditions and liquidity.",
    },
  ]);

  // LLM structured output can return undefined/null when the response doesn't parse
  const parseResult = RebalanceDecisionSchema.safeParse(rawResponse.parsed);
  if (!parseResult.success) {
    logger.warn({ raw: rawResponse.parsed, zodError: parseResult.error.issues }, "Venice returned unparseable rebalance decision — treating as HOLD");
    return { shouldRebalance: false, reasoning: "LLM response could not be parsed" };
  }
  const decision = parseResult.data;

  const meta = rawResponse.raw instanceof AIMessage ? rawResponse.raw.usage_metadata : undefined;
  const usage = meta
    ? { inputTokens: meta.input_tokens, outputTokens: meta.output_tokens, totalTokens: meta.total_tokens }
    : undefined;

  const decisionResult: Record<string, unknown> = {
    shouldRebalance: decision.shouldRebalance,
    reasoning: decision.reasoning,
    marketContext: decision.marketContext,
    model: market.budgetTier === "normal" ? REASONING_MODEL : FAST_MODEL,
  };
  if (usage) decisionResult.usage = usage;

  logAction("rebalance_decision", {
    cycle: state.cycle,
    tool: "venice-reasoning",
    duration_ms: Date.now() - startReasoning,
    result: decisionResult,
  });

  // Write to per-intent log
  config.intentLogger?.log("rebalance_decision", {
    cycle: state.cycle,
    tool: "venice-reasoning",
    duration_ms: Date.now() - startReasoning,
    result: decisionResult,
  });

  logger.info(`Decision: ${decision.shouldRebalance ? "REBALANCE" : "HOLD"}`);
  logger.info(`Reasoning: ${decision.reasoning}`);

  return decision;
}

// ---------------------------------------------------------------------------
// Single monitoring cycle (orchestrator)
// ---------------------------------------------------------------------------

async function runCycle(
  config: AgentConfig,
  state: AgentState,
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
): Promise<void> {
  logger.info(`--- Cycle ${state.cycle} ---`);

  const market = await gatherMarketData(config.chainId, agentAddress, state.cycle, config.intentLogger);

  state.ethPrice = market.ethPrice.price;
  state.allocation = market.portfolio.allocation;
  state.totalValue = market.portfolio.totalUsdValue;
  state.budgetTier = market.budgetTier;

  const { drift, maxDrift } = calculateDrift(
    market.portfolio.allocation,
    config.intent.targetAllocation,
  );

  logger.info(
    `Drift: ${(maxDrift * 100).toFixed(1)}% (threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%)`,
  );

  state.drift = maxDrift;

  if (maxDrift < config.intent.driftThreshold) {
    logger.info("No significant drift. Skipping rebalance.");
    return;
  }

  const decision = await getRebalanceDecision(config, state, { ...market, drift, maxDrift });

  if (!decision.shouldRebalance || !decision.targetSwap) {
    return;
  }

  await executeSwap(
    config,
    state,
    decision.targetSwap,
    agentAddress,
    chain,
    market.ethPrice.price,
    decision.reasoning,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep that resolves early if the abort signal fires */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function startFromCli(
  intentText: string,
  maxCycles?: number,
): Promise<void> {
  if (!env.DELEGATOR_PRIVATE_KEY) {
    throw new Error("DELEGATOR_PRIVATE_KEY is not set — cannot start agent without it. Set it in .env and restart.");
  }

  const delegatorKey = env.DELEGATOR_PRIVATE_KEY;

  logger.info("Parsing intent via Venice...");
  const intent = await compileIntent(intentText);
  logger.info({ intent }, "Parsed intent");

  await runAgentLoop({
    intent,
    delegatorKey,
    agentKey: env.AGENT_PRIVATE_KEY,
    chainId: 11155111, // Sepolia default
    intervalMs: 60_000, // 1 minute for demo
    maxCycles,
  });
}
