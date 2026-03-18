/**
 * Venice LLM judge evaluation service for ERC-8004 validation.
 * After each swap, the judge evaluates performance across configurable
 * dimensions, stores evidence documents, and submits on-chain validation
 * requests/responses + composite reputation feedback.
 *
 * @module @veil/agent/identity/judge
 */
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { EvaluationDimension } from "./dimensions.js";
import {
  getDimensionsForIntent,
  buildEvaluationSchema,
  computeCompositeScore,
} from "./dimensions.js";
import {
  buildSwapEvidence,
  buildSwapFailureEvidence,
  storeEvidence,
  type SwapEvidence,
  type SwapEvidenceInput,
  type SwapFailureEvidence,
  type SwapFailureEvidenceInput,
} from "./evidence.js";
import {
  submitValidationRequest,
  submitValidationResponse,
  giveFeedback,
} from "./erc8004.js";
import { reasoningLlm, fastLlm } from "../venice/llm.js";
import { env } from "../config.js";
import { logger } from "../logging/logger.js";

const JUDGE_SYSTEM_PROMPT = `You are an independent validator auditing an autonomous DeFi agent. You receive structured evidence about a swap the agent executed. Your job: determine whether the agent made good decisions and executed them well. You are not the agent's advocate — you are a skeptical auditor looking for both strengths and weaknesses.

For each dimension, provide:
1. A score from 0-100
2. Your reasoning, citing specific numbers from the evidence

Calibration — what scores mean:
  90-100: Exceptional. The agent handled a complex situation optimally.
  70-89:  Good. Sound decision-making with minor room for improvement.
  50-69:  Adequate. The action was reasonable but not impressive.
  30-49:  Questionable. The agent could have made a better choice.
  0-29:   Poor. The action was harmful or clearly irrational.

Most routine, well-executed swaps should score 65-80. Reserve extreme scores for genuinely exceptional or genuinely poor performance.`;

const JUDGE_FAILURE_SYSTEM_PROMPT = `You are an independent validator auditing an autonomous DeFi agent. The agent attempted a swap that FAILED. You receive structured evidence about the failed attempt. Your job: determine whether the agent's decision to attempt this swap was justified, and how the failure affects its track record.

For each dimension, provide:
1. A score from 0-100
2. Your reasoning, citing specific numbers from the evidence

Calibration for failed swaps:
  Execution Quality: Always 0 — the swap failed, no execution occurred.
  Goal Progress: Always 0 — portfolio unchanged, no progress made.
  Decision Quality: Judge independently — was the attempt reasonable given the data?
    70-89: Failure was due to external factors (network, liquidity); decision was sound.
    40-69: Decision was borderline; agent should have anticipated the failure risk.
    0-39:  Decision was poor; obvious signs the swap would fail were ignored.

The error message and market context are critical inputs for judging decision quality.`;

export function buildJudgePrompt(
  dimensions: EvaluationDimension[],
  evidence: SwapEvidence | SwapFailureEvidence,
): { systemPrompt: string; userPrompt: string } {
  const dimensionBlocks = dimensions
    .map((d) => `${d.name.toUpperCase()}:\n${d.criteria}`)
    .join("\n\n---\n\n");

  const isFailure = "outcome" in evidence && evidence.outcome === "failed";
  const base = isFailure ? JUDGE_FAILURE_SYSTEM_PROMPT : JUDGE_SYSTEM_PROMPT;
  const systemPrompt = `${base}\n\n${dimensionBlocks}`;
  const userPrompt = JSON.stringify(evidence, null, 2);

  return { systemPrompt, userPrompt };
}

export interface JudgeResult {
  scores: Record<string, number>;
  reasonings: Record<string, string>;
  composite: number;
  requestHash: Hex;
  validationRequestTxHash: Hex;
  validationResponseTxHashes: Record<string, Hex>;
  feedbackTxHash: Hex;
}

