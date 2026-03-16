# Agent Codebase Cleanup Plan

**Date:** 2026-03-15
**Scope:** `packages/agent/src/`, `packages/common/src/` (shared types only)
**Estimated changes:** ~18 files modified, 2 files deleted, 2 files created
**Risk level:** Low-Medium — no new features, one bug fix (server race condition), validation hardening

---

## Phase 1: Dead Code & Structural Cleanup

### Step 1: Delete `types.ts` and relocate `PortfolioState`

**Why:** 4 of 5 interfaces are dead code (never imported). `PortfolioState` is the only one used, and it belongs in `data/portfolio.ts` where it's consumed.

**Actions:**
1. Move `PortfolioState` interface into `data/portfolio.ts` (it's the only consumer)
2. Delete `types.ts`
3. Remove `ChainEnv` re-export if duplicated (already in `config.ts`)
4. Run `pnpm run build` to confirm no broken imports

**Files changed:** `data/portfolio.ts`, `types.ts` (deleted)

---

### Step 2: Delete unused exports

**Why:** Several exported functions are never called in production. Reducing public API surface improves clarity.

**Actions:**
1. Delete `executeFullSwap()` from `uniswap/trading.ts` (lines 167-239) — never called in production; agent-loop orchestrates swaps manually
2. Delete its associated tests in `uniswap/trading.test.ts`
3. Remove `export` from `graphClient` in `data/thegraph.ts` — only used internally via `getSdk(graphClient)`
4. Delete `getRecommendedModel()` from `logging/budget.ts` — returns a model name string that is logged but never used to select an LLM instance; the actual model switching happens via `budgetTier` check at `agent-loop.ts:417`
5. Remove `recommendedModel` variable and its log message from `agent-loop.ts:317-322`; replace with a log that states which LLM instance will be used (fastLlm vs reasoningLlm)
6. Keep `ensurePermit2Approval()` (actively tested utility), `getReputationSummary()`, `getBudgetState()` (potentially useful for dashboard)

**Files changed:** `uniswap/trading.ts`, `uniswap/trading.test.ts`, `data/thegraph.ts`, `logging/budget.ts`, `logging/budget.test.ts`, `agent-loop.ts`

---

### Step 3: Remove duplicate `AgentLogEntry` definition

**Why:** After Step 1 deletes `types.ts`, verify the canonical definition in `@veil/common` is used everywhere.

**Actions:**
1. Grep for any remaining `AgentLogEntry` imports — should only come from `@veil/common`
2. Verify `server.ts` imports from the correct location (it already does)
3. No code change expected — verification only

**Files changed:** None (verification only)

---

## Phase 2: Logger & Core Fixes

### Step 4: Create a pino logger and replace console.log

**Why:** CLAUDE.md mandates pino. ~89 raw console calls across 5 files. Structured JSON logging is critical for an agent that already writes `agent_log.jsonl`.

**Actions:**
1. `pnpm add pino` in `packages/agent`
2. Create `src/logging/logger.ts` with a configured pino instance (JSON output, level from env)
3. Replace all `console.log` -> `logger.info`, `console.error` -> `logger.error` in:
   - `agent-loop.ts` (52 calls)
   - `server.ts` (19 calls)
   - `index.ts` (13 calls)
   - `delegation/redeemer.ts` (3 calls)
4. Keep `config.ts` console.error (runs before logger is available, exits process)
5. Update test mocks that spy on `console.log` to spy on the logger instead
6. Run `pnpm test` to confirm all tests pass

**Files changed:** `logging/logger.ts` (new), `agent-loop.ts`, `server.ts`, `index.ts`, `delegation/redeemer.ts`, affected test files

---

### Step 5: Fix `budget.ts` NaN validation + tests

**Why:** `parseFloat(undefined)` silently returns NaN, making budget tier always "normal" when the header is missing. `totalCallCount` increments even when no header is present. Tests don't test any actual behavior.

**Actions:**
1. In `updateBudget()`: guard against missing/NaN headers — if header is absent or `isNaN(parsed)`, return early without updating balance or incrementing count
2. Export a `resetBudgetState()` test helper (like `resetLogSequence()` in agent-log.ts)
3. Write real functional tests:
   - `updateBudget` with valid header sets balance
   - `updateBudget` with missing header doesn't change balance
   - `updateBudget` with NaN header doesn't change balance
   - `getBudgetTier` returns "critical" when balance < 0.5
   - `getBudgetTier` returns "conservation" when balance < 2
   - `getBudgetTier` returns "normal" when balance >= 2
   - `totalCallCount` increments only on valid headers

**Files changed:** `logging/budget.ts`, `logging/budget.test.ts`

---

### Step 6: Fix `portfolio.ts` base-sepolia chain config

**Why:** Line 33 uses `sepolia` chain object instead of `baseSepolia` for the base-sepolia config. Latent bug — wrong RPC endpoint would be used.

**Actions:**
1. Change `chain: sepolia` to `chain: baseSepolia` in the `"base-sepolia"` entry
2. Add a unit test that validates each chainConfig entry uses the correct chain ID

**Files changed:** `data/portfolio.ts`, `data/portfolio.test.ts`

---

### Step 7: Fix server deploy race condition

**Why:** `handleDeploy` starts `runAgentLoop()` in background, waits 3 seconds with `setTimeout`, then returns whatever `getAgentState()` has. If the loop crashes before delegation is created (e.g., Venice timeout, MetaMask SDK failure), the response returns 200 with `audit: null` — indistinguishable from "still initializing." The 3-second wait is also likely insufficient (delegation creation involves LLM call + smart account creation = 4-8 seconds).

**Actions:**
1. Add a `deployError: string | null` field to `AgentState` interface in `agent-loop.ts`
2. In `runAgentLoop`, when delegation creation fails (catch block at lines 216-221), set `state.deployError = msg` before returning
3. In `handleDeploy`, replace the blind 3-second `setTimeout` with a polling loop:
   - Poll `getAgentState()` every 200ms, max 10 seconds
   - Exit early if `state.audit` is populated (success) or `state.deployError` is set (failure)
   - If `state.deployError` is set, return HTTP 500 with the error message
   - If timeout (10s) is reached, return 200 with `audit: null` and a `warning: "Delegation still initializing"` field
4. Add `deployError` to `AgentStateResponse` in `@veil/common/schemas.ts` (so the dashboard can display it)
5. Update `server.test.ts` tests for the new polling behavior

**Files changed:** `agent-loop.ts`, `server.ts`, `server.test.ts`, `packages/common/src/schemas.ts`

---

## Phase 3: Refactoring

### Step 8: Break up `runCycle` in `agent-loop.ts`

**Why:** `runCycle` is ~460 lines doing 10+ distinct things. Hard to read, test, or modify.

**Actions:**
Extract these functions (keep them in `agent-loop.ts` as private helpers, not new files):

1. `gatherMarketData(config, agentAddress, chainEnv)` — ETH price fetch, portfolio balance, pool data, drift calculation. Returns a structured object.
2. `getRebalanceDecision(config, state, marketData)` — Venice reasoning invocation. Returns the decision.
3. `executeSwap(config, state, swap, agentAddress, chain)` — Approval check, quoting, permit signing, delegation/direct execution, confirmation. Returns the swap record.

The remaining `runCycle` becomes a ~30-line orchestrator calling these three.

**Files changed:** `agent-loop.ts`, `agent-loop.test.ts` (add tests for new helpers)

---

### Step 9: Consolidate permit2 signing logic

**Why:** `agent-loop.ts` lines 601-637 duplicate the EIP-712 signing in `permit2.ts:signPermit2Data()`. The agent-loop version has a smarter `derivePrimaryType` algorithm (handles both `PermitWitnessTransferFrom` and `PermitSingle` flows), while `permit2.ts` hardcodes `"PermitWitnessTransferFrom"`.

**Actions:**
1. Extract the `derivePrimaryType(types)` logic from agent-loop.ts into a named, exported helper in `permit2.ts`
2. Update `signPermit2Data()` in `permit2.ts` to use `derivePrimaryType` instead of the hardcoded primaryType
3. Replace the inline permit signing in `agent-loop.ts` (lines 601-637) with a call to `signPermit2Data(walletClient, quote.permitData)`
4. Add unit tests for `derivePrimaryType` covering both `PermitWitnessTransferFrom` and `PermitSingle` type objects
5. After Step 11 adds Zod validation for permitData, the `as` casts in `signPermit2Data` become unnecessary — remove them

**Files changed:** `uniswap/permit2.ts`, `uniswap/permit2.test.ts`, `agent-loop.ts`

---

## Phase 4: Validation Hardening

### Step 10: Add Zod schemas for Uniswap API responses

**Why:** `uniswapFetch<T>` casts `res.json() as Promise<T>` without runtime validation. If Uniswap returns an unexpected shape (missing field, wrong type), the agent silently uses garbage values.

**Where:** `packages/agent/src/uniswap/schemas.ts` (new file) — these are agent-internal, not shared. The dashboard never touches Uniswap API responses directly.

**Actions:**
1. Create `packages/agent/src/uniswap/schemas.ts` with:
   - `ApprovalResponseSchema` — validates `/check_approval` response
   - `QuoteResponseSchema` — validates `/quote` response including optional `permitData`
   - `SwapResponseSchema` — validates `/swap` response
   - `PermitDataSchema` — validates the EIP-712 typed data structure within `permitData`
2. Derive types from schemas: `type QuoteResponse = z.infer<typeof QuoteResponseSchema>` etc.
3. Delete the TypeScript interfaces (`ApprovalResponse`, `QuoteResponse`, `SwapResponse`) from `trading.ts` — replaced by Zod-derived types
4. Keep the request interfaces (`ApprovalRequest`, `QuoteRequest`, `SwapRequest`, `ExecuteSwapParams`) as TypeScript interfaces in `trading.ts` — these are shapes we construct, not external data
5. Update `uniswapFetch<T>` to accept a Zod schema parameter and validate with `safeParse()`:
   ```typescript
   async function uniswapFetch<T>(
     endpoint: string,
     body: Record<string, unknown>,
     schema: z.ZodType<T>,
   ): Promise<T> {
     // ... fetch logic ...
     const json = await res.json();
     const parsed = schema.safeParse(json);
     if (!parsed.success) {
       throw new Error(`Uniswap API ${endpoint} response validation failed: ${parsed.error.message}`);
     }
     return parsed.data;
   }
   ```
6. Update callers (`checkApproval`, `getQuote`, `createSwap`) to pass the appropriate schema
7. Add unit tests for the schemas (valid + invalid payloads)

**Files changed:** `uniswap/schemas.ts` (new), `uniswap/trading.ts`, `uniswap/trading.test.ts`

---

### Step 11: Add `DeployRequestSchema` to `@veil/common`

**Why:** `server.ts:92` does `body.intent as string` without validation. The dashboard (`apps/dashboard/lib/api.ts`) constructs `{ intent: string }` for this endpoint — it's a shared API contract.

**Actions:**
1. Add to `packages/common/src/schemas.ts`:
   ```typescript
   export const DeployRequestSchema = z.object({
     intent: z.string().min(1, "Intent cannot be empty"),
   });
   export type DeployRequest = z.infer<typeof DeployRequestSchema>;
   ```
2. In `server.ts` `handleDeploy`, replace:
   ```typescript
   const intentText = body.intent as string;
   if (!intentText) { ... }
   ```
   with:
   ```typescript
   const parsed = DeployRequestSchema.safeParse(body);
   if (!parsed.success) {
     sendJson(res, { error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
     return;
   }
   const intentText = parsed.data.intent;
   ```
3. Update `server.test.ts` tests to verify Zod validation error responses
4. Optionally update `apps/dashboard/lib/api.ts` to import and use `DeployRequest` type for the request body

**Files changed:** `packages/common/src/schemas.ts`, `packages/common/src/schemas.test.ts`, `server.ts`, `server.test.ts`

---

### Step 12: Add Zod validation for agent log parsing

**Why:** `server.ts:45` does `JSON.parse(line) as AgentLogEntry` without validation. Corrupted or malformed log lines would cause undefined behavior.

**Actions:**
1. In `readLogFeed()` in `server.ts`, replace:
   ```typescript
   .map((line) => JSON.parse(line) as AgentLogEntry)
   ```
   with:
   ```typescript
   .flatMap((line) => {
     const parsed = AgentLogEntrySchema.safeParse(JSON.parse(line));
     return parsed.success ? [parsed.data] : [];
   })
   ```
2. Import `AgentLogEntrySchema` from `@veil/common` (already available)
3. Add a test for malformed log lines being skipped gracefully

**Files changed:** `server.ts`, `server.test.ts`

---

### Step 13: Add allocation sum validation to `IntentParseSchema`

**Why:** LLM can return allocations that don't sum to 1.0 — currently accepted silently.

**Actions:**
1. Add `.refine()` to `IntentParseSchema` in `venice/schemas.ts` that checks `Object.values(targetAllocation).reduce((a, b) => a + b, 0)` is between 0.95 and 1.05 (allow small floating-point tolerance)
2. Add the same refinement to `IntentParseLlmSchema` (on the transformed record)
3. Add test cases for rejection of allocations summing to 0.8 and 1.2
4. Add test case for acceptance of allocations summing to 0.99 (floating point edge)

**Files changed:** `venice/schemas.ts`, `venice/schemas.test.ts`

---

## Phase 5: Polish

### Step 14: Extract magic numbers to named constants

**Why:** Hardcoded numbers scattered across modules hurt readability and make thresholds hard to find/adjust.

**Actions:**
1. `logging/budget.ts`: `BUDGET_CRITICAL_USD = 0.5`, `BUDGET_CONSERVATION_USD = 2`
2. `venice/llm.ts`: `LLM_TIMEOUT_FAST_MS = 60_000`, `LLM_TIMEOUT_RESEARCH_MS = 120_000`, `LLM_TIMEOUT_REASONING_MS = 300_000`
3. `delegation/compiler.ts`: `SAFETY_MAX_DAILY_BUDGET_USD = 1000`, `SAFETY_MAX_TIME_WINDOW_DAYS = 30`, `SAFETY_MAX_SLIPPAGE = 0.02`, `CONSERVATIVE_ETH_PRICE_USD = 500`
4. `uniswap/trading.ts`: `DEFAULT_SLIPPAGE_TOLERANCE = 0.5`
5. `packages/common/src/constants.ts`: `SECONDS_PER_DAY = 86400` — used by both `delegation/compiler.ts` and `delegation/audit.ts`

Constants stay co-located with usage in each module, except `SECONDS_PER_DAY` which goes in common since it's shared.

**Files changed:** `logging/budget.ts`, `venice/llm.ts`, `delegation/compiler.ts`, `delegation/audit.ts`, `uniswap/trading.ts`, `packages/common/src/constants.ts`

---

### Step 15: Reduce `as any` in `server.test.ts`

**Why:** 56 `as any` casts for mock HTTP objects. A typed mock interface would be cleaner.

**Actions:**
1. Create a `MockServerResponse` interface in the test file that extends the needed properties (statusCode, setHeader, writeHead, end, parsedBody)
2. Update `createMockRes()` to return `MockServerResponse`
3. Replace `res as any` with properly typed references
4. Lowest priority — cosmetic improvement to test type safety

**Files changed:** `server.test.ts`

---

## Phase 6: Resilience & Observability

### Step 16: Preserve stack traces in pino error logging

**Why:** Every catch block does `err instanceof Error ? err.message : String(err)`, discarding stack traces. Pino natively serializes full Error objects (message + stack + custom props) when passed as `{ err }`. Since we're already migrating to pino in Step 4, this is a matter of using the right calling convention.

**Actions:**
1. In every catch block across `agent-loop.ts`, `server.ts`, `delegation/redeemer.ts`: replace `logger.error({ error: msg }, "...")` with `logger.error({ err }, "...")`
2. Remove the `const msg = err instanceof Error ? err.message : String(err)` pattern — pass the raw error to pino
3. Where the error message is also used in a return value (e.g., `state.deployError = msg`), keep `msg` extraction for that purpose but still log the full error: `logger.error({ err }, "..."); state.deployError = err instanceof Error ? err.message : String(err);`
4. Update `logAction()` calls that pass `error: msg` to pass `error: err instanceof Error ? err.message : String(err)` (agent_log.jsonl is a string-based format, so keep message-only there)

**Files changed:** `agent-loop.ts`, `server.ts`, `delegation/redeemer.ts`

---

### Step 17: Add retry wrapper for Uniswap and Graph APIs

**Why:** Uniswap `fetch` and `graphql-request` have zero built-in retry. A single 429 or network timeout aborts the entire swap. LangChain and viem already have retry built in, so only the unprotected APIs need a wrapper.

**Actions:**
1. Create `packages/agent/src/utils/retry.ts` — a single generic retry utility:
   ```typescript
   export async function withRetry<T>(
     fn: () => Promise<T>,
     opts?: { maxRetries?: number; baseDelayMs?: number; label?: string },
   ): Promise<T>
   ```
   - Exponential backoff: `baseDelay * 2^attempt` (default: 3 retries, 500ms base = 500ms, 1s, 2s)
   - Only retry on retryable errors (network errors, 429, 500-503). Throw immediately on 400, 401, 403.
   - Log retries via pino logger
2. Wrap `uniswapFetch` in `trading.ts` with `withRetry`:
   ```typescript
   const json = await withRetry(
     () => fetch(...).then(res => { if (!res.ok) throw ...; return res.json(); }),
     { label: `uniswap:${endpoint}` },
   );
   ```
3. Wrap `getPoolData` in `thegraph.ts`:
   ```typescript
   const data = await withRetry(
     () => sdk.GetPools({ ... }),
     { label: "thegraph:GetPools", maxRetries: 2 },
   );
   ```
4. Do NOT wrap LangChain calls (already has `maxRetries`) or viem calls (already has `retryCount: 3` by default)
5. Add unit tests for `withRetry` (success, failure after retries, non-retryable error skips retry)

**Files changed:** `utils/retry.ts` (new), `uniswap/trading.ts`, `data/thegraph.ts`, `utils/retry.test.ts` (new)

---

### Step 18: Fix ERC-8004 registration — await with retry, no fallback ID

**Why:** `registerAgent()` is fire-and-forget with `.catch()`. If it fails, `state.agentId` stays `null`, and all `giveFeedback()` calls fall back to `feedbackAgentId = state.agentId ?? 1n` — attributing reputation feedback to the **wrong agent** (whoever owns ID 1 on the registry). This corrupts on-chain reputation data.

**Actions:**
1. In `agent-loop.ts` `runAgentLoop()`, replace the fire-and-forget `.then()/.catch()` pattern (lines 143-159) with `await` + retry:
   ```typescript
   try {
     const { txHash, agentId } = await withRetry(
       () => registerAgent("https://github.com/neilei/veil", "base-sepolia"),
       { label: "erc8004:register", maxRetries: 3 },
     );
     logger.info({ txHash, agentId }, "ERC-8004 agent registered");
     if (agentId) state.agentId = agentId;
     logAction("erc8004_register", { ... });
   } catch (err) {
     logger.error({ err }, "ERC-8004 registration failed after retries");
     logAction("erc8004_register_failed", { error: ... });
     // Continue without agentId — but don't submit feedback with wrong ID
   }
   ```
2. Same fix in `server.ts` `startup()` (lines 289-304) — await with retry instead of fire-and-forget
3. In `agent-loop.ts` line 742, change `giveFeedback` to **skip feedback entirely** if `state.agentId` is null:
   ```typescript
   if (state.agentId) {
     giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
       .then(...).catch(...);
   } else {
     logger.warn("Skipping ERC-8004 feedback — no agent ID registered");
   }
   ```
4. Add test verifying feedback is skipped when agentId is null

**Files changed:** `agent-loop.ts`, `server.ts`, `agent-loop.test.ts`, `server.test.ts`

---

## Execution Order & Dependencies

```
Phase 1 (independent, parallelizable):
  Step 1  ──> Step 3 (verify after Step 1)
  Step 2

Phase 2 (Step 4 first, then rest parallel):
  Step 4  ──> Step 5
              Step 6
              Step 7

Phase 3 (after Phase 2):
  Step 8  ──> Step 9 (uses extracted executeSwap from Step 8)

Phase 4 (after Phase 3):
  Step 10 ──> Step 9 cleanup (remove as casts from permit2.ts after Zod validates permitData)
  Step 11
  Step 12
  Step 13

Phase 5 (independent, lowest priority):
  Step 14
  Step 15

Phase 6 (after Step 4 for logger, after Step 10 for retry wrapper):
  Step 16 (after Step 4)
  Step 17 (independent)
  Step 18 (after Step 17 for withRetry)
```

---

## Out of Scope (explicitly not doing)

- **Circuit breaker patterns:** Over-engineering for hackathon timeline.
- **Custom error types:** (`SwapFailedError`, `VeniceTimeoutError`, etc.) — would be nice but not worth the churn.
- **The Graph response validation:** Generated SDK provides types; runtime validation is over-engineering.
- **Price fetch stale-price fallback:** Cycle just retries next interval.
- **Adding pino to devDependencies / test infrastructure:** Tests mock the logger.
- **Retry for LangChain/viem:** Already have built-in retry with backoff.
- **Multi-endpoint RPC fallback:** Overkill for demo with a single testnet.

---

## Validation Checklist (run after all steps)

- [ ] `pnpm run build` — no TypeScript errors
- [ ] `pnpm run lint` — no lint errors
- [ ] `pnpm test` — all unit tests pass
- [ ] `pnpm run test:e2e` — all e2e tests pass
- [ ] `grep -r "from.*types.js" packages/agent/src/` — no imports from deleted file
- [ ] `grep -c "console\." packages/agent/src/*.ts packages/agent/src/**/*.ts` — only config.ts remains
- [ ] `grep -c "as any" packages/agent/src/` — count reduced (target: 0 in production, <20 in tests)
- [ ] `grep -c "as Promise" packages/agent/src/` — 0 (replaced by Zod validation)
- [ ] `grep -c "as string" packages/agent/src/server.ts` — 0 (replaced by Zod validation)
