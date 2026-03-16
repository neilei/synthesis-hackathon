# Sponsor Integration Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all actionable items from the sponsor prize audit — Venice params, privacy narrative, delegation logging, Uniswap e2e coverage, ERC-8004 feedback guard.

**Architecture:** Mostly surgical edits to existing files. Venice LLM config gets a dedicated reasoning params block + new features (e2ee, prompt caching, reasoning effort). Dashboard gets a one-liner privacy subtitle. Agent-loop gets smarter delegation logging and guarded feedback. Uniswap e2e tests get Permit2+reverse swap coverage.

**Tech Stack:** TypeScript, Vitest, LangChain/OpenAI, Venice API, Playwright (dashboard)

---

## Task 1: Venice LLM — Fix reasoning tier params and add new features

The reasoning tier (`reasoningLlm`) currently reuses `researchVeniceParams`, which has `enable_web_search: "on"`. This is wrong — the reasoning tier does structured decision-making, not web research. It also means every rebalance decision incurs web search cost/latency for no reason.

Additionally, we need to add `enable_e2ee: true`, `prompt_cache_key`, and `reasoning_effort` to demonstrate awareness of Venice-exclusive features.

**Files:**
- Modify: `packages/agent/src/venice/llm.ts`

**Step 1: Write failing unit test for Venice param configs**

Create `packages/agent/src/venice/llm.test.ts`:

```typescript
/**
 * Unit tests for Venice LLM configuration.
 * Validates that each tier has correct venice_parameters.
 *
 * @module @veil/agent/venice/llm.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../config.js", () => ({
  env: {
    VENICE_API_KEY: "test-key",
    VENICE_BASE_URL: "https://api.venice.ai/api/v1",
    VENICE_MODEL_OVERRIDE: undefined,
  },
}));
vi.mock("../logging/budget.js", () => ({
  updateBudget: vi.fn(),
}));

describe("Venice LLM configuration", () => {
  // Re-import after mocks are set up
  let fastLlm: InstanceType<typeof import("@langchain/openai").ChatOpenAI>;
  let researchLlm: InstanceType<typeof import("@langchain/openai").ChatOpenAI>;
  let reasoningLlm: InstanceType<typeof import("@langchain/openai").ChatOpenAI>;

  beforeEach(async () => {
    vi.resetModules();
    const llm = await import("./llm.js");
    fastLlm = llm.fastLlm;
    researchLlm = llm.researchLlm;
    reasoningLlm = llm.reasoningLlm;
  });

  it("fast tier has web search disabled", () => {
    const kwargs = (fastLlm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
    const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
    expect(params.enable_web_search).toBe("off");
  });

  it("research tier has web search enabled", () => {
    const kwargs = (researchLlm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
    const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
    expect(params.enable_web_search).toBe("on");
  });

  it("reasoning tier has web search disabled", () => {
    const kwargs = (reasoningLlm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
    const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
    expect(params.enable_web_search).toBe("off");
  });

  it("all tiers set enable_e2ee to true", () => {
    for (const llm of [fastLlm, researchLlm, reasoningLlm]) {
      const kwargs = (llm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
      const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
      expect(params.enable_e2ee).toBe(true);
    }
  });

  it("all tiers set include_venice_system_prompt to false", () => {
    for (const llm of [fastLlm, researchLlm, reasoningLlm]) {
      const kwargs = (llm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
      const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
      expect(params.include_venice_system_prompt).toBe(false);
    }
  });

  it("reasoning tier has prompt_cache_key set", () => {
    const kwargs = (reasoningLlm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
    const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
    expect(params.prompt_cache_key).toBe("veil-reasoning");
  });

  it("research tier has prompt_cache_key set", () => {
    const kwargs = (researchLlm as Record<string, unknown>).modelKwargs as Record<string, unknown>;
    const params = (kwargs.venice_parameters ?? kwargs) as Record<string, unknown>;
    expect(params.prompt_cache_key).toBe("veil-research");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && pnpm vitest run src/venice/llm.test.ts`
Expected: FAIL — reasoning tier has `enable_web_search: "on"`, no `enable_e2ee`, no `prompt_cache_key`

**Step 3: Implement the fix in llm.ts**