function toCamelCase(tag: string): string {
  return tag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export async function evaluateSwap(
  input: SwapEvidenceInput,
  intentType: string = "rebalance",
  budgetCritical: boolean = false,
): Promise<JudgeResult> {
  if (!env.JUDGE_PRIVATE_KEY) {
    throw new Error("JUDGE_PRIVATE_KEY is required for swap evaluation");
  }

  const judgeAccount = privateKeyToAccount(env.JUDGE_PRIVATE_KEY);
  const judgeAddress = judgeAccount.address;

  // 1. Build & store evidence
  const evidence = buildSwapEvidence(input);
  const { hash: requestHash, url: requestURI } = storeEvidence(
    input.intentId,
    evidence,
  );

  logger.info(
    { intentId: input.intentId, cycle: input.cycle, requestHash },
    "Judge: evidence stored, submitting validation request",
  );

  // 2. Submit validation request on-chain (agent wallet)
  const validationRequestTxHash = await submitValidationRequest(
    input.agentId,
    judgeAddress,
    requestURI,
    requestHash,
  );

  logger.info(
    { txHash: validationRequestTxHash },
    "Judge: validation request submitted",
  );

  // 3. Venice LLM evaluation
  const dimensions = getDimensionsForIntent(intentType);
  const schema = buildEvaluationSchema(dimensions);
  const { systemPrompt, userPrompt } = buildJudgePrompt(dimensions, evidence);

  const llm = budgetCritical ? fastLlm : reasoningLlm;
  const structuredLlm = llm.withStructuredOutput(schema);
  const llmResult = await structuredLlm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const validated = schema.safeParse(llmResult);
  if (!validated.success) {
    throw new Error(
      `LLM evaluation failed validation: ${validated.error.message}`,
    );
  }

  // 4. Extract scores and reasonings (fields are guaranteed by Zod schema validation above)
  const scores: Record<string, number> = {};
  const reasonings: Record<string, string> = {};
  for (const dim of dimensions) {
    const camel = toCamelCase(dim.tag);
    const scoreVal = validated.data[`${camel}Score`];
    const reasoningVal = validated.data[`${camel}Reasoning`];
    scores[dim.tag] = typeof scoreVal === "number" ? scoreVal : 0;
    reasonings[dim.tag] = typeof reasoningVal === "string" ? reasoningVal : "";
  }

  logger.info({ scores }, "Judge: LLM evaluation complete");

  // 5. Submit validation responses on-chain (judge wallet, one per dimension)
  const validationResponseTxHashes: Record<string, Hex> = {};
  for (const dim of dimensions) {
    const responseDoc = {
      requestHash,
      dimension: dim.tag,
      score: scores[dim.tag],
      reasoning: reasonings[dim.tag],
      model: budgetCritical ? "qwen3-4b" : "gemini-3-flash-preview",
      evaluatedAt: new Date().toISOString(),
    };
    const { hash: responseHash, url: responseURI } = storeEvidence(
      input.intentId,
      responseDoc,
    );

    const txHash = await submitValidationResponse(
      requestHash,
      scores[dim.tag]!,
      responseURI,
      responseHash,
      dim.tag,
    );
    validationResponseTxHashes[dim.tag] = txHash;

    logger.info(
      { dimension: dim.tag, score: scores[dim.tag], txHash },
      "Judge: validation response submitted",
    );
  }

  // 6. Compute composite score and submit reputation feedback (judge wallet)
  const composite = computeCompositeScore(dimensions, scores);
  const compositeScaled = composite / 10; // 0-100 -> 0-10 scale for reputation

  const feedbackDoc = {
    agentId: Number(input.agentId),
    intentId: input.intentId,
    cycle: input.cycle,
    composite: compositeScaled,
    weights: Object.fromEntries(dimensions.map((d) => [d.tag, d.weight])),
    dimensions: scores,
    swapTxHash: input.swapTxHash,
    timestamp: new Date().toISOString(),
  };
  const { hash: feedbackHash, url: feedbackURI } = storeEvidence(
    input.intentId,
    feedbackDoc,
  );

  const feedbackTxHash = await giveFeedback(
    input.agentId,
    compositeScaled,
    "swap-quality",
    intentType,
    "base-sepolia",
    feedbackURI,
    feedbackHash,
  );

  logger.info(
    { composite: compositeScaled, feedbackTxHash },
    "Judge: reputation feedback submitted",
  );

  return {
    scores,
    reasonings,
    composite: compositeScaled,
    requestHash,
    validationRequestTxHash,
    validationResponseTxHashes,
    feedbackTxHash,
  };
}

/**
 * Evaluate a failed swap attempt. Uses the same on-chain pipeline as
 * successful swaps but with failure-specific evidence and system prompt.
 * Execution quality and goal progress are scored by the LLM (expected ~0),
 * while decision quality is judged on whether the attempt was reasonable.
 */
export async function evaluateSwapFailure(
  input: SwapFailureEvidenceInput,
  intentType: string = "rebalance",
  budgetCritical: boolean = false,
): Promise<JudgeResult> {
  if (!env.JUDGE_PRIVATE_KEY) {
    throw new Error("JUDGE_PRIVATE_KEY is required for swap evaluation");
  }

  const judgeAccount = privateKeyToAccount(env.JUDGE_PRIVATE_KEY);
  const judgeAddress = judgeAccount.address;

  // 1. Build & store failure evidence
  const evidence = buildSwapFailureEvidence(input);
  const { hash: requestHash, url: requestURI } = storeEvidence(
    input.intentId,
    evidence,
  );

  logger.info(
    { intentId: input.intentId, cycle: input.cycle, requestHash },
    "Judge: failure evidence stored, submitting validation request",
  );

  // 2. Submit validation request on-chain (agent wallet)
  const validationRequestTxHash = await submitValidationRequest(
    input.agentId,
    judgeAddress,
    requestURI,
    requestHash,
  );

  logger.info(
    { txHash: validationRequestTxHash },
    "Judge: failure validation request submitted",
  );

  // 3. Venice LLM evaluation
  const dimensions = getDimensionsForIntent(intentType);
  const schema = buildEvaluationSchema(dimensions);
  const { systemPrompt, userPrompt } = buildJudgePrompt(dimensions, evidence);

  const llm = budgetCritical ? fastLlm : reasoningLlm;
  const structuredLlm = llm.withStructuredOutput(schema);
  const llmResult = await structuredLlm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const validated = schema.safeParse(llmResult);
  if (!validated.success) {
    throw new Error(
      `LLM failure evaluation failed validation: ${validated.error.message}`,
    );
  }

  // 4. Extract scores and reasonings
  const scores: Record<string, number> = {};
  const reasonings: Record<string, string> = {};
  for (const dim of dimensions) {
    const camel = toCamelCase(dim.tag);
    const scoreVal = validated.data[`${camel}Score`];
    const reasoningVal = validated.data[`${camel}Reasoning`];
    scores[dim.tag] = typeof scoreVal === "number" ? scoreVal : 0;
    reasonings[dim.tag] = typeof reasoningVal === "string" ? reasoningVal : "";
  }

  logger.info({ scores }, "Judge: LLM failure evaluation complete");

  // 5. Submit validation responses on-chain (judge wallet, one per dimension)
  const validationResponseTxHashes: Record<string, Hex> = {};
  for (const dim of dimensions) {
    const responseDoc = {
      requestHash,
      dimension: dim.tag,
      score: scores[dim.tag],
      reasoning: reasonings[dim.tag],
      outcome: "failed",
      model: budgetCritical ? "qwen3-4b" : "gemini-3-flash-preview",
      evaluatedAt: new Date().toISOString(),
    };
    const { hash: responseHash, url: responseURI } = storeEvidence(
      input.intentId,
      responseDoc,
    );

    const txHash = await submitValidationResponse(
      requestHash,
      scores[dim.tag]!,
      responseURI,
      responseHash,
      dim.tag,
    );
    validationResponseTxHashes[dim.tag] = txHash;

    logger.info(
      { dimension: dim.tag, score: scores[dim.tag], txHash },
      "Judge: failure validation response submitted",
    );
  }

  // 6. Compute composite score and submit reputation feedback (judge wallet)
  const composite = computeCompositeScore(dimensions, scores);
  const compositeScaled = composite / 10;

  const feedbackDoc = {
    agentId: Number(input.agentId),
    intentId: input.intentId,
    cycle: input.cycle,
    composite: compositeScaled,
    outcome: "failed",
    weights: Object.fromEntries(dimensions.map((d) => [d.tag, d.weight])),
    dimensions: scores,
    errorMessage: input.errorMessage,
    timestamp: new Date().toISOString(),
  };
  const { hash: feedbackHash, url: feedbackURI } = storeEvidence(
    input.intentId,
    feedbackDoc,
  );

  const feedbackTxHash = await giveFeedback(
    input.agentId,
    compositeScaled,
    "swap-quality",
    intentType,
    "base-sepolia",
    feedbackURI,
    feedbackHash,
  );

  logger.info(
    { composite: compositeScaled, feedbackTxHash },
    "Judge: failure reputation feedback submitted",
  );

  return {
    scores,
    reasonings,
    composite: compositeScaled,
    requestHash,
    validationRequestTxHash,
    validationResponseTxHashes,
    feedbackTxHash,
  };
}
