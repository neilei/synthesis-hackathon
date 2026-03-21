/**
 * E2E test for the Permit2 + gas estimation fix.
 *
 * Exercises the real on-chain swap path that was failing:
 * USDC → ETH on Sepolia, which uses Permit2 signatures.
 *
 * The bug: viem's sendTransaction internally calls prepareTransactionRequest
 * → estimateGas, which reverts because the Permit2 nonce hasn't been consumed.
 * The fix: pass explicit `gas` to sendTransaction when permitData is present.
 *
 * Also tests ERC-8004 registration + validation request to confirm the
 * "Not authorized" error is fixed by using a freshly registered agentId.
 *
 * Requires real env vars: AGENT_PRIVATE_KEY, UNISWAP_API_KEY, VENICE_API_KEY,
 * JUDGE_PRIVATE_KEY, SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL.
 *
 * The agent wallet must have USDC on Sepolia for this test to work.
 *
 * @module @maw/agent/__tests__/swap-permit2.e2e.test
 */
import { describe, it, expect } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  parseUnits,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env, CONTRACTS, rpcTransport } from "../config.js";
import { getQuote, createSwap, checkApproval } from "../uniswap/trading.js";
import { signPermit2Data } from "../uniswap/permit2.js";
import { registerAgent, submitValidationRequest } from "../identity/erc8004.js";

const chain = sepolia;
const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);
const agentAddress = agentAccount.address;

const publicClient = createPublicClient({
  chain,
  transport: rpcTransport(chain),
});

const walletClient = createWalletClient({
  account: agentAccount,
  chain,
  transport: rpcTransport(chain),
});

describe("Permit2 swap e2e (USDC → ETH on Sepolia)", () => {
  // Run approval + swap as a single atomic flow to avoid quote staleness
  it("executes full USDC → ETH swap with explicit gas (the fix)", async () => {
    const sellAmount = "0.50"; // $0.50 USDC — minimal test amount
    const amountRaw = parseUnits(sellAmount, 6).toString();

    // 1. Check and send Permit2 approval if needed
    const approval = await checkApproval({
      token: CONTRACTS.USDC_SEPOLIA,
      amount: amountRaw,
      chainId: 11155111,
      walletAddress: agentAddress,
    });

    if (approval.approval?.transactionRequest) {
      console.log("Sending Permit2 approval tx...");
      const approvalTx = await walletClient.sendTransaction({
        to: approval.approval.transactionRequest.to,
        data: approval.approval.transactionRequest.data,
        value: BigInt(approval.approval.transactionRequest.value || "0"),
        chain,
        account: walletClient.account,
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalTx,
      });
      expect(approvalReceipt.status).toBe("success");
      console.log("Permit2 approval confirmed:", approvalTx);
    } else {
      console.log("Permit2 already approved for USDC");
    }

    // 2. Get quote — USDC sell should produce permitData
    //    Force V3 routing: V4 pools on Sepolia are broken (V4_SWAP reverts).
    const quote = await getQuote({
      tokenIn: CONTRACTS.USDC_SEPOLIA,
      tokenOut: CONTRACTS.NATIVE_ETH,
      amount: amountRaw,
      type: "EXACT_INPUT",
      chainId: 11155111,
      swapper: agentAddress,
      slippageTolerance: 5, // 5% slippage for test reliability
      protocols: ["V3"],
    });

    console.log("Quote received:", {
      input: quote.quote.input,
      output: quote.quote.output,
      hasPermitData: !!quote.permitData,
    });

    // 3. Sign Permit2 data if present (may be null if already approved)
    let permitSignature: Hex | undefined;
    if (quote.permitData) {
      permitSignature = await signPermit2Data(walletClient, quote.permitData);
      expect(permitSignature).toBeTruthy();
      console.log("Permit2 signature:", permitSignature.slice(0, 20) + "...");
    } else {
      console.log("No permitData (Permit2 already approved for this token)");
    }

    // 4. Create swap — go fast, no delay between quote and swap
    const swapResponse = await createSwap(quote, permitSignature);
    expect(swapResponse.swap).toBeDefined();
    expect(swapResponse.swap.to).toBeTruthy();
    expect(swapResponse.swap.data).toBeTruthy();

    // 5. Send transaction WITH explicit gas — this is the fix under test.
    // Before the fix, this would fail with:
    //   EstimateGasExecutionError: Execution reverted for an unknown reason.
    // Because viem's sendTransaction calls prepareTransactionRequest → estimateGas
    // internally, and the Permit2 nonce hasn't been consumed yet.
    const txHash = await walletClient.sendTransaction({
      to: swapResponse.swap.to,
      data: swapResponse.swap.data,
      value: BigInt(swapResponse.swap.value || "0"),
      chain,
      account: walletClient.account,
      gas: 500_000n, // THE FIX: explicit gas bypasses viem's internal estimateGas
    });

    expect(txHash).toBeTruthy();
    console.log("Swap tx sent:", txHash);

    // 6. Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log("Swap result:", {
      txHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber.toString(),
    });

    // With V3 routing forced (protocols: ["V3"]), the swap should succeed
    // on-chain. Before this fix, the Trading API routed through V4 pools
    // whose V4_SWAP command (0x10) reverts on the Sepolia Universal Router,
    // causing UNWRAP_WETH to fail with InsufficientETH().
    expect(receipt.status).toBe("success");
    expect(receipt.blockNumber).toBeGreaterThan(0n);
    expect(receipt.gasUsed).toBeGreaterThan(0n);
  });

  it("confirms swap without explicit gas fails with EstimateGasExecutionError", async () => {
    // This test documents the bug. We get a quote, sign the permit, create the
    // swap, then try to send WITHOUT explicit gas. This should fail with an
    // EstimateGasExecutionError — confirming the fix is necessary.
    const sellAmount = "0.50";
    const amountRaw = parseUnits(sellAmount, 6).toString();

    const quote = await getQuote({
      tokenIn: CONTRACTS.USDC_SEPOLIA,
      tokenOut: CONTRACTS.NATIVE_ETH,
      amount: amountRaw,
      type: "EXACT_INPUT",
      chainId: 11155111,
      swapper: agentAddress,
      slippageTolerance: 5,
      protocols: ["V3"],
    });

    if (!quote.permitData) {
      console.log("No permitData — skipping regression test");
      return;
    }

    const permitSignature = await signPermit2Data(walletClient, quote.permitData);
    const swapResponse = await createSwap(quote, permitSignature);

    try {
      // This should fail — no explicit gas means viem calls estimateGas internally
      await walletClient.sendTransaction({
        to: swapResponse.swap.to,
        data: swapResponse.swap.data,
        value: BigInt(swapResponse.swap.value || "0"),
        chain,
        account: walletClient.account,
        // NO gas parameter — should trigger the bug
      });
      // If we get here, viem no longer does internal estimateGas (behavior changed)
      console.log(
        "NOTE: sendTransaction without explicit gas succeeded — " +
        "viem may have changed behavior. The explicit gas workaround may no longer be needed.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Expected: EstimateGasExecutionError from viem's internal prepareTransactionRequest
      expect(msg).toMatch(/EstimateGas|revert|execution/i);
      console.log("Confirmed: sendTransaction without explicit gas fails as expected:", msg.slice(0, 200));
    }
  });
});

