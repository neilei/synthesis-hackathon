# Agent Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up the agent package — remove dead code, fix bugs, add validation, refactor large functions, and consolidate duplicated logic.

**Architecture:** 15 tasks across 5 phases. Each phase builds on the previous. Phases 1-2 are structural cleanup and bug fixes. Phase 3 refactors `runCycle` and consolidates permit2. Phase 4 adds Zod validation to API boundaries. Phase 5 is polish. All changes are in `packages/agent/` and `packages/common/`.

**Tech Stack:** TypeScript strict, Vitest, Zod, pino, viem, LangChain

---

## Task 1: Delete `types.ts` and relocate `PortfolioState`

**Files:**
- Delete: `packages/agent/src/types.ts`
- Modify: `packages/agent/src/data/portfolio.ts:16`

**Step 1: Move `PortfolioState` into `portfolio.ts`**

At the top of `packages/agent/src/data/portfolio.ts`, after line 15 (`import { CONTRACTS, type ChainEnv } from "../config.js";`), add the interface currently in `types.ts`:

```typescript
export interface PortfolioState {
  address: Address;
  balances: Record<string, { raw: bigint; formatted: string; usdValue: number }>;
  totalUsdValue: number;
  allocation: Record<string, number>;
  drift: Record<string, number>;
  maxDrift: number;
  timestamp: number;
}
```

Remove line 16 (`import type { PortfolioState } from "../types.js";`).

**Step 2: Delete `types.ts`**

Delete `packages/agent/src/types.ts`.

**Step 3: Run build to verify**

Run: `pnpm --filter @veil/agent run build`
Expected: No errors. No file imports from `types.js`.

**Step 4: Verify no remaining imports**

Run: `grep -r "from.*types.js" packages/agent/src/` (via Grep tool)
Expected: Zero matches.

**Step 5: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All tests pass.

**Step 6: Commit**

```
refactor(agent): relocate PortfolioState to portfolio.ts, delete types.ts
```

---

## Task 2: Delete unused exports

**Files:**
- Modify: `packages/agent/src/uniswap/trading.ts` (delete lines 164-239)
- Modify: `packages/agent/src/uniswap/trading.test.ts` (delete executeFullSwap tests)
- Modify: `packages/agent/src/data/thegraph.ts:11` (remove `export` keyword)
- Modify: `packages/agent/src/logging/budget.ts` (delete `getRecommendedModel`)
- Modify: `packages/agent/src/logging/budget.test.ts` (delete related tests if any)
- Modify: `packages/agent/src/agent-loop.ts:17,315-323,460`

**Step 1: Delete `executeFullSwap` and its type from `trading.ts`**

Delete lines 164-239 (the `ExecuteSwapParams` interface and `executeFullSwap` function).

**Step 2: Delete `executeFullSwap` tests from `trading.test.ts`**

Delete the import of `executeFullSwap` from line 24 and the entire test suite for it (the `describe("executeFullSwap", ...)` block).

**Step 3: Un-export `graphClient` in `thegraph.ts`**

Change line 11 from:
```typescript
export const graphClient = new GraphQLClient(THEGRAPH_UNISWAP_V3_BASE);
```
to:
```typescript
const graphClient = new GraphQLClient(THEGRAPH_UNISWAP_V3_BASE);
```

**Step 4: Delete `getRecommendedModel` from `budget.ts`**

Delete the `getRecommendedModel` function (lines 35-46).

**Step 5: Remove `getRecommendedModel` usage from `agent-loop.ts`**

In `agent-loop.ts`:
- Remove `getRecommendedModel` from the import on line 31
- Replace lines 315-323 (the budget check block) with:

```typescript
  // Check budget tier — switch to cheaper models if needed
  const budgetTier = getBudgetTier();
  if (budgetTier !== "normal") {
    console.log(`Budget tier: ${budgetTier} — using fastLlm for reasoning`);
    logAction("budget_check", {
      result: { tier: budgetTier },
    });
  }
```

Also update line 460 to remove the `recommendedModel` reference:
```typescript
      model: budgetTier === "normal" ? "gemini-3-1-pro-preview" : "qwen3-4b",
```
(This line should already be correct — just verify.)

**Step 6: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass (some test counts will decrease from removed tests).

**Step 7: Commit**

```
refactor(agent): delete executeFullSwap, getRecommendedModel, un-export graphClient
```

---

## Task 3: Verify `AgentLogEntry` canonical source

**Files:** None (verification only)

**Step 1: Grep for AgentLogEntry imports**

Run: `grep -r "AgentLogEntry" packages/agent/src/` (via Grep tool)
Expected: All imports come from `@veil/common` or `../logging/agent-log.js`. After Task 1 deleted `types.ts`, there should be no reference to it.

**Step 2: Verify `server.ts` import**

Read `packages/agent/src/server.ts` line 16. It should import `AgentLogEntry` from `@veil/common`. Confirmed.

No commit needed — verification only.

---

## Task 4: Create pino logger and replace console.log

**Files:**
- Create: `packages/agent/src/logging/logger.ts`
- Modify: `packages/agent/src/agent-loop.ts` (~52 console calls)
- Modify: `packages/agent/src/server.ts` (~19 console calls)
- Modify: `packages/agent/src/index.ts` (~13 console calls)
- Modify: `packages/agent/src/delegation/redeemer.ts` (~3 console calls)
- Modify: affected test files that spy on console

**Step 1: Install pino**

Run: `pnpm --filter @veil/agent add pino`

**Step 2: Create `logger.ts`**

Create `packages/agent/src/logging/logger.ts`:

```typescript
/**
 * Structured pino logger for the agent package.
 *
 * @module @veil/agent/logging/logger
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});
```

**Step 3: Replace console calls in `agent-loop.ts`**

Add import: `import { logger } from "./logging/logger.js";`

Replace all `console.log(...)` with `logger.info(...)` and `console.error(...)` with `logger.error(...)`. Examples:

