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
  storeEvidence,
  type SwapEvidence,
  type SwapEvidenceInput,
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

export function buildJudgePrompt(
  dimensions: EvaluationDimension[],
  evidence: SwapEvidence,
): { systemPrompt: string; userPrompt: string } {
  const dimensionBlocks = dimensions
    .map((d) => `${d.name.toUpperCase()}:\n${d.criteria}`)
    .join("\n\n---\n\n");

  const systemPrompt = `${JUDGE_SYSTEM_PROMPT}\n\n${dimensionBlocks}`;
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