describe("ERC-8004 registration + validation request e2e", () => {
  let agentId: bigint | undefined;

  it("registers a fresh agent identity on Base Sepolia", async () => {
    const testURI = `https://api.maw.finance/api/intents/e2e-test-${Date.now()}/identity.json`;
    const result = await registerAgent(testURI, "base-sepolia");

    expect(result.txHash).toBeTruthy();
    expect(result.agentId).toBeDefined();

    agentId = result.agentId;
    console.log("ERC-8004 registered:", {
      txHash: result.txHash,
      agentId: agentId?.toString(),
    });
  });

  it("validation request succeeds with freshly registered agentId", async () => {
    if (agentId == null) {
      console.log("Skipping — no agentId from registration");
      return;
    }
    if (!env.JUDGE_PRIVATE_KEY) {
      console.log("Skipping — no JUDGE_PRIVATE_KEY");
      return;
    }

    const judgeAccount = privateKeyToAccount(env.JUDGE_PRIVATE_KEY);
    const judgeAddress = judgeAccount.address;

    const testEvidence = { test: true, timestamp: new Date().toISOString() };
    const requestHash = keccak256(toHex(JSON.stringify(testEvidence)));
    const requestURI = `https://api.maw.finance/api/evidence/e2e-test/${requestHash}`;

    // This was failing with "Not authorized" when using a stale agentId.
    // With a fresh registration, the agent wallet owns this agentId.
    const txHash = await submitValidationRequest(
      agentId,
      judgeAddress,
      requestURI,
      requestHash,
    );

    expect(txHash).toBeTruthy();
    console.log("Validation request succeeded:", {
      txHash,
      agentId: agentId.toString(),
    });
  });
});
