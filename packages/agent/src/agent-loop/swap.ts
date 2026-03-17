/**
 * Swap execution pipeline for the agent loop. Handles safety checks,
 * Permit2 approval, Uniswap quoting, delegation redemption (with direct-tx
 * fallback), receipt confirmation, state updates, and ERC-8004 feedback.
 *
 * @module @veil/agent/agent-loop/swap
 */
import type { Address, Hex } from "viem";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { sepolia, base } from "viem/chains";

import type { AgentConfig, AgentState } from "./index.js";
import { CONTRACTS } from "../config.js";
import { redeemDelegation } from "../delegation/redeemer.js";
import { getQuote, createSwap, checkApproval } from "../uniswap/trading.js";
import { signPermit2Data } from "../uniswap/permit2.js";
import { logAction } from "../logging/agent-log.js";
import { giveFeedback } from "../identity/erc8004.js";
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
    return;
  }

  if (state.tradesExecuted >= config.intent.maxTradesPerDay) {
    logger.info("SAFETY: Daily trade limit reached. Skipping.");
    logAction("safety_block", {
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
        cycle: state.cycle,
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
          cycle: state.cycle,
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

    // ERC-8004: give on-chain feedback for the swap (non-blocking)
    if (state.agentId) {
      const currentCycle = state.cycle;
      giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
        .then((fbHash) => {
          logger.info({ txHash: fbHash, agentId: state.agentId?.toString() }, "ERC-8004 feedback submitted");
          logAction("erc8004_feedback", {
            cycle: currentCycle,
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