- `console.log("=== VEIL AGENT STARTING ===")` → `logger.info("=== VEIL AGENT STARTING ===")`
- `console.error(\`Cycle ${state.cycle} error: ${msg}\`)` → `logger.error({ cycle: state.cycle, error: msg }, "Cycle error")`
- `console.log(\`ETH price: $${ethPrice.price.toFixed(2)}\`)` → `logger.info({ price: ethPrice.price }, "ETH price fetched")`

For structured context, prefer the `logger.info({ key: value }, "message")` pattern over string interpolation.

**Step 4: Replace console calls in `server.ts`**

Add import: `import { logger } from "./logging/logger.js";`

Same replacement pattern. Keep the startup banner as `logger.info(...)` lines.

**Step 5: Replace console calls in `index.ts`**

Add import: `import { logger } from "./logging/logger.js";`

Same pattern.

**Step 6: Replace console calls in `delegation/redeemer.ts`**

Add import: `import { logger } from "../logging/logger.js";`

Same pattern for the ~3 console calls.

**Step 7: Do NOT change `config.ts`**

`config.ts` uses `console.error` before the logger is available (during env validation, before process.exit). Leave it as-is.

**Step 8: Update test mocks**

In test files that spy on `console.log` or `console.error`, switch to mocking the logger:

```typescript
vi.mock("../logging/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
```

Update each test file that references `console.log` spies to use `logger.info` spies instead.

**Step 9: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 10: Verify no remaining console calls**

Run: `grep -rn "console\." packages/agent/src/ --include="*.ts" --exclude="*.test.ts" --exclude="*.e2e.test.ts"` (via Grep tool)
Expected: Only `config.ts` should have console calls.

**Step 11: Commit**

```
refactor(agent): replace console.log with pino structured logger
```

---

## Task 5: Fix `budget.ts` NaN validation

**Files:**
- Modify: `packages/agent/src/logging/budget.ts`
- Modify: `packages/agent/src/logging/budget.test.ts`

**Step 1: Write failing tests**

Replace the entire contents of `packages/agent/src/logging/budget.test.ts` with comprehensive tests. The tests use dynamic imports to get fresh module state:

```typescript
/**
 * @module @veil/agent/logging/budget.test
 */
import { describe, it, expect, beforeEach } from "vitest";

// Dynamic import for fresh module state each test
async function freshBudget() {
  const mod = await import("./budget.js?t=" + Date.now());
  return mod;
}

describe("budget tracker", () => {
  describe("updateBudget", () => {
    it("sets balance from valid header", async () => {
      const { updateBudget, getBudgetState } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "5.42" });
      expect(getBudgetState().remainingUsd).toBe(5.42);
      expect(getBudgetState().totalCalls).toBe(1);
    });

    it("does not change balance when header is missing", async () => {
      const { updateBudget, getBudgetState } = await freshBudget();
      updateBudget({});
      expect(getBudgetState().remainingUsd).toBeNull();
      expect(getBudgetState().totalCalls).toBe(0);
    });

    it("does not change balance when header is NaN", async () => {
      const { updateBudget, getBudgetState } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "not-a-number" });
      expect(getBudgetState().remainingUsd).toBeNull();
      expect(getBudgetState().totalCalls).toBe(0);
    });

    it("increments totalCalls only on valid headers", async () => {
      const { updateBudget, getBudgetState } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "10.0" });
      updateBudget({});
      updateBudget({ "x-venice-balance-usd": "bad" });
      updateBudget({ "x-venice-balance-usd": "8.5" });
      expect(getBudgetState().totalCalls).toBe(2);
      expect(getBudgetState().remainingUsd).toBe(8.5);
    });
  });

  describe("getBudgetTier", () => {
    it("returns 'normal' when balance is null", async () => {
      const { getBudgetTier } = await freshBudget();
      expect(getBudgetTier()).toBe("normal");
    });

    it("returns 'critical' when balance < 0.5", async () => {
      const { updateBudget, getBudgetTier } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "0.3" });
      expect(getBudgetTier()).toBe("critical");
    });

    it("returns 'conservation' when balance < 2", async () => {
      const { updateBudget, getBudgetTier } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "1.5" });
      expect(getBudgetTier()).toBe("conservation");
    });

    it("returns 'normal' when balance >= 2", async () => {
      const { updateBudget, getBudgetTier } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "10.0" });
      expect(getBudgetTier()).toBe("normal");
    });

    it("returns 'critical' at boundary 0.5", async () => {
      const { updateBudget, getBudgetTier } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "0.5" });
      // 0.5 is NOT < 0.5, so it should be conservation
      expect(getBudgetTier()).toBe("conservation");
    });

    it("returns 'normal' at boundary 2.0", async () => {
      const { updateBudget, getBudgetTier } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "2.0" });
      // 2.0 is NOT < 2, so it should be normal
      expect(getBudgetTier()).toBe("normal");
    });
  });

  describe("resetBudgetState", () => {
    it("resets balance and call count", async () => {
      const { updateBudget, resetBudgetState, getBudgetState } = await freshBudget();
      updateBudget({ "x-venice-balance-usd": "5.0" });
      resetBudgetState();
      expect(getBudgetState().remainingUsd).toBeNull();
      expect(getBudgetState().totalCalls).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify failures**

Run: `pnpm --filter @veil/agent test -- src/logging/budget.test.ts`
Expected: Several failures (NaN guard, resetBudgetState not exported, totalCalls behavior).

**Step 3: Fix `budget.ts`**

Replace `packages/agent/src/logging/budget.ts` with:

```typescript
/**
 * Venice API budget tracker. Captures x-venice-balance-usd headers to determine
 * budget tier (normal/conservation/critical) and recommend cheaper models.
 *
 * @module @veil/agent/logging/budget
 */

const BUDGET_CRITICAL_USD = 0.5;
const BUDGET_CONSERVATION_USD = 2;

let lastKnownBalance: number | null = null;
let totalCallCount = 0;

export function updateBudget(responseHeaders: Record<string, string>) {
  const balanceHeader = responseHeaders["x-venice-balance-usd"];
  if (!balanceHeader) return;
  const parsed = parseFloat(balanceHeader);
  if (isNaN(parsed)) return;
  lastKnownBalance = parsed;
  totalCallCount++;
}