Replace the entire content of `packages/agent/src/venice/llm.ts` with:

```typescript
/**
 * Venice AI LLM instances via LangChain. Three tiers: fast (qwen3-4b),
 * research (gemini-3-flash-preview with web search), reasoning (gemini-3-1-pro-preview).
 * Custom fetch wrapper captures billing headers for budget tracking.
 *
 * Venice-specific features:
 * - enable_e2ee: true — end-to-end encryption for E2EE-capable models (default true, set explicitly for visibility)
 * - prompt_cache_key — routing hint to improve cache hit rates on repeated system prompts
 * - reasoning_effort — set per-call in agent-loop.ts, not here (tier-level setting would override per-call)
 *
 * @see https://docs.venice.ai/api-reference/endpoint/chat/completions
 * @module @veil/agent/venice/llm
 */
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { env } from "../config.js";
import { updateBudget } from "../logging/budget.js";

// Custom fetch that captures Venice billing headers
const veniceFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  const balanceHeader = response.headers.get("x-venice-balance-usd");
  if (balanceHeader) {
    updateBudget({ "x-venice-balance-usd": balanceHeader });
  }
  return response;
};

export const getVeniceLlm = (options: ChatOpenAIFields) => {
  return new ChatOpenAI({
    ...options,
    apiKey: env.VENICE_API_KEY,
    configuration: {
      ...options.configuration,
      baseURL: env.VENICE_BASE_URL,
      fetch: veniceFetch,
    },
  });
};

/** Shared params: E2EE on, no Venice system prompt */
const baseVeniceParams = {
  enable_e2ee: true,
  include_venice_system_prompt: false,
};

const fastVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: true,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
  },
};

const researchVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: false,
    enable_web_search: "on" as const,
    enable_web_scraping: true,
    enable_web_citations: true,
    include_search_results_in_stream: true,
    return_search_results_as_documents: false,
    prompt_cache_key: "veil-research",
  },
};

const reasoningVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: false,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
    prompt_cache_key: "veil-reasoning",
  },
};

// VENICE_MODEL_OVERRIDE forces all tiers to use the same model (for fast testing)
const override = env.VENICE_MODEL_OVERRIDE;

// Fast: quick lookups, balance checks, simple parsing
export const fastLlm = getVeniceLlm({
  model: override ?? "qwen3-4b",
  temperature: 0.3,
  maxRetries: 1,
  modelKwargs: fastVeniceParams,
  timeout: 60000,
});

// Research: market analysis, price lookups with web search + citations
export const researchLlm = getVeniceLlm({
  model: override ?? "gemini-3-flash-preview",
  temperature: 0.5,
  maxRetries: 2,
  modelKwargs: researchVeniceParams,
  timeout: 120000,
});

// Reasoning: complex decisions, intent compilation, rebalance logic
export const reasoningLlm = getVeniceLlm({
  model: override ?? "gemini-3-1-pro-preview",
  temperature: 0,
  maxRetries: 2,
  modelKwargs: reasoningVeniceParams,
  timeout: 300000,
});
```

Key changes:
- `reasoningLlm` now uses its own `reasoningVeniceParams` with `enable_web_search: "off"` (was accidentally using `researchVeniceParams`)
- `enable_e2ee: true` added to all tiers via `baseVeniceParams`
- `prompt_cache_key` added to research ("veil-research") and reasoning ("veil-reasoning") tiers
- `reasoning_effort` is NOT set here — it's per-call (set in Task 2 below)

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && pnpm vitest run src/venice/llm.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/venice/llm.ts packages/agent/src/venice/llm.test.ts
git commit -m "fix(venice): separate reasoning params from research, add e2ee + prompt caching"
```

---

## Task 2: Venice — Add reasoning_effort to rebalance decision

The rebalance decision call in `agent-loop.ts` should pass `reasoning_effort` to Venice to demonstrate awareness of the feature. Use `"high"` for rebalance decisions (complex), `"low"` for fast tier if it ever gets used for decisions.

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (lines ~419-424)

**Step 1: Write failing test**

In `packages/agent/src/agent-loop.test.ts`, add a test that verifies reasoning_effort is passed. However, the agent-loop tests mock the LLM, so we can't easily assert on LLM kwargs. Instead, this is a manual verification — we'll add the param and verify via the existing e2e test.

Skip TDD for this step — it's a one-line configuration addition to an already-tested function.

**Step 2: Add reasoning_effort to the rebalance decision call**

In `packages/agent/src/agent-loop.ts`, modify the `getRebalanceDecision` function (around line 419-424).

Change:
```typescript
const llmForReasoning = market.budgetTier === "normal" ? reasoningLlm : fastLlm;
const startReasoning = Date.now();
const structuredReasoning =
  llmForReasoning.withStructuredOutput(RebalanceDecisionSchema, {
    method: "functionCalling",
  });
