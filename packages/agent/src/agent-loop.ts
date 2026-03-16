/**
 * Main agent orchestrator. Compiles intent into a delegation, then runs a monitoring
 * loop: check drift, reason via Venice, quote and execute swaps on Uniswap, log
 * results. Exposes singleton state for the dashboard server.
 *
 * @module @veil/agent/agent-loop
 */
import type { SwapRecord } from "@veil/common";
import type { Address, Hex } from "viem";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, base } from "viem/chains";
import type { Delegation, MetaMaskSmartAccount } from "@metamask/smart-accounts-kit";

import { env, CONTRACTS, type ChainEnv } from "./config.js";
import type { IntentParse } from "./venice/schemas.js";
import { RebalanceDecisionSchema } from "./venice/schemas.js";
import { reasoningLlm, fastLlm } from "./venice/llm.js";
import { getPortfolioBalance } from "./data/portfolio.js";
import { getTokenPrice } from "./data/prices.js";
import { getPoolData } from "./data/thegraph.js";
import {
  compileIntent,
  createDelegationFromIntent,
  detectAdversarialIntent,
} from "./delegation/compiler.js";
import { generateAuditReport, type AuditReport } from "./delegation/audit.js";
import { redeemDelegation } from "./delegation/redeemer.js";
import { getQuote, createSwap, checkApproval } from "./uniswap/trading.js";
import { signPermit2Data } from "./uniswap/permit2.js";
import { logAction, logStart, logStop } from "./logging/agent-log.js";
import { getBudgetTier } from "./logging/budget.js";
import { registerAgent, giveFeedback } from "./identity/erc8004.js";
import { logger } from "./logging/logger.js";
import { withRetry } from "./utils/retry.js";

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
  audit: AuditReport | null;
  agentId: bigint | null;
  deployError: string | null;
}

// Singleton state for dashboard access
let _currentState: AgentState | null = null;
let _currentConfig: AgentConfig | null = null;

export function getAgentState(): AgentState | null {
  return _currentState;
}

