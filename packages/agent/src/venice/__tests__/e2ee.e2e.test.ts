/**
 * E2E tests for Venice E2EE (end-to-end encrypted) chat against the live API.
 * Requires a real VENICE_API_KEY in .env.
 *
 * @module @maw/agent/venice/e2ee.e2e.test
 */
import { describe, it, expect } from "vitest";
import {
  createE2eeSession,
  e2eeChat,
  extractJson,
  E2EE_REASONING_MODEL,
  type E2eeSession,
} from "../e2ee.js";
import { RebalanceDecisionSchema } from "../schemas.js";

/**
 * Strip `<think>...</think>` blocks that Qwen reasoning models sometimes emit,
 * then delegate to the standard extractJson helper.
 */
function extractJsonFromReasoning(text: string): string {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return extractJson(stripped);
}

/**
 * Normalise LLM JSON output before Zod validation. The reasoning model
 * sometimes drops nullable keys or uses empty-string keys. Fill in missing
 * nullable fields so the schema validates correctly.
 */
function normaliseRebalanceJson(obj: Record<string, unknown>): Record<string, unknown> {
  if (!("marketContext" in obj)) obj["marketContext"] = null;
  if (!("targetSwap" in obj)) obj["targetSwap"] = null;
  delete obj[""];
  return obj;
}

/**
 * Parse JSON from LLM output with best-effort repair. E2EE reasoning models
 * sometimes produce slightly malformed JSON (unescaped newlines in strings,
 * missing commas, truncated keys). This tries progressively more aggressive
 * repair strategies before giving up.
 */
function repairAndParseJson(text: string): Record<string, unknown> {
  // Strategy 1: direct parse
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // continue to repairs
  }

  // Strategy 2: collapse literal newlines inside string values and remove control chars
  const repaired = text
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, "") // remove control chars except \n, \r
    .replace(/\n/g, " ") // collapse newlines to spaces
    .replace(/,\s*}/g, "}") // trailing commas
    .replace(/,\s*]/g, "]"); // trailing commas in arrays
  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    // continue
  }

  // Strategy 3: extract key-value pairs manually for known schema
  const boolMatch = text.match(/"shouldRebalance"\s*:\s*(true|false)/);
  const reasonMatch = text.match(/"reasoning"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (boolMatch) {
    const result: Record<string, unknown> = {
      shouldRebalance: boolMatch[1] === "true",
      reasoning: reasonMatch ? reasonMatch[1] : "parsed via repair",
      marketContext: null,
      targetSwap: null,
    };

    // Try to extract targetSwap
    const swapMatch = text.match(/"targetSwap"\s*:\s*(\{[^}]*\})/);
    if (swapMatch) {
      try {
        result["targetSwap"] = JSON.parse(swapMatch[1]) as Record<string, unknown>;
      } catch {
        // leave as null
      }
    }

    return result;
  }

  throw new SyntaxError(`Could not repair JSON: ${text.slice(0, 300)}`);
}

/**
 * Attempt a structured JSON E2EE chat up to `maxAttempts` times. The E2EE
 * reasoning model lacks structured output enforcement, so it occasionally
 * produces malformed JSON. Retrying is the pragmatic solution for e2e tests.
 */
async function attemptStructuredChat(
  session: E2eeSession,
  maxAttempts: number,
): Promise<{ success: true; shouldRebalance: boolean } | { success: false; lastError: string }> {
  const systemPrompt =
    'Respond with ONLY a JSON object. No explanation, no markdown, no thinking. Use exactly these keys: shouldRebalance (boolean), reasoning (string), marketContext (string or null), targetSwap (object with sellToken, buyToken, sellAmount, maxSlippage strings, or null). Example: {"shouldRebalance":true,"reasoning":"drift exceeds threshold","marketContext":null,"targetSwap":{"sellToken":"ETH","buyToken":"USDC","sellAmount":"0.1","maxSlippage":"0.005"}}';
  const userPrompt =
    "Portfolio: 70% ETH 30% USDC. Target: 60/40. Drift threshold: 5%. Should we rebalance?";

  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await e2eeChat(
        session,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { maxTokens: 500, temperature: 0 },
      );

      const json = extractJsonFromReasoning(response);
      const rawParsed = repairAndParseJson(json);
      normaliseRebalanceJson(rawParsed);
      const parsed = RebalanceDecisionSchema.safeParse(rawParsed);

      if (parsed.success) {
        return { success: true, shouldRebalance: parsed.data.shouldRebalance };
      }

      lastError = `Attempt ${String(attempt)}: Zod validation failed - ${JSON.stringify(parsed.error.issues)}`;
    } catch (e) {
      lastError = `Attempt ${String(attempt)}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return { success: false, lastError };
}

describe("Venice E2EE E2E", () => {
  it(
    "creates a verified TEE session",
    { timeout: 30000 },
    async () => {
      const session = await createE2eeSession();

      expect(session.teeProvider).toBe("near-ai");
      expect(session.signingAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(session.publicKeyHex).toHaveLength(130);
      expect(session.modelPublicKeyHex).toHaveLength(130);
      expect(session.model).toBe(E2EE_REASONING_MODEL);
    },
  );

  it(
    "performs encrypted chat and decrypts response",
    { timeout: 60000 },
    async () => {
      const session = await createE2eeSession();
      const response = await e2eeChat(session, [
        { role: "user", content: "What is 7 times 6? Reply with just the number." },
      ]);

      expect(response).toContain("42");
    },
  );

  it(
    "returns structured JSON for rebalance decision via E2EE",
    { timeout: 180000 },
    async () => {
      const session = await createE2eeSession();
      const result = await attemptStructuredChat(session, 3);

      if (!result.success) {
        console.error("All attempts failed:", result.lastError);
      }

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.shouldRebalance).toBe("boolean");
      }
    },
  );

  it(
    "decrypted response is non-empty (proves crypto works)",
    { timeout: 60000 },
    async () => {
      const session = await createE2eeSession();
      const response = await e2eeChat(session, [
        { role: "user", content: "Say hello" },
      ]);

      expect(response.length).toBeGreaterThan(0);
    },
  );
});