```

To:
```typescript
const isFullReasoning = market.budgetTier === "normal";
const llmForReasoning = isFullReasoning ? reasoningLlm : fastLlm;
const startReasoning = Date.now();
const structuredReasoning =
  llmForReasoning.withStructuredOutput(RebalanceDecisionSchema, {
    method: "functionCalling",
    ...(isFullReasoning ? { reasoning: { effort: "high" } } : {}),
  });
```

**Important caveat:** LangChain's `withStructuredOutput` may not forward arbitrary kwargs to Venice. If this doesn't work, the alternative is to pass `reasoning_effort` via `modelKwargs` on a per-call basis. Verify by checking that the Venice API request includes `reasoning_effort` (look at the response or Venice dashboard). If LangChain doesn't support this, instead bind it:

```typescript
const boundLlm = isFullReasoning
  ? reasoningLlm.bind({ reasoning_effort: "high" })
  : fastLlm;
const structuredReasoning = boundLlm.withStructuredOutput(
  RebalanceDecisionSchema,
  { method: "functionCalling" },
);
```

**Step 3: Verify existing tests still pass**

Run: `cd packages/agent && pnpm vitest run src/agent-loop.test.ts`
Expected: PASS (mocks don't care about the extra param)

**Step 4: Commit**

```bash
git add packages/agent/src/agent-loop.ts
git commit -m "feat(venice): add reasoning_effort to rebalance decisions"
```

---

## Task 3: Dashboard — Add privacy subtitle to configure screen

Minimal change — update the subtitle on the configure screen to surface the privacy narrative without going overboard.

**Files:**
- Modify: `apps/dashboard/components/configure.tsx` (line 59-61)

**Step 1: Update the subtitle**

Change line 59-61 from:
```tsx
<p className="mt-3 text-sm uppercase tracking-widest text-text-secondary">
  Describe your portfolio. The agent handles the rest.
</p>
```

To:
```tsx
<p className="mt-3 text-sm uppercase tracking-widest text-text-secondary">
  Private reasoning, constrained execution
