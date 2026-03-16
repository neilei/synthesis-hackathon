/**
 * Intent compilation pipeline. Parses natural language via Venice LLM into structured
 * IntentParse, detects adversarial parameters, creates a MetaMask Smart Account
 * delegation with on-chain caveats (timestamp, limited calls, functionCall scope).
 *
 * @module @veil/agent/delegation/compiler
 */
import type { Address, Hex } from "viem";
import { createPublicClient, encodePacked, http } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createDelegation,
  getSmartAccountsEnvironment,
  toMetaMaskSmartAccount,
  Implementation,
  type Delegation,
  type MetaMaskSmartAccount,
} from "@metamask/smart-accounts-kit";
import { SECONDS_PER_DAY } from "@veil/common";
import { reasoningLlm } from "../venice/llm.js";
import {
  IntentParseLlmSchema,
  IntentParseSchema,
  type IntentParse,
} from "../venice/schemas.js";
import { CONTRACTS } from "../config.js";

// ---------------------------------------------------------------------------
// Safety thresholds for adversarial intent detection
// ---------------------------------------------------------------------------

const SAFETY_MAX_DAILY_BUDGET_USD = 1000;
const SAFETY_MAX_TIME_WINDOW_DAYS = 30;
const SAFETY_MAX_SLIPPAGE = 0.02;
const CONSERVATIVE_ETH_PRICE_USD = 500;

// ---------------------------------------------------------------------------
// Adversarial intent detection
// ---------------------------------------------------------------------------

export interface AdversarialWarning {
  field: string;
  value: number;
  threshold: number;
  message: string;
}

export function detectAdversarialIntent(
  intent: IntentParse,
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
// compileIntent — parse natural language into IntentParse via Venice LLM
// ---------------------------------------------------------------------------

export async function compileIntent(intentText: string): Promise<IntentParse> {
  // Use the LLM-specific schema with explicit array for targetAllocation.
  // Venice/Gemini drops dynamic keys from z.record() in function calling mode
  // because Zod 4 emits `propertyNames` which isn't supported.
  const structuredLlm = reasoningLlm.withStructuredOutput(
    IntentParseLlmSchema,
    { method: "functionCalling" },
  );

  const raw = await structuredLlm.invoke([
    {
      role: "system",
      content: `You are a DeFi intent parser. Given a natural language description of a portfolio rebalancing strategy, extract the structured parameters.

Rules:
- targetAllocation is an array of { token, percentage } pairs that must sum to approximately 1.0
- dailyBudgetUsd is the maximum USD value of trades per day
- timeWindowDays is how many days the delegation should last
- maxTradesPerDay is how many trades per day are allowed (default 10 if not specified)
- maxSlippage is expressed as a decimal (e.g., 0.5% = 0.005). Default to 0.005 if not specified.
- driftThreshold is expressed as a decimal (e.g., 5% = 0.05). Default to 0.05 if not specified.`,
    },
    { role: "user", content: intentText },
  ]);

  // Convert array-format allocation to Record for downstream consumption
  const allocation: Record<string, number> = {};
  for (const entry of raw.targetAllocation) {
    allocation[entry.token.toUpperCase()] = entry.percentage;
  }

  const intent: IntentParse = {
    targetAllocation: allocation,
    dailyBudgetUsd: raw.dailyBudgetUsd,
    timeWindowDays: raw.timeWindowDays,
    maxTradesPerDay: raw.maxTradesPerDay,
    maxSlippage: raw.maxSlippage,
    driftThreshold: raw.driftThreshold,
  };

  // Post-validate with the canonical schema
  const validated = IntentParseSchema.safeParse(intent);
  if (!validated.success) {
    throw new Error(
      `LLM output failed schema validation: ${validated.error.message}`,
    );
  }

  return validated.data;
}

// ---------------------------------------------------------------------------
// createDelegatorSmartAccount — create and optionally deploy a MetaMask
// Smart Account that serves as the delegation authority.
// ---------------------------------------------------------------------------

export async function createDelegatorSmartAccount(
  delegatorKey: `0x${string}`,
  chainId: number,
): Promise<MetaMaskSmartAccount> {
  const chain = chainId === 11155111 ? sepolia : mainnet;
  const publicClient = createPublicClient({ chain, transport: http() });
  const delegatorAccount = privateKeyToAccount(delegatorKey);

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [delegatorAccount.address, [], [], []],
    deploySalt: "0x",
    signer: { account: delegatorAccount },
  });

  return smartAccount;
}