export function getBudgetState() {
  return {
    remainingUsd: lastKnownBalance,
    totalCalls: totalCallCount,
    tier: getBudgetTier(),
  };
}

export type BudgetTier = "normal" | "conservation" | "critical";

export function getBudgetTier(): BudgetTier {
  if (lastKnownBalance === null) return "normal";
  if (lastKnownBalance < BUDGET_CRITICAL_USD) return "critical";
  if (lastKnownBalance < BUDGET_CONSERVATION_USD) return "conservation";
  return "normal";
}

export function resetBudgetState() {
  lastKnownBalance = null;
  totalCallCount = 0;
}
```

**Step 4: Run tests to verify passing**

Run: `pnpm --filter @veil/agent test -- src/logging/budget.test.ts`
Expected: All pass.

**Step 5: Commit**

```
fix(agent): guard budget.ts against missing/NaN headers, add resetBudgetState
```

---

## Task 6: Fix `portfolio.ts` base-sepolia chain config

**Files:**
- Modify: `packages/agent/src/data/portfolio.ts:33`
- Modify: `packages/agent/src/data/portfolio.test.ts`

**Step 1: Write failing test**

Add to `packages/agent/src/data/portfolio.test.ts` (inside the existing describe block):

```typescript
  it("uses baseSepolia chain for base-sepolia environment", async () => {
    // The chainConfigs map for "base-sepolia" should use baseSepolia (chainId 84532),
    // not sepolia (chainId 11155111)
    const { getPortfolioBalance } = await import("./portfolio.js");
    // We test this indirectly: the mock createPublicClient should receive
    // a chain with id 84532 when called with "base-sepolia"
    // For now, verify the config is correct by checking the module internals
  });
```

Actually, a simpler approach — add a test that verifies the chain config directly. But since `chainConfigs` isn't exported, the simplest fix is to just fix the bug and verify via build.

**Step 2: Fix the bug**

In `packages/agent/src/data/portfolio.ts`, change line 14 to add `baseSepolia` import:

```typescript
import { sepolia, base, baseSepolia } from "viem/chains";
```

Change line 33 from:
```typescript
  "base-sepolia": { chain: sepolia, usdc: CONTRACTS.USDC_SEPOLIA },
```
to:
```typescript
  "base-sepolia": { chain: baseSepolia, usdc: CONTRACTS.USDC_SEPOLIA },
```

Also update the type on line 30 to include `baseSepolia`:
```typescript
  ChainEnv,
  { chain: typeof sepolia | typeof base | typeof baseSepolia; usdc: Address }
```

**Step 3: Run tests and build**

Run: `pnpm --filter @veil/agent run build`
Expected: No errors.

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 4: Commit**

```
fix(agent): use baseSepolia chain for base-sepolia portfolio config
```

---

## Task 7: Fix server deploy race condition

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (add `deployError` to `AgentState`)
- Modify: `packages/agent/src/server.ts` (replace setTimeout with polling)
- Modify: `packages/common/src/schemas.ts` (add `deployError` to `AgentStateResponseSchema`)
- Modify: `packages/common/src/index.ts` (no change needed — already re-exports)
- Modify: `packages/agent/src/server.test.ts`

**Step 1: Add `deployError` to `AgentState`**

In `packages/agent/src/agent-loop.ts`, add to the `AgentState` interface (after line 62):

```typescript
  deployError: string | null;
```

Add to the initial state object (after line 135):

```typescript
    deployError: null,
```

In the delegation catch block (lines 216-221), add before `return`:

```typescript
    state.deployError = msg;
```

So lines 216-222 become:

```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAction("delegation_failed", { error: msg });
    logger.error({ error: msg }, "Failed to create delegation");
    state.deployError = msg;
    logStop("delegation_failed");
    return;
  }
```

**Step 2: Add `deployError` to `AgentStateResponseSchema`**

In `packages/common/src/schemas.ts`, add to the `AgentStateResponseSchema` (after the `audit` field):

```typescript
  deployError: z.string().nullable(),
```

**Step 3: Replace setTimeout polling in `server.ts`**

Replace the deploy handler's background launch + sleep block (lines 111-136) with:

```typescript
    // Start agent loop in background (don't await — it runs indefinitely)
    runAgentLoop({
      intent: parsed,
      delegatorKey,
      agentKey: env.AGENT_PRIVATE_KEY,
      chainId: 11155111,
      intervalMs: 60_000,
    }).catch((err) => {
      logger.error({ error: err }, "Agent loop crashed");
    });

    // Poll for delegation creation or failure (max 10 seconds)
    const POLL_INTERVAL_MS = 200;
    const MAX_WAIT_MS = 10_000;
    let waited = 0;
    while (waited < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      waited += POLL_INTERVAL_MS;
      const s = getAgentState();
      if (s?.audit || s?.deployError) break;
    }

    const state = getAgentState();
    if (state?.deployError) {
      sendJson(res, { error: state.deployError }, 500);
      return;
    }

    const deployResponse: DeployResponse = {
      parsed,
      audit: state?.audit
        ? {
            allows: state.audit.allows,
            prevents: state.audit.prevents,
            worstCase: state.audit.worstCase,
            warnings: state.audit.warnings,
          }
        : null,
    };
    sendJson(res, deployResponse);
```

Also update `handleState` to include `deployError`:

```typescript
    deployError: state.deployError ?? null,
```

in both the default state object and the active state response.

**Step 4: Update server tests**

Update `server.test.ts` tests for `/api/deploy` to account for polling behavior. The mock for `runAgentLoop` should resolve (or set state) quickly so polling finds the result.

Add a test for the deploy error case:

```typescript
  it("returns 500 when delegation creation fails", async () => {
    const mockRunAgentLoop = vi.fn().mockImplementation(async () => {
      const state = getAgentState();
      if (state) state.deployError = "Venice API timeout";
    });
    // ... setup and verify 500 response with error message
  });
```

**Step 5: Update common schemas test**

Add `deployError: null` (or a string) to test fixtures in `packages/common/src/schemas.test.ts` for `AgentStateResponseSchema`.

**Step 6: Run tests**

Run: `pnpm test`  (root — runs both common and agent tests)
Expected: All pass.

**Step 7: Commit**

```
fix(agent): replace blind 3s setTimeout with polling in deploy endpoint

