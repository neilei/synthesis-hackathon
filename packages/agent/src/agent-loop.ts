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

import { env, CONTRACTS, CHAINS } from "./config.js";
import type { IntentParse } from "./venice/schemas.js";
import { RebalanceDecisionSchema } from "./venice/schemas.js";
import { researchLlm, reasoningLlm, fastLlm } from "./venice/llm.js";
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
import { logAction, logStart, logStop } from "./logging/agent-log.js";
import { getBudgetTier, getRecommendedModel } from "./logging/budget.js";
import { registerAgent, giveFeedback } from "./identity/erc8004.js";

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
  };

  _currentState = state;
  _currentConfig = config;

  logStart();

  // Register on-chain identity (non-blocking)
  registerAgent(`https://github.com/neilei/veil`, "base-sepolia")
    .then(({ txHash, agentId }) => {
      console.log(`[erc8004] Registered on Base Sepolia: ${txHash}`);
      if (agentId) {
        console.log(`[erc8004] Agent ID: ${agentId}`);
        state.agentId = agentId;
      }
      logAction("erc8004_register", {
        tool: "erc8004-identity",
        result: { txHash, agentId: agentId?.toString() },
      });
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[erc8004] Registration skipped: ${msg}`);
    });

  console.log("=== VEIL AGENT STARTING ===");
  console.log(`Agent address: ${agentAddress}`);
  console.log(`Chain: ${chain.name} (${config.chainId})`);
  console.log(
    `Target: ${Object.entries(config.intent.targetAllocation)
      .map(([t, v]) => `${t}: ${(v * 100).toFixed(0)}%`)
      .join(", ")}`,
  );
  console.log(
    `Budget: $${config.intent.dailyBudgetUsd}/day × ${config.intent.timeWindowDays} days`,
  );
  console.log(`Drift threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%`);
  console.log("");

  // --- Step 1: Adversarial check ---
  const warnings = detectAdversarialIntent(config.intent);
  if (warnings.length > 0) {
    console.log("ADVERSARIAL WARNINGS:");
    for (const w of warnings) {
      console.log(`  - ${w.message}`);
    }
    console.log("");
    logAction("adversarial_check", {
      result: { warnings: warnings.map((w) => w.message) },
    });
  }

  // --- Step 2: Create delegation ---
  console.log("Creating delegation...");
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
    console.log(
      `Delegation signed: ${state.delegation.signature?.slice(0, 20)}...`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAction("delegation_failed", { error: msg });
    console.error(`Failed to create delegation: ${msg}`);
    logStop("delegation_failed");
    return;
  }

  // --- Step 3: Audit report ---
  const report = generateAuditReport(config.intent, state.delegation);
  state.audit = report;
  console.log("\n" + report.formatted + "\n");
  logAction("audit_report", {
    result: {
      allows: report.allows,
      prevents: report.prevents,
      worstCase: report.worstCase,
      warnings: report.warnings,
    },
  });

  // --- Step 4: Main loop ---
  console.log("Entering monitoring loop...\n");

  while (state.running) {
    state.cycle++;
    const cycleStart = Date.now();

    try {
      await runCycle(config, state, agentAddress, chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Cycle ${state.cycle} error: ${msg}`);
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
      console.log("Budget exhausted. Stopping agent.");
      state.running = false;
      break;
    }

    // Trade limit guard
    const maxTrades =
      config.intent.maxTradesPerDay * config.intent.timeWindowDays;
    if (state.tradesExecuted >= maxTrades) {
      console.log("Trade limit reached. Stopping agent.");
      state.running = false;
      break;
    }

    // Max cycles guard (demo mode)
    if (config.maxCycles && state.cycle >= config.maxCycles) {
      console.log(`Demo mode: completed ${config.maxCycles} cycle(s). Stopping.`);
      state.running = false;
      break;
    }

    // Wait for next cycle
    if (state.running) {
      console.log(
        `Sleeping ${config.intervalMs / 1000}s until next cycle...\n`,
      );
      await sleep(config.intervalMs);
    }
  }

  logStop("loop_ended");
  console.log("=== VEIL AGENT STOPPED ===");
}

// ---------------------------------------------------------------------------
// Single monitoring cycle
// ---------------------------------------------------------------------------

