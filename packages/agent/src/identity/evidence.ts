/**
 * Evidence document creation and content-addressed storage for ERC-8004
 * validation. After each swap, the agent builds an evidence document capturing
 * intent constraints, portfolio state before/after, execution details, and
 * agent reasoning. The document is stored as JSON, hashed with keccak256,
 * and referenced on-chain via the Validation Registry.
 *
 * @module @veil/agent/identity/evidence
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";

const EVIDENCE_BASE_DIR = "data/evidence";
const EVIDENCE_BASE_URL = "https://api.veil.moe/api/evidence";

export interface SwapEvidenceInput {
  agentId: bigint;
  intentId: string;
  cycle: number;
  swapTxHash: string;
  intent: {
    targetAllocation: Record<string, number>;
    dailyBudgetUsd: number;
    driftThreshold: number;
    maxSlippage: number;
    timeWindowDays: number;
    maxTradesPerDay: number;
  };
  beforeSwap: { allocation: Record<string, number>; drift: number; portfolioValueUsd: number };
  afterSwap: { allocation: Record<string, number>; drift: number; portfolioValueUsd: number };
  execution: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    gasUsed: number;
    slippage: number;
    viaDelegation: boolean;
  };
  agentReasoning: string;
  marketContext: { ethPriceUsd: number; poolTvlUsd: number; pool24hVolume: number };
}

export interface SwapEvidence {
  agentId: number;
  intentId: string;
  cycle: number;
  swapTxHash: string;
  intent: SwapEvidenceInput["intent"];
  beforeSwap: SwapEvidenceInput["beforeSwap"];
  afterSwap: SwapEvidenceInput["afterSwap"];
  execution: SwapEvidenceInput["execution"];
  agentReasoning: string;
  marketContext: SwapEvidenceInput["marketContext"];
  timestamp: string;
}

/**
 * Build a structured swap evidence document from raw inputs.
 * Converts bigint agentId to number for JSON serialization and
 * stamps the current ISO timestamp.
 */
export function buildSwapEvidence(input: SwapEvidenceInput): SwapEvidence {
  return {
    agentId: Number(input.agentId),
    intentId: input.intentId,
    cycle: input.cycle,
    swapTxHash: input.swapTxHash,
    intent: input.intent,
    beforeSwap: input.beforeSwap,
    afterSwap: input.afterSwap,
    execution: input.execution,
    agentReasoning: input.agentReasoning,
    marketContext: input.marketContext,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Store an evidence document as content-addressed JSON.
 * The file is named by its keccak256 hash, ensuring idempotent writes
 * and providing a verifiable on-chain reference.
 *
 * @returns The keccak256 hash, local file path, and public URL
 */
export function storeEvidence<T extends object>(
  intentId: string,
  document: T,
): { hash: Hex; filePath: string; url: string } {
  const json = JSON.stringify(document, null, 2);
  const hash = keccak256(toHex(json));

  const dir = join(EVIDENCE_BASE_DIR, intentId);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${hash}.json`);
  writeFileSync(filePath, json, "utf-8");

  const url = `${EVIDENCE_BASE_URL}/${intentId}/${hash}`;
  return { hash, filePath, url };
}