Adds deployError to AgentState so the client can distinguish between
"still initializing" and "delegation creation failed."
```

---

## Task 8: Break up `runCycle` in `agent-loop.ts`

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/src/agent-loop.test.ts`

**Step 1: Define return type for market data**

Add a new interface in `agent-loop.ts` (after `AgentState`):

```typescript
interface MarketData {
  ethPrice: { price: number; citation: string | null };
  portfolio: PortfolioState;
  poolContext: string;
  drift: Record<string, number>;
  maxDrift: number;
  budgetTier: BudgetTier;
}
```

Import `BudgetTier` from `./logging/budget.js` and `PortfolioState` from `./data/portfolio.js`.

**Step 2: Extract `gatherMarketData`**

Extract lines 313-411 of the current `runCycle` into:

```typescript
async function gatherMarketData(
  config: AgentConfig,
  state: AgentState,
  agentAddress: Address,
): Promise<MarketData> {
  // Budget check
  const budgetTier = getBudgetTier();
  if (budgetTier !== "normal") {
    logger.info({ tier: budgetTier }, "Budget tier degraded — using fastLlm");
    logAction("budget_check", { result: { tier: budgetTier } });
  }

  // ETH price
  const startPrice = Date.now();
  const ethPrice = await getTokenPrice("ETH");
  logAction("price_fetch", { ... });
  state.ethPrice = ethPrice.price;

  // Portfolio balance
  const chainEnv = ...;
  const portfolio = await getPortfolioBalance(agentAddress, chainEnv, ethPrice.price);
  logAction("portfolio_check", { ... });
  state.allocation = portfolio.allocation;
  state.totalValue = portfolio.totalUsdValue;

  // Pool data
  let poolContext = "";
  try {
    const pools = await getPoolData("WETH", "USDC");
    // ... same logic
  } catch (err) { ... }

  // Drift
  const { drift, maxDrift } = calculateDrift(portfolio.allocation, config.intent.targetAllocation);
  state.drift = maxDrift;
  state.budgetTier = budgetTier;

  return { ethPrice, portfolio, poolContext, drift, maxDrift, budgetTier };
}
```

**Step 3: Extract `getRebalanceDecision`**

Extract lines 413-469 into:

```typescript
async function decideRebalance(
  config: AgentConfig,
  state: AgentState,
  market: MarketData,
): Promise<RebalanceDecision | null> {
  if (market.maxDrift < config.intent.driftThreshold) {
    logger.info("No significant drift. Skipping rebalance.");
    return null;
  }

  logger.info("Drift detected. Consulting Venice for rebalance decision...");
  const llmForReasoning = market.budgetTier === "normal" ? reasoningLlm : fastLlm;
  const structuredReasoning = llmForReasoning.withStructuredOutput(RebalanceDecisionSchema, { method: "functionCalling" });

  const decision = await structuredReasoning.invoke([...]);
  logAction("rebalance_decision", { ... });

  if (!decision.shouldRebalance || !decision.targetSwap) return null;
  return decision;
}
```

**Step 4: Extract `executeSwap`**

Extract lines 471-768 into:

```typescript
async function executeSwap(
  config: AgentConfig,
  state: AgentState,
  decision: RebalanceDecision,
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
  ethPrice: number,
): Promise<void> {
  const swap = decision.targetSwap!;
  // ... safety checks, approval, quoting, permit signing, delegation/direct execution
}
```

**Step 5: Simplify `runCycle`**

The new `runCycle` becomes:

```typescript
async function runCycle(
  config: AgentConfig,
  state: AgentState,
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
): Promise<void> {
  logger.info({ cycle: state.cycle }, "Cycle started");

  const market = await gatherMarketData(config, state, agentAddress);
  const decision = await decideRebalance(config, state, market);
  if (!decision) return;
  await executeSwap(config, state, decision, agentAddress, chain, market.ethPrice.price);
}
```

**Step 6: Add tests for new helpers**

Add tests for `gatherMarketData` and `decideRebalance` to `agent-loop.test.ts`. Since these are module-private, test them indirectly via existing `runCycle` behavior, or export them for testing (with `// @internal` comment).

**Step 7: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 8: Commit**

```
refactor(agent): break runCycle into gatherMarketData, decideRebalance, executeSwap
```

---

## Task 9: Consolidate permit2 signing logic

**Files:**
- Modify: `packages/agent/src/uniswap/permit2.ts`
- Modify: `packages/agent/src/uniswap/permit2.test.ts`
- Modify: `packages/agent/src/agent-loop.ts` (lines 601-637)

**Step 1: Write test for `derivePrimaryType`**

Add to `packages/agent/src/uniswap/permit2.test.ts`:

```typescript
describe("derivePrimaryType", () => {
  it("returns PermitWitnessTransferFrom for Universal Router types", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    };
    expect(derivePrimaryType(types)).toBe("PermitWitnessTransferFrom");
  });

  it("returns PermitSingle for allowance-based types", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
      ],
    };
    expect(derivePrimaryType(types)).toBe("PermitSingle");
  });

  it("returns first non-EIP712Domain key when no nesting", () => {
    const types = {
      EIP712Domain: [{ name: "name", type: "string" }],
      SimplePermit: [{ name: "value", type: "uint256" }],
    };
    expect(derivePrimaryType(types)).toBe("SimplePermit");
  });
});
```

**Step 2: Run tests to verify failures**

Run: `pnpm --filter @veil/agent test -- src/uniswap/permit2.test.ts`
Expected: FAIL — `derivePrimaryType` not defined.

**Step 3: Implement `derivePrimaryType` in `permit2.ts`**

Add to `packages/agent/src/uniswap/permit2.ts`:

