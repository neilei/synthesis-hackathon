/**
 * Swap execution pipeline for the agent loop. Handles safety checks,
 * Permit2 approval, Uniswap quoting, delegation redemption (with direct-tx
 * fallback), receipt confirmation, state updates, and ERC-8004 feedback.
 *
 * @module @veil/agent/agent-loop/swap
 */
import type { Address, Hex } from "viem";
import { createWalletClient, createPublicClient, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { sepolia, base } from "viem/chains";

import type { AgentConfig, AgentState } from "./index.js";
import { CONTRACTS, env, rpcTransport } from "../config.js";
import { redeemDelegation } from "../delegation/redeemer.js";
import { getQuote, createSwap, checkApproval } from "../uniswap/trading.js";
import { signPermit2Data } from "../uniswap/permit2.js";
import { logAction } from "../logging/agent-log.js";
import { evaluateSwap } from "../identity/judge.js";
import type { SwapEvidenceInput } from "../identity/evidence.js";
import { logger } from "../logging/logger.js";

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
// Swap execution
// ---------------------------------------------------------------------------

export async function executeSwap(
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
      cycle: state.cycle,
      result: { reason: "budget_exceeded", swapAmountUsd },
    });
    config.intentLogger?.log("safety_block", {
      cycle: state.cycle,
      result: { reason: "budget_exceeded", swapAmountUsd },
    });
    return;
  }

  if (state.tradesExecuted >= config.intent.maxTradesPerDay) {
    logger.info("SAFETY: Daily trade limit reached. Skipping.");
    logAction("safety_block", {
      cycle: state.cycle,
      result: { reason: "trade_limit_reached" },
    });
    config.intentLogger?.log("safety_block", {
      cycle: state.cycle,
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
        transport: rpcTransport(chain),
      });
      const approvalClient = createPublicClient({ chain, transport: rpcTransport(chain) });
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
        cycle: state.cycle,
        tool: "uniswap-permit2",
        result: { txHash: approvalTx, token: swap.sellToken },
      });
      config.intentLogger?.log("permit2_approval", {
        cycle: state.cycle,
        tool: "uniswap-permit2",
        result: { txHash: approvalTx, token: swap.sellToken },
      });
    }
  }

  // Snapshot pre-swap state for judge evaluation (before any mutation)
  const beforeSwapAllocation = state.allocation;
  const beforeSwapDrift = state.drift;
  const beforeSwapValue = state.totalValue;

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
      cycle: state.cycle,
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
    config.intentLogger?.log("quote_received", {
      cycle: state.cycle,
      tool: "uniswap-trading-api",
      duration_ms: Date.now() - startQuote,
      result: { input: quote.quote.input, output: quote.quote.output, viaDelegation: !!canUseDelegation },
    });

    logger.info(
      `Quote: ${swap.sellAmount} ${swap.sellToken} -> ${quote.quote.output.amount} ${swap.buyToken}`,
    );

    const walletClient = createWalletClient({
      account: privateKeyToAccount(config.agentKey),
      chain,
      transport: rpcTransport(chain),
    });

    const publicClient = createPublicClient({
      chain,
      transport: rpcTransport(chain),
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
        const isCaveatEnforcement = /Enforcer/i.test(delegationMsg);
        if (isCaveatEnforcement) {
          logger.warn(
            { err: delegationErr },
            `Delegation caveat enforced: ${delegationMsg}. Safety constraints are working. Falling back to direct tx.`,
          );
          logAction("delegation_caveat_enforced", {
            cycle: state.cycle,
            tool: "metamask-delegation",
            result: { enforcer: delegationMsg, action: "fallback_to_direct_tx" },
          });
          config.intentLogger?.log("delegation_caveat_enforced", {
            cycle: state.cycle,
            tool: "metamask-delegation",
            result: { enforcer: delegationMsg, action: "fallback_to_direct_tx" },
          });
        } else {
          logger.warn({ err: delegationErr }, "Delegation redemption failed, falling back to direct tx");
          logAction("delegation_redeem_failed", {
            cycle: state.cycle,
            tool: "metamask-delegation",
            error: delegationMsg,
          });
          config.intentLogger?.log("delegation_redeem_failed", {
            cycle: state.cycle,
            tool: "metamask-delegation",
            error: delegationMsg,
          });
        }

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

    const swapResult = {
      txHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      sellToken: swap.sellToken,
      buyToken: swap.buyToken,
      sellAmount: swap.sellAmount,
      viaDelegation: usedDelegation,
    };

    logAction("swap_executed", {
      cycle: state.cycle,
      tool: "uniswap-via-delegation",
      duration_ms: Date.now() - startTx,
      result: swapResult,
    });

    // Write to per-intent log
    config.intentLogger?.log("swap_executed", {
      cycle: state.cycle,
      tool: "uniswap-via-delegation",
      duration_ms: Date.now() - startTx,
      result: swapResult,
    });

    logger.info(`Swap executed! TX: ${txHash}`);
    logger.info(
      `Status: ${receipt.status} | Gas: ${receipt.gasUsed.toString()}`,
    );

    // ERC-8004: trigger judge evaluation (non-blocking)
    if (state.agentId && env.JUDGE_PRIVATE_KEY) {
      const currentCycle = state.cycle;
      const judgeInput: SwapEvidenceInput = {
        agentId: state.agentId,
        intentId: config.intentId ?? "unknown",
        cycle: currentCycle,
        swapTxHash: txHash,
        intent: {
          targetAllocation: config.intent.targetAllocation,
          dailyBudgetUsd: config.intent.dailyBudgetUsd,
          driftThreshold: config.intent.driftThreshold,
          maxSlippage: config.intent.maxSlippage,
          timeWindowDays: config.intent.timeWindowDays,
          maxTradesPerDay: config.intent.maxTradesPerDay,
        },
        beforeSwap: {
          allocation: { ...beforeSwapAllocation },
          drift: beforeSwapDrift,
          portfolioValueUsd: beforeSwapValue,
        },
        afterSwap: {
          allocation: state.allocation,
          drift: state.drift,
          portfolioValueUsd: state.totalValue,
        },
        execution: {
          sellToken: swap.sellToken,
          buyToken: swap.buyToken,
          sellAmount: swap.sellAmount,
          gasUsed: Number(receipt.gasUsed),
          slippage: 0,
          viaDelegation: usedDelegation,
        },
        agentReasoning: "",
        marketContext: {
          ethPriceUsd: ethPriceUsd,
          poolTvlUsd: 0,
          pool24hVolume: 0,
        },
      };

      logAction("judge_started", { cycle: currentCycle, tool: "venice-judge" });
      config.intentLogger?.log("judge_started", { cycle: currentCycle, tool: "venice-judge" });

      evaluateSwap(judgeInput, "rebalance", state.budgetTier === "critical")
        .then((result) => {
          logger.info(
            {
              composite: result.composite,
              scores: result.scores,
              feedbackTxHash: result.feedbackTxHash,
            },
            "Judge evaluation complete",
          );
          logAction("judge_completed", {
            cycle: currentCycle,
            tool: "venice-judge",
            result: {
              composite: result.composite,
              scores: result.scores,
              requestHash: result.requestHash,
              validationRequestTxHash: result.validationRequestTxHash,
              validationResponseTxHashes: result.validationResponseTxHashes,
              feedbackTxHash: result.feedbackTxHash,
            },
          });
          config.intentLogger?.log("judge_completed", {
            cycle: currentCycle,
            tool: "venice-judge",
            result: {
              composite: result.composite,
              scores: result.scores,
            },
          });
        })
        .catch((judgeErr) => {
          logger.warn({ err: judgeErr }, "Judge evaluation failed");
          logAction("judge_failed", {
            cycle: currentCycle,
            tool: "venice-judge",
            error: judgeErr instanceof Error ? judgeErr.message : String(judgeErr),
          });
          config.intentLogger?.log("judge_failed", {
            cycle: currentCycle,
            tool: "venice-judge",
            error: judgeErr instanceof Error ? judgeErr.message : String(judgeErr),
          });
        });
    } else if (!state.agentId) {
      logger.warn("Skipping judge evaluation — no agent ID registered");
    } else {
      logger.warn("Skipping judge evaluation — no JUDGE_PRIVATE_KEY configured");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Swap failed");
    logAction("swap_failed", {
      cycle: state.cycle,
      tool: "uniswap-trading-api",
      error: msg,
      duration_ms: Date.now() - startQuote,
    });
    config.intentLogger?.log("swap_failed", {
      cycle: state.cycle,
      tool: "uniswap-trading-api",
      error: msg,
      duration_ms: Date.now() - startQuote,
    });

    if (state.cycle <= 3) {
      logger.info("Will retry with adjusted params next cycle.");
    }
  }
}