export function getAgentConfig(): AgentConfig | null {
  return _currentConfig;
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
// Token address resolution
// ---------------------------------------------------------------------------

export function resolveTokenAddress(symbol: string, chainId: number): Address {
  const map: Record<string, Address> = {
    ETH: chainId === 8453 ? CONTRACTS.WETH_BASE : CONTRACTS.NATIVE_ETH,
    WETH: chainId === 8453 ? CONTRACTS.WETH_BASE : CONTRACTS.WETH_SEPOLIA,
    USDC: chainId === 8453 ? CONTRACTS.USDC_BASE : CONTRACTS.USDC_SEPOLIA,
  };
  return map[symbol.toUpperCase()] ?? CONTRACTS.USDC_SEPOLIA;
}

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

export async function runAgentLoop(config: AgentConfig): Promise<void> {
  const agentAccount = privateKeyToAccount(config.agentKey);
  const agentAddress = agentAccount.address;
  const chain = config.chainId === 8453 ? base : sepolia;

  const state: AgentState = {
    delegation: null,
    delegatorSmartAccount: null,
    tradesExecuted: 0,
    totalSpentUsd: 0,
    running: true,
    cycle: 0,
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

  _currentState = state;
  _currentConfig = config;

  logStart();

  // Register on-chain identity (awaited with retry)
  try {
    const { txHash, agentId } = await withRetry(
      () => registerAgent(`https://github.com/neilei/veil`, "base-sepolia"),
      { label: "erc8004:register", maxRetries: 3 },
    );
    logger.info({ txHash, agentId: agentId?.toString() }, "ERC-8004 agent registered");
    if (agentId) state.agentId = agentId;
    logAction("erc8004_register", {
      tool: "erc8004-identity",
      result: { txHash, agentId: agentId?.toString() },
    });
  } catch (err) {
    logger.error({ err }, "ERC-8004 registration failed after retries");
    logAction("erc8004_register_failed", {
      tool: "erc8004-identity",
      error: err instanceof Error ? err.message : String(err),
    });
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
    logger.info(
      `Delegation signed: ${state.delegation.signature?.slice(0, 20)}...`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAction("delegation_failed", { error: msg });
    logger.error({ err }, "Failed to create delegation");
    state.deployError = msg;
    logStop("delegation_failed");
    return;
  }

  // --- Step 3: Audit report ---
  const report = generateAuditReport(config.intent, state.delegation);
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

  // --- Step 4: Main loop ---
  logger.info("Entering monitoring loop...");

  while (state.running) {
    state.cycle++;
    const cycleStart = Date.now();

    try {
      await runCycle(config, state, agentAddress, chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, cycle: state.cycle }, "Cycle error");
      logAction("cycle_error", {
        parameters: { cycle: state.cycle },
        error: msg,
      });
    }

    logAction("cycle_complete", {
      parameters: { cycle: state.cycle },
      duration_ms: Date.now() - cycleStart,
      result: {
        tradesExecuted: state.tradesExecuted,
        totalSpentUsd: state.totalSpentUsd,
        budgetTier: getBudgetTier(),
      },
    });

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

    // Wait for next cycle
    if (state.running) {
      logger.info(
        `Sleeping ${config.intervalMs / 1000}s until next cycle...`,
      );
      await sleep(config.intervalMs);
    }
  }

  logStop("loop_ended");
  logger.info("=== VEIL AGENT STOPPED ===");
}

// ---------------------------------------------------------------------------
// Market data gathering
// ---------------------------------------------------------------------------

interface MarketData {
  ethPrice: { price: number; citation: string | null };
  portfolio: Awaited<ReturnType<typeof getPortfolioBalance>>;
  poolContext: string;
  drift: Record<string, number>;
  maxDrift: number;
  budgetTier: ReturnType<typeof getBudgetTier>;
}

async function gatherMarketData(
  config: AgentConfig,
  agentAddress: Address,
): Promise<MarketData> {
  const budgetTier = getBudgetTier();
  if (budgetTier !== "normal") {
    logger.info({ budgetTier }, "Budget tier is not normal");
    logAction("budget_check", {
      result: { tier: budgetTier },
    });
  }

  // 1. Get ETH price
  const startPrice = Date.now();
  const ethPrice = await getTokenPrice("ETH");
  logAction("price_fetch", {
    tool: "venice-web-search",
    duration_ms: Date.now() - startPrice,
    result: { price: ethPrice.price, citation: ethPrice.citation },
  });
  logger.info(`ETH price: $${ethPrice.price.toFixed(2)}`);

  // 2. Get portfolio balance
  const chainEnv: ChainEnv =
    config.chainId === 8453
      ? "base"
      : config.chainId === 84532
        ? "base-sepolia"
        : "sepolia";

  const startPortfolio = Date.now();
  const portfolio = await getPortfolioBalance(
    agentAddress,
    chainEnv,
    ethPrice.price,
  );
  logAction("portfolio_check", {
    tool: "viem",
    duration_ms: Date.now() - startPortfolio,
    result: {
      totalUsdValue: portfolio.totalUsdValue,
      allocation: portfolio.allocation,
    },
  });

  logger.info(
    `Portfolio: $${portfolio.totalUsdValue.toFixed(2)} | ` +
      Object.entries(portfolio.allocation)
        .map(([t, v]) => `${t}: ${(v * 100).toFixed(1)}%`)
        .join(", "),
  );

  // 3. Fetch pool data from The Graph
  let poolContext = "";
  const startPool = Date.now();
  try {
    const pools = await getPoolData("WETH", "USDC");
    if (pools.length > 0) {
      const topPool = pools[0];
      const tvl = Number(topPool.totalValueLockedUSD) || 0;
      const volume = Number(topPool.volumeUSD) || 0;
      poolContext = `Top WETH/USDC pool: TVL $${tvl.toLocaleString()}, fee tier ${topPool.feeTier}, volume $${volume.toLocaleString()}`;
      logger.info(poolContext);
    }
    logAction("pool_data_fetch", {
      tool: "thegraph",
      duration_ms: Date.now() - startPool,
      result: { poolCount: pools.length, topPool: pools[0] ?? null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Pool data unavailable");
    logAction("pool_data_fetch", {
      tool: "thegraph",
      duration_ms: Date.now() - startPool,
      error: msg,
    });
  }

  // 4. Calculate drift
  const { drift, maxDrift } = calculateDrift(
    portfolio.allocation,
    config.intent.targetAllocation,
  );

  logger.info(
    `Drift: ${(maxDrift * 100).toFixed(1)}% (threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%)`,
  );

  return { ethPrice, portfolio, poolContext, drift, maxDrift, budgetTier };
}

// ---------------------------------------------------------------------------
// Rebalance decision via Venice
// ---------------------------------------------------------------------------

async function getRebalanceDecision(
  config: AgentConfig,
  state: AgentState,
  market: MarketData,
): Promise<{ shouldRebalance: boolean; reasoning: string; marketContext?: string | null; targetSwap?: { sellToken: string; buyToken: string; sellAmount: string; maxSlippage: string } | null }> {
  logger.info("Drift detected. Consulting Venice for rebalance decision...");

  const llmForReasoning = market.budgetTier === "normal" ? reasoningLlm : fastLlm;
  const startReasoning = Date.now();
  const structuredReasoning =
    llmForReasoning.withStructuredOutput(RebalanceDecisionSchema, {
      method: "functionCalling",
    });

  const decision = await structuredReasoning.invoke([
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
${market.poolContext ? `Pool data: ${market.poolContext}` : ""}
Daily budget: $${config.intent.dailyBudgetUsd}
Trades executed: ${state.tradesExecuted}
Total spent: $${state.totalSpentUsd.toFixed(2)} / $${(config.intent.dailyBudgetUsd * config.intent.timeWindowDays).toFixed(2)}
Max slippage: ${(config.intent.maxSlippage * 100).toFixed(2)}%

Decide whether to rebalance. If yes, specify the swap details. Keep swap amounts conservative — use small amounts relative to the daily budget.`,
    },
    {
      role: "user",
      content:
        "Should the portfolio be rebalanced now? Consider current market conditions.",
    },
  ]);

  logAction("rebalance_decision", {
    tool: "venice-reasoning",
    duration_ms: Date.now() - startReasoning,
    result: {
      shouldRebalance: decision.shouldRebalance,
      reasoning: decision.reasoning,
      marketContext: decision.marketContext,
      model: market.budgetTier === "normal" ? "gemini-3-1-pro-preview" : "qwen3-4b",
    },
  });

  logger.info(`Decision: ${decision.shouldRebalance ? "REBALANCE" : "HOLD"}`);
  logger.info(`Reasoning: ${decision.reasoning}`);

  return decision;
}

// ---------------------------------------------------------------------------
// Swap execution
// ---------------------------------------------------------------------------

async function executeSwap(
  config: AgentConfig,
  state: AgentState,
  swap: { sellToken: string; buyToken: string; sellAmount: string; maxSlippage: string },
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
  ethPriceUsd: number,
): Promise<void> {
  // Safety checks
  const isStablecoin = ["USDC", "USDT", "DAI"].includes(
    swap.sellToken.toUpperCase(),
  );
  const swapAmountUsd = isStablecoin
    ? Number(swap.sellAmount) || 0
    : (Number(swap.sellAmount) || 0) * ethPriceUsd;

  if (
    state.totalSpentUsd + swapAmountUsd >
    config.intent.dailyBudgetUsd * config.intent.timeWindowDays
  ) {
    logger.info("SAFETY: Swap would exceed total budget. Skipping.");
    logAction("safety_block", {
      result: { reason: "budget_exceeded", swapAmountUsd },
    });
    return;
  }

  if (state.tradesExecuted >= config.intent.maxTradesPerDay) {
    logger.info("SAFETY: Daily trade limit reached. Skipping.");
    logAction("safety_block", {
      result: { reason: "trade_limit_reached" },
    });
    return;
  }

  logger.info(
    `Quoting swap: ${swap.sellAmount} ${swap.sellToken} -> ${swap.buyToken}`,
  );

  const sellTokenAddress = resolveTokenAddress(swap.sellToken, config.chainId);
  const buyTokenAddress = resolveTokenAddress(swap.buyToken, config.chainId);

  const decimals = swap.sellToken.toUpperCase() === "USDC" ? 6 : 18;
  const amountRaw = parseUnits(swap.sellAmount, decimals).toString();

  const isEthSell = swap.sellToken.toUpperCase() === "ETH";
  const canUseDelegation =
    isEthSell && state.delegation && state.delegatorSmartAccount;

  const swapperAddress = canUseDelegation
    ? state.delegatorSmartAccount!.address
    : agentAddress;

  // For ERC-20 tokens sold from agent EOA, check if Permit2 approval is needed
  if (!isEthSell && !canUseDelegation) {
    const approval = await checkApproval({
      token: sellTokenAddress,
      amount: amountRaw,
      chainId: config.chainId,
      walletAddress: agentAddress,
    });

    if (approval.approval?.transactionRequest) {
      logger.info(`Sending Permit2 approval for ${swap.sellToken}...`);
      const approvalWallet = createWalletClient({
        account: privateKeyToAccount(config.agentKey),
        chain,
        transport: http(),
      });
      const approvalClient = createPublicClient({ chain, transport: http() });
      const approvalTx = await approvalWallet.sendTransaction({
        to: approval.approval.transactionRequest.to,
        data: approval.approval.transactionRequest.data,
        value: BigInt(approval.approval.transactionRequest.value || "0"),
        chain,
        account: approvalWallet.account,
      });
      await approvalClient.waitForTransactionReceipt({ hash: approvalTx });
      logger.info(`Permit2 approval confirmed: ${approvalTx}`);
      logAction("permit2_approval", {
        tool: "uniswap-permit2",
        result: { txHash: approvalTx, token: swap.sellToken },
      });
    }
  }

  const startQuote = Date.now();
  try {
    const quote = await getQuote({
      tokenIn: sellTokenAddress,
      tokenOut: buyTokenAddress,
      amount: amountRaw,
      type: "EXACT_INPUT",
      chainId: config.chainId,
      swapper: swapperAddress,
      slippageTolerance: config.intent.maxSlippage * 100,
    });

    logAction("quote_received", {
      tool: "uniswap-trading-api",
      duration_ms: Date.now() - startQuote,
      result: {
        input: quote.quote.input,
        output: quote.quote.output,
        routing: quote.routing,
        hasPermitData: !!quote.permitData,
        swapper: swapperAddress,
        viaDelegation: !!canUseDelegation,
      },
    });

    logger.info(
      `Quote: ${swap.sellAmount} ${swap.sellToken} -> ${quote.quote.output.amount} ${swap.buyToken}`,
    );

    const walletClient = createWalletClient({
      account: privateKeyToAccount(config.agentKey),
      chain,
      transport: http(),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    // Sign permit data if present (only for direct tx path — smart account can't sign)
    let permitSignature: Hex | undefined;
    if (quote.permitData && !canUseDelegation) {
      permitSignature = await signPermit2Data(walletClient, quote.permitData);
    }

    const swapResponse = await createSwap(quote, permitSignature, {
      disableSimulation: !!canUseDelegation,
    });

    // Execute through delegation for ETH sells, direct tx otherwise
    const startTx = Date.now();
    let txHash: Hex;
    let usedDelegation = false;

    if (canUseDelegation) {
      try {
        txHash = await redeemDelegation(config.agentKey, chain, {
          delegation: state.delegation!,
          delegatorSmartAccount: state.delegatorSmartAccount!,
          call: {
            to: swapResponse.swap.to as Hex,
            data: swapResponse.swap.data as Hex,
            value: BigInt(swapResponse.swap.value || "0"),
          },
        });
        usedDelegation = true;
        logger.info(`Swap executed via delegation redemption (ERC-7710)`);
      } catch (delegationErr) {
        const delegationMsg =
          delegationErr instanceof Error ? delegationErr.message : String(delegationErr);
        logger.warn({ err: delegationErr }, "Delegation redemption failed, falling back to direct tx");
        logAction("delegation_redeem_failed", {
          tool: "metamask-delegation",
          error: delegationMsg,
        });

        const fallbackQuote = await getQuote({
          tokenIn: sellTokenAddress,
          tokenOut: buyTokenAddress,
          amount: amountRaw,
          type: "EXACT_INPUT",
          chainId: config.chainId,
          swapper: agentAddress,
          slippageTolerance: config.intent.maxSlippage * 100,
        });
        const fallbackSwap = await createSwap(fallbackQuote);
        txHash = await walletClient.sendTransaction({
          to: fallbackSwap.swap.to,
          data: fallbackSwap.swap.data,
          value: BigInt(fallbackSwap.swap.value || "0"),
          chain,
          account: walletClient.account,
        });
      }
    } else {
      txHash = await walletClient.sendTransaction({
        to: swapResponse.swap.to,
        data: swapResponse.swap.data,
        value: BigInt(swapResponse.swap.value || "0"),
        chain,
        account: walletClient.account,
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    state.tradesExecuted++;
    state.totalSpentUsd += swapAmountUsd;
    state.transactions.push({
      txHash,
      sellToken: swap.sellToken,
      buyToken: swap.buyToken,
      sellAmount: swap.sellAmount,
      status: receipt.status,
      timestamp: new Date().toISOString(),
    });

    logAction("swap_executed", {
      tool: "uniswap-via-delegation",
      duration_ms: Date.now() - startTx,
      result: {
        txHash,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        sellToken: swap.sellToken,
        buyToken: swap.buyToken,
        sellAmount: swap.sellAmount,
        viaDelegation: usedDelegation,
      },
    });

    logger.info(`Swap executed! TX: ${txHash}`);
    logger.info(
      `Status: ${receipt.status} | Gas: ${receipt.gasUsed.toString()}`,
    );

    // ERC-8004: give on-chain feedback for the swap (non-blocking)
    if (state.agentId) {
      giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
        .then((fbHash) => {
          logger.info({ txHash: fbHash, agentId: state.agentId?.toString() }, "ERC-8004 feedback submitted");
          logAction("erc8004_feedback", {
            tool: "erc8004-reputation",
            result: { txHash: fbHash, agentId: state.agentId?.toString(), rating: 5, tag: "swap-execution" },
          });
        })
        .catch((fbErr) => {
          logger.warn({ err: fbErr }, "ERC-8004 feedback failed");
        });
    } else {
      logger.warn("Skipping ERC-8004 feedback — no agent ID registered");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Swap failed");
    logAction("swap_failed", {
      tool: "uniswap-trading-api",
      error: msg,
      duration_ms: Date.now() - startQuote,
    });

    if (state.cycle <= 3) {
      logger.info("Will retry with adjusted params next cycle.");
    }
  }
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

  const market = await gatherMarketData(config, agentAddress);

  state.ethPrice = market.ethPrice.price;
  state.allocation = market.portfolio.allocation;
  state.totalValue = market.portfolio.totalUsdValue;
  state.drift = market.maxDrift;
  state.budgetTier = market.budgetTier;

  if (market.maxDrift < config.intent.driftThreshold) {
    logger.info("No significant drift. Skipping rebalance.");
    return;
  }

  const decision = await getRebalanceDecision(config, state, market);

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
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function startFromCli(
  intentText: string,
  maxCycles?: number,
): Promise<void> {
  const { generatePrivateKey } = await import("viem/accounts");

  const delegatorKey = env.DELEGATOR_PRIVATE_KEY ?? generatePrivateKey();

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