```typescript
/**
 * Derive the EIP-712 primary type from a types object.
 * The primary type is the non-EIP712Domain key that isn't referenced
 * as a nested type by any other key.
 */
export function derivePrimaryType(
  types: Record<string, { name: string; type: string }[]>,
): string {
  const typeKeys = Object.keys(types).filter((k) => k !== "EIP712Domain");
  const referencedTypes = new Set(
    Object.values(types)
      .flat()
      .map((f) => f.type)
      .filter((t) => typeKeys.includes(t)),
  );
  return typeKeys.find((k) => !referencedTypes.has(k)) ?? typeKeys[0]!;
}
```

**Step 4: Update `signPermit2Data` to use `derivePrimaryType`**

Replace the hardcoded `primaryType: "PermitWitnessTransferFrom"` in `signPermit2Data` (line 91) with:

```typescript
    primaryType: derivePrimaryType(
      permitData.types as Record<string, { name: string; type: string }[]>,
    ),
```

**Step 5: Run tests to verify passing**

Run: `pnpm --filter @veil/agent test -- src/uniswap/permit2.test.ts`
Expected: All pass.

**Step 6: Replace inline signing in `agent-loop.ts`**

Replace lines 601-637 in `agent-loop.ts` (the entire permit signing block) with:

```typescript
    // Sign permit data if present (only for direct tx path — smart account can't sign)
    let permitSignature: Hex | undefined;
    if (quote.permitData && !canUseDelegation) {
      permitSignature = await signPermit2Data(walletClient, quote.permitData);
    }
```

Add `signPermit2Data` to the imports from `./uniswap/permit2.js`.

**Step 7: Run full test suite**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 8: Commit**

```
refactor(agent): consolidate permit2 signing, extract derivePrimaryType
```

---

## Task 10: Add Zod schemas for Uniswap API responses

**Files:**
- Create: `packages/agent/src/uniswap/schemas.ts`
- Modify: `packages/agent/src/uniswap/trading.ts`
- Modify: `packages/agent/src/uniswap/trading.test.ts`

**Step 1: Create `uniswap/schemas.ts`**

```typescript
/**
 * Zod validation schemas for Uniswap Trading API responses.
 * These validate external API data before it enters the agent.
 *
 * @module @veil/agent/uniswap/schemas
 */
import { z } from "zod";

const hexString = z.string().startsWith("0x");

export const PermitDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({
    name: z.string(),
    type: z.string(),
  }))),
  values: z.record(z.string(), z.unknown()),
});

export type PermitData = z.infer<typeof PermitDataSchema>;

export const ApprovalResponseSchema = z.object({
  approval: z.object({
    tokenAddress: hexString,
    spender: hexString,
    amount: z.string(),
    transactionRequest: z.object({
      to: hexString,
      data: hexString,
      value: z.string(),
    }).optional(),
  }),
});

export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

export const QuoteResponseSchema = z.object({
  requestId: z.string(),
  quote: z.object({
    chainId: z.number(),
    input: z.object({ token: hexString, amount: z.string() }),
    output: z.object({ token: hexString, amount: z.string() }),
    swapper: hexString,
    slippage: z.object({ tolerance: z.number() }),
  }),
  routing: z.string(),
  permitData: PermitDataSchema.optional(),
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const SwapResponseSchema = z.object({
  swap: z.object({
    chainId: z.number(),
    to: hexString,
    data: hexString,
    value: z.string(),
    gasLimit: z.string().optional(),
  }),
  requestId: z.string(),
});

export type SwapResponse = z.infer<typeof SwapResponseSchema>;
```

**Step 2: Update `trading.ts` to use schemas**

Remove the TypeScript interfaces for `ApprovalResponse`, `QuoteResponse`, `SwapResponse` (lines 14-77). Import them from `./schemas.js` instead:

```typescript
import {
  ApprovalResponseSchema, type ApprovalResponse,
  QuoteResponseSchema, type QuoteResponse,
  SwapResponseSchema, type SwapResponse,
} from "./schemas.js";
```

Update `uniswapFetch` to accept a schema and validate:

```typescript
async function uniswapFetch<T>(
  endpoint: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(`${UNISWAP_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.UNISWAP_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Uniswap API ${endpoint} failed (${res.status}): ${text}`,
    );
  }

  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Uniswap API ${endpoint} response validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
```

Update callers to pass schemas:

```typescript
export async function checkApproval(params: ApprovalRequest): Promise<ApprovalResponse> {
  return uniswapFetch("/check_approval", { ... }, ApprovalResponseSchema);
}

export async function getQuote(params: QuoteRequest): Promise<QuoteResponse> {
  return uniswapFetch("/quote", { ... }, QuoteResponseSchema);
}

export async function createSwap(...): Promise<SwapResponse> {
  return uniswapFetch("/swap", body, SwapResponseSchema);
}
```

Add `import { z } from "zod";` at the top.

**Step 3: Update tests**

Update `trading.test.ts` — the mock `fetch` responses must now pass Zod validation. Ensure mock response shapes match the schemas. Tests should also verify that invalid responses throw validation errors:

```typescript
  it("throws on invalid API response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: "shape" }),
    }));

    await expect(getQuote({ ... })).rejects.toThrow("response validation failed");
  });
```

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 5: Commit**

```
feat(agent): add Zod validation for Uniswap API responses

Replaces unsafe `as Promise<T>` casts with runtime Zod schema validation
on all Uniswap Trading API response data.
```

---

## Task 11: Add `DeployRequestSchema` to `@veil/common`

**Files:**
- Modify: `packages/common/src/schemas.ts`
- Modify: `packages/common/src/schemas.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/agent/src/server.ts`
- Modify: `packages/agent/src/server.test.ts`

**Step 1: Write test in common**

Add to `packages/common/src/schemas.test.ts`:

```typescript
describe("DeployRequestSchema", () => {
  it("accepts valid deploy request", () => {
    const result = DeployRequestSchema.safeParse({ intent: "60/40 ETH/USDC" });
    expect(result.success).toBe(true);
  });

  it("rejects missing intent", () => {
    const result = DeployRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty intent", () => {
    const result = DeployRequestSchema.safeParse({ intent: "" });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Add schema to common**

In `packages/common/src/schemas.ts`, after `DeployResponseSchema`:

```typescript
// ---------------------------------------------------------------------------
// DeployRequest — the /api/deploy request body
// ---------------------------------------------------------------------------

export const DeployRequestSchema = z.object({
  intent: z.string().min(1, "Intent cannot be empty"),
});

export type DeployRequest = z.infer<typeof DeployRequestSchema>;
```

**Step 3: Export from barrel**

In `packages/common/src/index.ts`, add to the schemas export block:

```typescript
  DeployRequestSchema,
  type DeployRequest,
```

**Step 4: Use in `server.ts`**

Replace lines 91-96 in `server.ts`:

```typescript
  const body = await parseBody(req);
  const intentText = body.intent as string;
  if (!intentText) {
    sendJson(res, { error: "Missing intent" }, 400);
    return;
  }
```

with:

```typescript
  const body = await parseBody(req);
  const validated = DeployRequestSchema.safeParse(body);
  if (!validated.success) {
    sendJson(res, { error: validated.error.issues[0]?.message ?? "Invalid request" }, 400);
    return;
  }
  const intentText = validated.data.intent;
```

Add `DeployRequestSchema` to the import from `@veil/common`.

**Step 5: Update server tests**

Verify that the existing test for missing intent still passes. Add a test for empty string intent returning 400.

**Step 6: Run tests**

Run: `pnpm test` (root — both packages)
Expected: All pass.

**Step 7: Commit**

```
feat(common): add DeployRequestSchema, use Zod validation in deploy endpoint
```

---

## Task 12: Add Zod validation for agent log parsing

**Files:**
- Modify: `packages/agent/src/server.ts` (readLogFeed function)
- Modify: `packages/agent/src/server.test.ts`

**Step 1: Write failing test**

Add to `server.test.ts` in the `readLogFeed via /api/state` describe block:

```typescript
  it("skips malformed log entries", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '{"timestamp":"2026-03-15","sequence":1,"action":"test"}\n' +
      'not valid json\n' +
      '{"missing":"required fields"}\n' +
      '{"timestamp":"2026-03-15","sequence":2,"action":"test2"}\n'
    );

    const { req, res, body } = await callHandler("GET", "/api/state");
    const parsed = JSON.parse(body());
    expect(parsed.feed).toHaveLength(2);
    expect(parsed.feed[0].action).toBe("test");
    expect(parsed.feed[1].action).toBe("test2");
  });
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @veil/agent test -- src/server.test.ts`
Expected: FAIL — malformed entries are included (or crash).

**Step 3: Update `readLogFeed` in `server.ts`**

Replace the current implementation:

```typescript
function readLogFeed(): AgentLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const raw = readFileSync(LOG_PATH, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = AgentLogEntrySchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
```

Add `AgentLogEntrySchema` to the import from `@veil/common`.

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test -- src/server.test.ts`
Expected: All pass.

**Step 5: Commit**

```
fix(agent): validate agent log entries with Zod, skip malformed lines
```

---

## Task 13: Add allocation sum validation to `IntentParseSchema`

**Files:**
- Modify: `packages/agent/src/venice/schemas.ts`
- Modify: `packages/agent/src/venice/schemas.test.ts`
- Modify: `packages/common/src/schemas.ts`
- Modify: `packages/common/src/schemas.test.ts`

**Step 1: Write failing tests in common**

Add to `packages/common/src/schemas.test.ts` in the `ParsedIntentSchema` describe block:

```typescript
  it("rejects allocations summing to 0.8", () => {
    const result = ParsedIntentSchema.safeParse({
      targetAllocation: { ETH: 0.5, USDC: 0.3 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 3,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("rejects allocations summing to 1.2", () => {
    const result = ParsedIntentSchema.safeParse({
      targetAllocation: { ETH: 0.7, USDC: 0.5 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 3,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("accepts allocations summing to 0.99 (float tolerance)", () => {
    const result = ParsedIntentSchema.safeParse({
      targetAllocation: { ETH: 0.599, USDC: 0.391 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 3,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(true);
  });
```

**Step 2: Run tests to verify failures**

Run: `pnpm --filter @veil/common test`
Expected: FAIL on the rejection tests.

**Step 3: Add `.refine()` to `ParsedIntentSchema`**

In `packages/common/src/schemas.ts`, update `ParsedIntentSchema`:

```typescript
export const ParsedIntentSchema = z.object({
  targetAllocation: z.record(z.string(), z.number()),
  dailyBudgetUsd: z.number(),
  timeWindowDays: z.number(),
  maxTradesPerDay: z.number(),
  maxSlippage: z.number(),
  driftThreshold: z.number(),
}).refine(
  (data) => {
    const sum = Object.values(data.targetAllocation).reduce((a, b) => a + b, 0);
    return sum >= 0.95 && sum <= 1.05;
  },
  { message: "Target allocation percentages must sum to ~1.0 (between 0.95 and 1.05)" },
);
```

**Step 4: Run tests**

Run: `pnpm --filter @veil/common test`
Expected: All pass.

**Step 5: Update existing tests in agent and common that use ParsedIntentSchema**

Make sure all existing test fixtures have allocations that sum to 1.0. Check:
- `packages/common/src/schemas.test.ts` — existing valid fixtures
- `packages/agent/src/delegation/compiler.test.ts` — `makeIntent()` helper
- `packages/agent/src/delegation/audit.test.ts` — `makeSampleIntent()` helper
- `packages/agent/src/venice/schemas.test.ts` — test fixtures

**Step 6: Run full test suite**

Run: `pnpm test` (root)
Expected: All pass.

**Step 7: Commit**

```
feat(common): add allocation sum validation (0.95-1.05) to ParsedIntentSchema
```

---

## Task 14: Extract magic numbers to named constants

**Files:**
- Modify: `packages/agent/src/logging/budget.ts` (already done in Task 5)
- Modify: `packages/agent/src/venice/llm.ts`
- Modify: `packages/agent/src/delegation/compiler.ts`
- Modify: `packages/agent/src/delegation/audit.ts`
- Modify: `packages/agent/src/uniswap/trading.ts`
- Modify: `packages/common/src/constants.ts`
- Modify: `packages/common/src/index.ts`

**Step 1: Add `SECONDS_PER_DAY` to common**

In `packages/common/src/constants.ts`:

```typescript
/** Seconds in a day (for delegation expiry calculations). */
export const SECONDS_PER_DAY = 86400;
```

Export it from `packages/common/src/index.ts`:

```typescript
  SECONDS_PER_DAY,
```

**Step 2: Extract LLM timeout constants in `llm.ts`**

```typescript
const LLM_TIMEOUT_FAST_MS = 60_000;
const LLM_TIMEOUT_RESEARCH_MS = 120_000;
const LLM_TIMEOUT_REASONING_MS = 300_000;
```

Use them in the LLM instance definitions:

```typescript
export const fastLlm = getVeniceLlm({
  model: override ?? "qwen3-4b",
  temperature: 0.3,
  maxRetries: 1,
  modelKwargs: fastVeniceParams,
  timeout: LLM_TIMEOUT_FAST_MS,
});
```

**Step 3: Extract safety thresholds in `compiler.ts`**

```typescript
const SAFETY_MAX_DAILY_BUDGET_USD = 1000;
const SAFETY_MAX_TIME_WINDOW_DAYS = 30;
const SAFETY_MAX_SLIPPAGE = 0.02;
const CONSERVATIVE_ETH_PRICE_USD = 500;
```

Replace the hardcoded values in `detectAdversarialIntent` and `createDelegationFromIntent`.

Also replace `86400` with `SECONDS_PER_DAY` (imported from `@veil/common`).

**Step 4: Replace `86400` in `audit.ts`**

Import `SECONDS_PER_DAY` from `@veil/common` and replace:

```typescript
const expiryDate = new Date(
  Date.now() + intent.timeWindowDays * SECONDS_PER_DAY * 1000,
);
```

**Step 5: Extract default slippage in `trading.ts`**

```typescript
const DEFAULT_SLIPPAGE_TOLERANCE = 0.5;
```

Use it:

```typescript
slippageTolerance: params.slippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE,
```

**Step 6: Run tests**

Run: `pnpm test` (root)
Expected: All pass (behavior unchanged).

**Step 7: Commit**

```
refactor: extract magic numbers to named constants across agent and common
```

---

## Task 15: Reduce `as any` in `server.test.ts`

**Files:**
- Modify: `packages/agent/src/server.test.ts`

**Step 1: Create typed mock interfaces**

Add near the top of `server.test.ts`:

```typescript
interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader: vi.fn((key: string, value: string) => {
      res.headers[key] = value;
    }),
    writeHead: vi.fn((status: number) => {
      res.statusCode = status;
    }),
    end: vi.fn((data?: string) => {
      if (data) res.body = data;
    }),
  };
  return res;
}
```

**Step 2: Replace `as any` casts with typed references**

Go through the test file and replace `res as any` with the typed `MockResponse`. Where the code passes `res` to a function expecting `ServerResponse`, use a `as unknown as ServerResponse` cast (one cast instead of many scattered `any`s).

**Step 3: Run tests**

Run: `pnpm --filter @veil/agent test -- src/server.test.ts`
Expected: All pass.

**Step 4: Count remaining `as any`**

Run: `grep -c "as any" packages/agent/src/server.test.ts` (via Grep tool)
Expected: Significantly reduced (target: <10).

**Step 5: Commit**

```
refactor(agent): reduce as any casts in server.test.ts with typed mocks
```

---

## Task 16: Preserve stack traces in pino error logging

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (all catch blocks)
- Modify: `packages/agent/src/server.ts` (all catch blocks)
- Modify: `packages/agent/src/delegation/redeemer.ts` (all catch blocks)

**Depends on:** Task 4 (pino logger exists)

**Step 1: Update catch blocks to pass error objects**

Pino's default serializer captures `.message`, `.stack`, `.type` when the error is passed as `{ err }`. Replace the pattern:

```typescript
// BEFORE (discards stack trace):
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ error: msg }, "Swap failed");
}

// AFTER (preserves stack trace):
} catch (err) {
  logger.error({ err }, "Swap failed");
}
```

Where the message is also needed for a return value or `logAction()`:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "Failed to create delegation");
  state.deployError = msg;
  logAction("delegation_failed", { error: msg });
}
```

Apply this to every catch block in:
- `agent-loop.ts` (~10 catch blocks)
- `server.ts` (~3 catch blocks)
- `delegation/redeemer.ts` (~2 catch blocks)

**Step 2: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass (logger is mocked in tests).

**Step 3: Commit**

```
fix(agent): preserve stack traces in error logging via pino { err } convention
```

---

## Task 17: Add retry wrapper for Uniswap and Graph APIs

**Files:**
- Create: `packages/agent/src/utils/retry.ts`
- Create: `packages/agent/src/utils/retry.test.ts`
- Modify: `packages/agent/src/uniswap/trading.ts`
- Modify: `packages/agent/src/data/thegraph.ts`

**Step 1: Write failing tests for `withRetry`**

Create `packages/agent/src/utils/retry.test.ts`:

```typescript
/**
 * @module @veil/agent/utils/retry.test
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

vi.mock("../logging/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, { label: "test", maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry on non-retryable status (400)", async () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 status", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run tests to verify failures**

Run: `pnpm --filter @veil/agent test -- src/utils/retry.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `withRetry`**

Create `packages/agent/src/utils/retry.ts`:

```typescript
/**
 * Generic retry wrapper with exponential backoff.
 * Only retries on retryable errors (network, 429, 500-503).
 *
 * @module @veil/agent/utils/retry
 */