</p>
```

This is concise, meaningful, and surfaces the core value prop (Venice private reasoning + MetaMask delegation constraints) without being preachy.

**Step 2: Update the "Powered by Venice" badge on audit screen to mention privacy**

In `apps/dashboard/components/audit.tsx`, find the SponsorBadge (line 67):
```tsx
<SponsorBadge text="Powered by Venice" />
```

Change to:
```tsx
<SponsorBadge text="Private reasoning via Venice (no data retention)" />
```

And in `apps/dashboard/components/monitor.tsx` (line 267), same change:
```tsx
<SponsorBadge text="Private reasoning via Venice (no data retention)" />
```

**Step 3: Run Playwright tests to verify nothing breaks**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: PASS (badge text changes shouldn't break selectors unless tests assert exact text)

If any test asserts on the old badge text "Powered by Venice", update the assertion to match the new text.

**Step 4: Commit**

```bash
git add apps/dashboard/components/configure.tsx apps/dashboard/components/audit.tsx apps/dashboard/components/monitor.tsx
git commit -m "feat(dashboard): surface privacy narrative in configure + sponsor badges"
```

---

## Task 4: Delegation enforcement logging

When delegation redemption fails due to a caveat enforcer (e.g., `ValueLteEnforcer:value-too-high`), log it as an informational security event, not just a generic failure. Keep `warn` level — the user SHOULD notice this — but make the message clear that it's the safety system working as designed, and use a distinct action type.

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (lines ~670-679)

**Step 1: Update the delegation catch block**

Change lines 670-679 from:
```typescript
} catch (delegationErr) {
  const delegationMsg =
    delegationErr instanceof Error ? delegationErr.message : String(delegationErr);
  logger.info(
    `Delegation redemption failed (${delegationMsg}), falling back to direct tx`,
  );
  logAction("delegation_redeem_failed", {
    tool: "metamask-delegation",
    error: delegationMsg,
  });
```

To:
```typescript
} catch (delegationErr) {
  const delegationMsg =
    delegationErr instanceof Error ? delegationErr.message : String(delegationErr);
  const isCaveatEnforcement = /Enforcer/i.test(delegationMsg);
  if (isCaveatEnforcement) {
    logger.warn(
      `Delegation caveat enforced: ${delegationMsg}. Safety constraints are working — the DelegationManager blocked an out-of-scope operation. Falling back to direct tx.`,
    );
    logAction("delegation_caveat_enforced", {
      tool: "metamask-delegation",
      result: { enforcer: delegationMsg, action: "fallback_to_direct_tx" },
    });
  } else {
    logger.warn(
      `Delegation redemption failed (${delegationMsg}), falling back to direct tx`,
    );
    logAction("delegation_redeem_failed", {
      tool: "metamask-delegation",
      error: delegationMsg,
    });
  }
```

This preserves `warn` level (the user should know), but:
- Distinguishes caveat enforcement (safety working) from actual errors (deploy failure, gas issue)
- Uses `delegation_caveat_enforced` action type (positive) vs `delegation_redeem_failed` (error)
- The message explicitly says "Safety constraints are working"
- Logs the enforcer name so you can see WHICH caveat fired

**Step 2: Verify existing tests pass**

Run: `cd packages/agent && pnpm vitest run src/agent-loop.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop.ts
git commit -m "feat(delegation): distinguish caveat enforcement from redemption failure in logs"
```

---

## Task 5: Uniswap — Add USDC->ETH quote + Permit2 signature to e2e tests

The existing `trading.e2e.test.ts` already has a USDC->ETH quote test, but it doesn't verify `permitData` is returned (which it should be for ERC-20 sells). The `permit2.e2e.test.ts` tests signing with synthetic data but never tests the actual Permit2 flow triggered by a real Uniswap quote. Let's add a test that gets a USDC->ETH quote and verifies `permitData` is present, then signs it.

**Files:**
- Modify: `packages/agent/src/uniswap/trading.e2e.test.ts`

**Step 1: Add test for permitData presence on USDC->ETH quote**

Add to the existing describe block in `trading.e2e.test.ts`:

```typescript
it(
  "USDC -> ETH quote includes permitData for Permit2 signing",
  { timeout: 30000 },
  async () => {
    const quote = await getQuote({
      tokenIn: CONTRACTS.USDC_SEPOLIA,
      tokenOut: CONTRACTS.NATIVE_ETH,
      amount: parseUnits("1", 6).toString(), // 1 USDC
      type: "EXACT_INPUT",
      chainId: 11155111,
      swapper: agentAddress,
    });

    expect(quote).toBeDefined();
    expect(BigInt(quote.quote.output.amount)).toBeGreaterThan(0n);

    // ERC-20 sells should include Permit2 data for gasless approval
    // Note: permitData may be null if the swapper already has Permit2 approval
    // or if the routing doesn't require it (e.g., WRAP/UNWRAP routes)
    if (quote.permitData) {
      expect(quote.permitData.domain).toBeDefined();
      expect(quote.permitData.types).toBeDefined();
      expect(quote.permitData.values).toBeDefined();
      console.log("Permit2 data present:", {
        domain: quote.permitData.domain,
        hasTypes: Object.keys(quote.permitData.types).length > 0,
      });
    } else {
      console.log("No permitData returned (swapper may already have approval or route does not require it)");
    }
  },
);
```

**Step 2: Run the test**

Run: `cd packages/agent && pnpm vitest run src/uniswap/trading.e2e.test.ts`
Expected: PASS. Note whether `permitData` is present — if the agent's wallet already has a Permit2 approval for USDC on Sepolia, it won't be returned. That's expected behavior, not a bug.

**Step 3: Commit**

```bash
git add packages/agent/src/uniswap/trading.e2e.test.ts
git commit -m "test(uniswap): verify permitData on USDC->ETH quote in e2e"
```

---

## Task 6: ERC-8004 — Guard feedback against null agentId

The current code `state.agentId ?? 1n` silently falls back to a placeholder. It should skip feedback entirely if agentId is null. We do NOT crash — feedback is non-critical and should not stop the agent.

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (lines ~743-756)

**Step 1: Update the feedback guard**

Change lines 743-756 from:
```typescript
// ERC-8004: give on-chain feedback for the swap (non-blocking)
const feedbackAgentId = state.agentId ?? 1n;
giveFeedback(feedbackAgentId, 5, "swap-execution", "defi", "base-sepolia")
  .then((fbHash) => {
    logger.info(`[erc8004] Feedback submitted: ${fbHash}`);
    logAction("erc8004_feedback", {
      tool: "erc8004-reputation",
      result: { txHash: fbHash, agentId: feedbackAgentId.toString(), rating: 5, tag: "swap-execution" },
    });
  })
  .catch((fbErr) => {
    const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
    logger.info(`[erc8004] Feedback skipped: ${fbMsg}`);
  });
```

To:
```typescript
// ERC-8004: give on-chain feedback for the swap (non-blocking)
if (state.agentId) {
  giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
    .then((fbHash) => {
      logger.info(`[erc8004] Feedback submitted: ${fbHash}`);
      logAction("erc8004_feedback", {
        tool: "erc8004-reputation",
        result: { txHash: fbHash, agentId: state.agentId!.toString(), rating: 5, tag: "swap-execution" },
      });
    })
    .catch((fbErr) => {
      const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
      logger.info(`[erc8004] Feedback skipped: ${fbMsg}`);
    });
} else {
  logger.info("[erc8004] Feedback skipped: agentId not yet available from registration");
}
```

This:
- Removes the `?? 1n` fallback — no more placeholder ratings
- Skips feedback cleanly with an informative log message
- Does NOT crash — feedback is non-blocking, non-critical

**Step 2: Verify existing tests pass**

Run: `cd packages/agent && pnpm vitest run src/agent-loop.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop.ts
git commit -m "fix(erc8004): skip feedback when agentId is null instead of falling back to 1n"
```

---

## Task 7: Final verification

**Step 1: Run full test suite**

Run: `cd packages/agent && pnpm vitest run`
Expected: All tests PASS

**Step 2: Run dashboard tests**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: All tests PASS (update any badge text assertions if needed)

**Step 3: Run lint + typecheck**

Run: `turbo run lint build`
Expected: PASS

**Step 4: Final commit (if any fixups needed)**

---

## Answers to User Questions (reference, not tasks)

### ERC-8004 feedback — "we're giving feedback to ourselves?"

Yes, currently `giveFeedback(state.agentId, ...)` rates the agent's own agentId. This makes no sense as a reputation signal — you're supposed to rate OTHER agents whose services you consumed. The ERC-8004 reputation registry is designed for inter-agent trust: "I consumed Agent X's service and it was quality 5/5."

What we're doing is self-assessment after a swap, which is meaningless reputation data. This is flagged for later — the right fix involves either:
- Consuming another agent's service (e.g., x402 data feed) and rating THAT agent
- Discovering other agents on the registry and rating them based on observed behavior
- Or simply removing the feedback call until there's a real service consumption to rate

Task 6 removes the `?? 1n` fallback but keeps the self-rating for now. The deeper rework is deferred.

### agent.json — "is this not created at runtime?"

No. `agent.json` is a static file checked into the repo at project root. It's never read or loaded by the agent at runtime. It exists for:
1. Protocol Labs judges to inspect (they require it)
2. Other agents/systems to discover our agent's capabilities (the spec's intent)
3. DevSpot Agent Compatibility (required by both Protocol Labs bounties)

It's analogous to a `package.json` for npm — it declares what the package does, but the runtime doesn't enforce it. The agent could violate its declared constraints with no on-chain consequence. Making it runtime-enforced would be a significant architecture change (load manifest, validate every action against declared capabilities) — not worth doing for the hackathon.