// ---------------------------------------------------------------------------
// createDelegationFromIntent — compile an IntentParse into a signed delegation
// ---------------------------------------------------------------------------

export interface DelegationResult {
  delegation: Delegation;
  delegatorSmartAccount: MetaMaskSmartAccount;
}

export async function createDelegationFromIntent(
  intent: IntentParse,
  delegatorKey: `0x${string}`,
  agentAddress: Address,
  chainId: number,
): Promise<DelegationResult> {
  // Create a MetaMask Smart Account for the delegator.
  // The DelegationManager requires the delegator to be a deployed smart account.
  const delegatorSmartAccount = await createDelegatorSmartAccount(
    delegatorKey,
    chainId,
  );

  const environment = getSmartAccountsEnvironment(chainId);

  // Timestamp caveat: delegation expires after timeWindowDays
  const expiryTimestamp = BigInt(
    Math.floor(Date.now() / 1000) + intent.timeWindowDays * SECONDS_PER_DAY,
  );

  // Limited calls caveat: max trades per day * days
  const totalCalls = BigInt(intent.maxTradesPerDay * intent.timeWindowDays);

  // Build caveats using resolved enforcer addresses from the environment
  const caveats = [
    {
      enforcer: environment.caveatEnforcers.TimestampEnforcer as Address,
      terms: encodePacked(
        ["uint128", "uint128"],
        [0n, expiryTimestamp],
      ),
      args: "0x" as Hex,
    },
    {
      enforcer: environment.caveatEnforcers.LimitedCallsEnforcer as Address,
      terms: encodePacked(["uint256"], [totalCalls]),
      args: "0x" as Hex,
    },
  ];

  // Constrain the agent to only call the Uniswap Universal Router's execute()
  // function, with a max ETH value per call enforced on-chain.
  const totalBudgetUsd = intent.dailyBudgetUsd * intent.timeWindowDays;
  const maxEth = totalBudgetUsd / CONSERVATIVE_ETH_PRICE_USD;
  const maxValueWei = BigInt(Math.ceil(maxEth * 1e18));

  // Resolve Uniswap router for this chain
  const routerAddress =
    chainId === 11155111
      ? CONTRACTS.UNISWAP_ROUTER_SEPOLIA
      : CONTRACTS.UNISWAP_ROUTER_MAINNET;

  // execute(bytes,bytes[],uint256) selector = 0x3593564c
  const EXECUTE_SELECTOR = "0x3593564c" as Hex;

  // The functionCall scope builder defaults valueLte to { maxValue: 0n } if
  // omitted, which blocks all ETH-value calls. Pass it explicitly so the SDK
  // encodes our actual max value into the ValueLteEnforcer caveat.
  const delegation = createDelegation({
    from: delegatorSmartAccount.address as Hex,
    to: agentAddress as Hex,
    environment,
    scope: {
      type: "functionCall" as const,
      targets: [routerAddress],
      selectors: [EXECUTE_SELECTOR],
      valueLte: { maxValue: maxValueWei },
    },
    caveats,
  });

  // Sign the delegation using the smart account's signDelegation method
  const signature = await delegatorSmartAccount.signDelegation({ delegation });

  return {
    delegation: {
      ...delegation,
      signature,
    },
    delegatorSmartAccount,
  };
}