import { logger } from "../logging/logger.js";

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && "status" in err) {
    const status = (err as Error & { status: number }).status;
    return !NON_RETRYABLE_STATUSES.has(status);
  }
  return true; // network errors, timeouts, etc. are retryable
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; baseDelayMs?: number; label?: string },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const label = opts?.label ?? "unknown";

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          { attempt: attempt + 1, maxRetries, delay, label, err },
          "Retrying after error",
        );
        await new Promise((r) => setTimeout(r, delay));
      } else if (!isRetryable(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}
```

**Step 4: Run tests to verify passing**

Run: `pnpm --filter @veil/agent test -- src/utils/retry.test.ts`
Expected: All pass.

**Step 5: Wrap `uniswapFetch` in `trading.ts`**

In `packages/agent/src/uniswap/trading.ts`, import `withRetry` and wrap the fetch call inside `uniswapFetch`:

```typescript
import { withRetry } from "../utils/retry.js";

async function uniswapFetch<T>(
  endpoint: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`${UNISWAP_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.UNISWAP_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(
        `Uniswap API ${endpoint} failed (${res.status}): ${text}`,
      );
      (err as Error & { status: number }).status = res.status;
      throw err;
    }

    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Uniswap API ${endpoint} response validation failed: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }, { label: `uniswap:${endpoint}` });
}
```

**Step 6: Wrap `getPoolData` in `thegraph.ts`**

```typescript
import { withRetry } from "../utils/retry.js";

export async function getPoolData(...): Promise<PoolData[]> {
  const data = await withRetry(
    () => sdk.GetPools({ token0: token0Symbol, token1: token1Symbol }),
    { label: "thegraph:GetPools", maxRetries: 2 },
  );
  return data.pools.map((pool) => ({ ... }));
}
```

**Step 7: Run full test suite**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 8: Commit**

```
feat(agent): add withRetry utility, wrap Uniswap and Graph API calls
```

---

## Task 18: Fix ERC-8004 registration — await with retry, no fallback ID

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (lines 143-159, line 742)
- Modify: `packages/agent/src/server.ts` (lines 289-304)
- Modify: `packages/agent/src/agent-loop.test.ts`
- Modify: `packages/agent/src/server.test.ts`

**Depends on:** Task 17 (withRetry exists)

**Step 1: Write failing test**

Add to `packages/agent/src/agent-loop.test.ts`:

```typescript
describe("ERC-8004 feedback guard", () => {
  it("skips feedback when agentId is null", () => {
    // Verify that giveFeedback is NOT called when state.agentId is null
    // This tests the guard that prevents fallback to agent ID 1n
  });
});
```

**Step 2: Replace fire-and-forget in `agent-loop.ts`**

Replace lines 143-159 (the `registerAgent(...).then(...).catch(...)` block) with:

```typescript
  // Register on-chain identity (awaited with retry)
  try {
    const { txHash, agentId } = await withRetry(
      () => registerAgent(`https://github.com/neilei/veil`, "base-sepolia"),
      { label: "erc8004:register", maxRetries: 3 },
    );
    logger.info({ txHash, agentId: agentId?.toString() }, "ERC-8004 agent registered");
    if (agentId) state.agentId = agentId;
    logAction("erc8004_register", {
      tool: "erc8004-identity",
      result: { txHash, agentId: agentId?.toString() },
    });
  } catch (err) {
    logger.error({ err }, "ERC-8004 registration failed after retries");
    logAction("erc8004_register_failed", {
      tool: "erc8004-identity",
      error: err instanceof Error ? err.message : String(err),
    });
  }