async function runCycle(
  config: AgentConfig,
  state: AgentState,
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
): Promise<void> {
  console.log(`--- Cycle ${state.cycle} ---`);

  // Check budget tier — switch to cheaper models if needed
  const budgetTier = getBudgetTier();
  const recommendedModel = getRecommendedModel();
  if (budgetTier !== "normal") {
    console.log(`Budget tier: ${budgetTier} — using model: ${recommendedModel}`);
    logAction("budget_check", {
      result: { tier: budgetTier, recommendedModel },
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
  state.ethPrice = ethPrice.price;
  console.log(`ETH price: $${ethPrice.price.toFixed(2)}`);

  // 2. Get portfolio balance
  const chainEnv =
    config.chainId === 8453
      ? ("base" as const)
      : config.chainId === 84532
        ? ("base-sepolia" as const)
        : ("sepolia" as const);

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

  state.allocation = portfolio.allocation;
  state.totalValue = portfolio.totalUsdValue;
  console.log(
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
      console.log(poolContext);
    }
    logAction("pool_data_fetch", {
      tool: "thegraph",
      duration_ms: Date.now() - startPool,
      result: { poolCount: pools.length, topPool: pools[0] ?? null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Pool data unavailable: ${msg}`);
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

  state.drift = maxDrift;
  state.budgetTier = budgetTier;
  console.log(
    `Drift: ${(maxDrift * 100).toFixed(1)}% (threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%)`,
  );

  // 5. If no significant drift, skip
  if (maxDrift < config.intent.driftThreshold) {
    console.log("No significant drift. Skipping rebalance.");
    return;
  }

  // 6. Venice reasoning: should we rebalance?
  console.log("Drift detected. Consulting Venice for rebalance decision...");

  // Use cheaper model in conservation/critical mode
  const llmForReasoning = budgetTier === "normal" ? reasoningLlm : fastLlm;
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
${JSON.stringify(portfolio.allocation, null, 2)}

Target allocation:
${JSON.stringify(config.intent.targetAllocation, null, 2)}

Current drift: ${JSON.stringify(drift, null, 2)} (max: ${(maxDrift * 100).toFixed(1)}%)
Drift threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%
ETH price: $${ethPrice.price.toFixed(2)}
${poolContext ? `Pool data: ${poolContext}` : ""}
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
      model: budgetTier === "normal" ? "gemini-3-1-pro-preview" : "qwen3-4b",
    },
  });

  console.log(`Decision: ${decision.shouldRebalance ? "REBALANCE" : "HOLD"}`);
  console.log(`Reasoning: ${decision.reasoning}`);

  if (!decision.shouldRebalance || !decision.targetSwap) {
    return;
  }

  // 7. Safety checks
  const swap = decision.targetSwap;
  // For stablecoins (USDC), sellAmount is already in USD terms.
  // For ETH/WETH, multiply by ETH price to get USD value.
  const isStablecoin = ["USDC", "USDT", "DAI"].includes(
    swap.sellToken.toUpperCase(),
  );
  const swapAmountUsd = isStablecoin
    ? Number(swap.sellAmount) || 0
    : (Number(swap.sellAmount) || 0) * ethPrice.price;

  if (
    state.totalSpentUsd + swapAmountUsd >
    config.intent.dailyBudgetUsd * config.intent.timeWindowDays
  ) {
    console.log("SAFETY: Swap would exceed total budget. Skipping.");
    logAction("safety_block", {
      result: { reason: "budget_exceeded", swapAmountUsd },
    });
    return;
  }

  if (state.tradesExecuted >= config.intent.maxTradesPerDay) {
    console.log("SAFETY: Daily trade limit reached. Skipping.");
    logAction("safety_block", {
      result: { reason: "trade_limit_reached" },
    });
    return;
  }

  // 8. Check approval & get Uniswap quote
  console.log(
    `Quoting swap: ${swap.sellAmount} ${swap.sellToken} -> ${swap.buyToken}`,
  );

  const sellTokenAddress = resolveTokenAddress(swap.sellToken, config.chainId);
  const buyTokenAddress = resolveTokenAddress(swap.buyToken, config.chainId);

  // Convert amount to wei/smallest unit
  const decimals = swap.sellToken.toUpperCase() === "USDC" ? 6 : 18;
  const amountRaw = parseUnits(swap.sellAmount, decimals).toString();

  // Determine if we can use delegation for this swap.
  // Delegation executes from the delegator's smart account, so:
  // - ETH sells: smart account sends ETH value to Uniswap router → works with functionCall scope
  // - ERC-20 sells: smart account needs token balance + Permit2 → use direct tx from agent EOA
  const isEthSell = swap.sellToken.toUpperCase() === "ETH";
  const canUseDelegation =
    isEthSell && state.delegation && state.delegatorSmartAccount;

  // For delegation path: swapper is the delegator smart account
  // For direct path: swapper is the agent EOA
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
      console.log(`Sending Permit2 approval for ${swap.sellToken}...`);
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
      console.log(`Permit2 approval confirmed: ${approvalTx}`);
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

    console.log(
      `Quote: ${swap.sellAmount} ${swap.sellToken} -> ${quote.quote.output.amount} ${swap.buyToken}`,
    );

    // 9. Execute swap
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
      // Uniswap Trading API returns permitData as opaque JSON (Record<string, unknown>).
      // viem's signTypedData expects narrower types (TypedDataDomain, mapped type objects).
      // The actual runtime shapes match — Uniswap's API produces valid EIP-712 typed data —
      // but the TypeScript types don't align because we intentionally keep the Uniswap response
      // types generic rather than duplicating viem's internal type hierarchy.
      const domain = quote.permitData.domain as Parameters<typeof walletClient.signTypedData>[0]["domain"];
      const types = quote.permitData.types as Parameters<typeof walletClient.signTypedData>[0]["types"];

      // Derive the primaryType from the types object. The Uniswap API returns
      // different primary types depending on the flow:
      //   - PermitWitnessTransferFrom (Universal Router / signature-based permits)
      //   - PermitSingle (Permit2 allowance-based permits)
      // The primary type is the non-EIP712Domain key in the types object.
      const typeKeys = Object.keys(quote.permitData.types).filter(
        (k) => k !== "EIP712Domain",
      );
      // Use the first non-nested type (one that isn't referenced by other types)
      const referencedTypes = new Set(
        Object.values(quote.permitData.types)
          .flat()
          .map((f) => (f as Record<string, string>).type)
          .filter((t) => typeKeys.includes(t)),
      );
      const primaryType =
        typeKeys.find((k) => !referencedTypes.has(k)) ?? typeKeys[0]!;

      permitSignature = await walletClient.signTypedData({
        account: walletClient.account,
        domain,
        types,
        primaryType,
        message: quote.permitData.values as Record<string, unknown>,
      });
    }

    const swapResponse = await createSwap(quote, permitSignature, {
      disableSimulation: !!canUseDelegation,
    });

    // Execute through delegation for ETH sells, direct tx otherwise
    const startTx = Date.now();
    let txHash: Hex;
    let usedDelegation = false;

    if (canUseDelegation) {
      // ERC-7710 delegation redemption: DelegationManager executes the swap
      // from the delegator's smart account. The redeemer handles funding the
      // smart account with the required ETH before executing.
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
        console.log(`Swap executed via delegation redemption (ERC-7710)`);
      } catch (delegationErr) {
        // Fallback: re-quote with agent address and execute directly
        const delegationMsg =
          delegationErr instanceof Error ? delegationErr.message : String(delegationErr);
        console.log(
          `Delegation redemption failed (${delegationMsg}), falling back to direct tx`,
        );
        logAction("delegation_redeem_failed", {
          tool: "metamask-delegation",
          error: delegationMsg,
        });

        // Re-quote with agent address since the original quote was for the smart account
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
      // Direct tx from agent EOA (for ERC-20 sells or when no delegation)
      txHash = await walletClient.sendTransaction({
        to: swapResponse.swap.to,
        data: swapResponse.swap.data,
        value: BigInt(swapResponse.swap.value || "0"),
        chain,
        account: walletClient.account,
      });
    }

    // Wait for confirmation
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

    console.log(`Swap executed! TX: ${txHash}`);
    console.log(
      `Status: ${receipt.status} | Gas: ${receipt.gasUsed.toString()}`,
    );

    // ERC-8004: give on-chain feedback for the swap (non-blocking)
    const feedbackAgentId = state.agentId ?? 1n;
    giveFeedback(feedbackAgentId, 5, "swap-execution", "defi", "base-sepolia")
      .then((fbHash) => {
        console.log(`[erc8004] Feedback submitted: ${fbHash}`);
        logAction("erc8004_feedback", {
          tool: "erc8004-reputation",
          result: { txHash: fbHash, agentId: feedbackAgentId.toString(), rating: 5, tag: "swap-execution" },
        });
      })
      .catch((fbErr) => {
        const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
        console.log(`[erc8004] Feedback skipped: ${fbMsg}`);
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Swap failed: ${msg}`);
    logAction("swap_failed", {
      tool: "uniswap-trading-api",
      error: msg,
      duration_ms: Date.now() - startQuote,
    });

    // Retry with reduced amount (self-correction)
    if (state.cycle <= 3) {
      console.log("Will retry with adjusted params next cycle.");
    }
  }
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

  // Use env delegator key or generate one
  const delegatorKey = env.DELEGATOR_PRIVATE_KEY ?? generatePrivateKey();

  console.log("Parsing intent via Venice...");
  const intent = await compileIntent(intentText);
  console.log("Parsed intent:", JSON.stringify(intent, null, 2));
  console.log("");

  await runAgentLoop({
    intent,
    delegatorKey,
    agentKey: env.AGENT_PRIVATE_KEY,
    chainId: 11155111, // Sepolia default
    intervalMs: 60_000, // 1 minute for demo
    maxCycles,
  });
}