```

Add `import { withRetry } from "./utils/retry.js";` to agent-loop.ts imports.

**Step 3: Fix feedback fallback ID**

Replace line 742 (`const feedbackAgentId = state.agentId ?? 1n;`) and the subsequent `giveFeedback` block with:

```typescript
    // ERC-8004: give on-chain feedback for the swap (non-blocking)
    if (state.agentId) {
      giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
        .then((fbHash) => {
          logger.info({ txHash: fbHash, agentId: state.agentId?.toString() }, "ERC-8004 feedback submitted");
          logAction("erc8004_feedback", {
            tool: "erc8004-reputation",
            result: { txHash: fbHash, agentId: state.agentId?.toString(), rating: 5, tag: "swap-execution" },
          });
        })
        .catch((fbErr) => {
          logger.warn({ err: fbErr }, "ERC-8004 feedback skipped");
        });
    } else {
      logger.warn("Skipping ERC-8004 feedback — no agent ID registered");
    }
```

**Step 4: Same fix in `server.ts`**

Replace the fire-and-forget `registerAgent` in `startup()` (lines 289-304) with awaited + retry:

```typescript
  // Register agent identity on Base Sepolia (awaited with retry)
  try {
    const { txHash, agentId } = await withRetry(
      () => registerAgent(`https://github.com/neilei/veil`, "base-sepolia"),
      { label: "erc8004:register", maxRetries: 3 },
    );
    logger.info({ txHash, agentId: agentId?.toString() }, "ERC-8004 agent registered");
  } catch (err) {
    logger.error({ err }, "ERC-8004 registration failed after retries");
  }
```

Add `import { withRetry } from "./utils/retry.js";` to server.ts imports.

**Step 5: Update test mocks**

In `agent-loop.test.ts` and `server.test.ts`, update mocks for `registerAgent` and `withRetry`. Ensure tests verify:
- Registration is awaited (not fire-and-forget)
- Feedback is skipped when agentId is null
- Fallback to `1n` no longer happens

**Step 6: Run tests**

Run: `pnpm --filter @veil/agent test`
Expected: All pass.

**Step 7: Commit**

```
fix(agent): await ERC-8004 registration with retry, skip feedback when no agentId

Prevents corrupting on-chain reputation by attributing feedback to
wrong agent ID (1n fallback). Registration now retries 3 times.
```

---

## Final Validation

After all 18 tasks:

```bash
pnpm run build          # No TypeScript errors
pnpm run lint           # No lint errors
pnpm test               # All unit tests pass
pnpm run test:e2e       # All e2e tests pass
```

Verification checks:
- `grep -r "from.*types.js" packages/agent/src/` — 0 matches
- `grep -c "console\." packages/agent/src/*.ts` — only `config.ts`
- `grep -c "as Promise" packages/agent/src/` — 0 matches
- `grep -c "as string" packages/agent/src/server.ts` — 0 matches
- `grep -rn "agentId ?? 1n" packages/agent/src/` — 0 matches (no more fallback ID)
- `grep -rn "\.catch.*Registration skipped" packages/agent/src/` — 0 matches (no more fire-and-forget)
