# Unit Test Condensation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce unit test line count by ~20% (~550 lines) through DRYing repetitive patterns, removing redundant/subset tests, and extracting shared fixtures — with zero coverage loss.

**Architecture:** Work file-by-file in dependency order. Start with shared infrastructure (mock setup file, shared fixtures), then modify individual test files. After every task, run `pnpm test:unit` to confirm all 242 tests still pass (test count may decrease slightly as `it.each` collapses multiple `it` blocks into one, but coverage is identical).

**Tech Stack:** Vitest, `it.each`/`describe.each`, TypeScript

**Baseline:** 5,088 lines across 22 unit test files, 242 passing tests.

---

## Ordering Rationale

Tasks are grouped into 3 phases:

1. **Phase 1 (Tasks 1-2):** Create shared infrastructure that later tasks depend on.
2. **Phase 2 (Tasks 3-11):** Modify `packages/agent/` test files (most savings).
3. **Phase 3 (Tasks 12-15):** Modify `packages/common/` test files.

Within each phase, files are independent — order doesn't matter. Commit after each task.

---

### Task 1: Create shared mock setup for agent-loop and server tests

Both `agent-loop.test.ts` and `server.test.ts` mock the same ~15 modules with identical stubs. Extract to a shared file.

**Files:**
- Create: `packages/agent/src/__tests__/mock-agent-deps.ts`

**Step 1: Create the shared mock setup file**

```typescript
/**
 * Shared vi.mock() calls for tests that import modules depending on the
 * full agent dependency tree (agent-loop, server). Import this file
 * BEFORE importing the module under test.
 */
import { vi } from "vitest";

export function mockAgentDeps() {
  vi.mock("../config.js", () => ({
    env: {
      VENICE_API_KEY: "x",
      VENICE_BASE_URL: "https://x",
      UNISWAP_API_KEY: "x",
      AGENT_PRIVATE_KEY:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    },
    CONTRACTS: {
      NATIVE_ETH: "0x0000000000000000000000000000000000000000",
      WETH_SEPOLIA: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      WETH_BASE: "0x4200000000000000000000000000000000000006",
      USDC_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    CHAINS: {},
    UNISWAP_API_BASE: "",
    THEGRAPH_UNISWAP_V3_BASE: "",
  }));
  vi.mock("../venice/llm.js", () => ({
    researchLlm: {},
    reasoningLlm: {},
    fastLlm: {},
  }));
  vi.mock("../data/portfolio.js", () => ({ getPortfolioBalance: vi.fn() }));
  vi.mock("../data/prices.js", () => ({ getTokenPrice: vi.fn() }));
  vi.mock("../data/thegraph.js", () => ({ getPoolData: vi.fn() }));
  vi.mock("../delegation/compiler.js", () => ({
    compileIntent: vi.fn(),
    createDelegationFromIntent: vi.fn(),
    detectAdversarialIntent: vi.fn(),
  }));
  vi.mock("../delegation/audit.js", () => ({
    generateAuditReport: vi.fn(),
  }));
  vi.mock("../delegation/redeemer.js", () => ({
    createRedeemClient: vi.fn(),
    redeemDelegation: vi.fn(),
  }));
  vi.mock("../uniswap/trading.js", () => ({
    getQuote: vi.fn(),
    createSwap: vi.fn(),
  }));
  vi.mock("../logging/agent-log.js", () => ({
    logAction: vi.fn(),
    logStart: vi.fn(),
    logStop: vi.fn(),
  }));
  vi.mock("../logging/budget.js", () => ({
    getBudgetTier: vi.fn().mockReturnValue("normal"),
  }));
  vi.mock("../identity/erc8004.js", () => ({
    registerAgent: vi.fn(),
    giveFeedback: vi.fn(),
  }));
  vi.mock("../logging/logger.js", () => ({
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }));
  vi.mock("../uniswap/permit2.js", () => ({ signPermit2Data: vi.fn() }));
  vi.mock("../utils/retry.js", () => ({
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
  }));
}
```

**Step 2: Run tests to verify nothing broke (file is inert until imported)**

Run: `pnpm test:unit`
Expected: 242 tests pass, no change.

**Step 3: Commit**

Message: `refactor(tests): extract shared agent dependency mocks`

---

### Task 2: Create shared intent fixture for compiler and audit tests

Both `compiler.test.ts` (`makeIntent`) and `audit.test.ts` (`makeSampleIntent`) define identical factories. Extract to shared file.

**Files:**
- Create: `packages/agent/src/__tests__/fixtures.ts`

**Step 1: Create the shared fixtures file**

```typescript
/**
 * Shared test fixtures for agent unit tests.
 */
import type { IntentParse } from "../venice/schemas.js";

/** Create a valid IntentParse with optional overrides. */
export function makeIntent(overrides: Partial<IntentParse> = {}): IntentParse {
  return {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
    ...overrides,
  };
}

/** Create a sample delegation object for audit tests. */
export function makeSampleDelegation(overrides: Record<string, unknown> = {}) {
  return {
    delegate: "0xagent",
    delegator: "0xdelegator",
    authority:
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    caveats: [
      {
        enforcer: "0x1234",
        terms: "0x",
        args: "0x",
      },
    ],
    salt: "0x01",
    signature: "0xsigned",
    ...overrides,
  };
}
```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: 242 tests pass, no change.

**Step 3: Commit**

Message: `refactor(tests): extract shared intent and delegation fixtures`

---

### Task 3: Condense agent-loop.test.ts

Remove the mock-object agentId tests (lines 96-117) that test JS semantics, not production code. Replace inline mocks with shared import.

**Files:**
- Modify: `packages/agent/src/__tests__/agent-loop.test.ts`

**Step 1: Rewrite the file**

Replace the top-level `vi.mock(...)` block (lines 9-39) with:

```typescript
import { mockAgentDeps } from "./mock-agent-deps.js";
mockAgentDeps();
```

Delete the entire `describe("Agent Loop - AgentState agentId", ...)` block (lines 96-117).

Keep all other describes unchanged.

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 3 (the removed agentId tests).

**Step 3: Commit**

Message: `refactor(tests): condense agent-loop tests, use shared mocks`

---

### Task 4: Condense server.test.ts

Replace inline mocks with shared import. Remove redundant null mock resets, dead `headWritten` property, and subset CORS test.

**Files:**
- Modify: `packages/agent/src/__tests__/server.test.ts`

**Step 1: Apply changes**

1. Replace lines 49-108 (the big `vi.mock(...)` block for internal deps) with:
   ```typescript
   import { mockAgentDeps } from "./mock-agent-deps.js";
   mockAgentDeps();
   // Override erc8004 mock to add resolved values needed by server
   vi.mock("../identity/erc8004.js", () => ({
     registerAgent: vi.fn().mockResolvedValue({ txHash: "0xabc", agentId: 1 }),
     giveFeedback: vi.fn(),
   }));
   ```

2. In `readLogFeed` tests: remove the 4 lines that explicitly set `mockGetAgentState.mockReturnValue(null)` and `mockGetAgentConfig.mockReturnValue(null)` — these are already the `afterEach` defaults. Only keep them in tests that need a *different* starting state.

   Specifically remove these redundant lines from:
   - "returns empty feed when log file does not exist" (lines 284-286 — keep `mockExistsSync` line, remove the two null mock lines)
   - "returns parsed log entries when file exists" (lines 309-310)
   - "skips malformed JSON lines" (lines 332-333)
   - "skips entries that fail Zod schema validation" (lines 355-356)
   - "handles readFileSync throwing" (lines 374-375)
   - "handles empty log file" (lines 389-390)
   - "returns default state when no agent running" (lines 407-408)

3. Remove the `headWritten` property from `MockServerResponse` interface (line 179) and getter (lines 215-217).

4. Remove the "OPTIONS on /api/deploy also returns CORS headers" test (lines 940-951) — it's a subset of the `/api/state` OPTIONS test.

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 1 (the removed CORS test).

**Step 3: Commit**

Message: `refactor(tests): condense server tests, use shared mocks, remove redundancy`

---

### Task 5: Condense retry.test.ts with it.each

Replace 5 individual non-retryable status tests and 3 retryable status tests with `it.each`.

**Files:**
- Modify: `packages/agent/src/utils/__tests__/retry.test.ts`

**Step 1: Rewrite the status code tests**

Replace lines 37-115 with:

```typescript
  it.each([400, 401, 403, 404, 422])(
    "does not retry on non-retryable status (%i)",
    async (status) => {
      const err = Object.assign(new Error(`error ${status}`), { status });
      const fn = vi.fn().mockRejectedValue(err);
      await expect(
        withRetry(fn, { label: "test", maxRetries: 3, baseDelayMs: 1 }),
      ).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500, 503])(
    "retries on %i status",
    async (status) => {
      const err = Object.assign(new Error(`error ${status}`), { status });
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
      const result = await withRetry(fn, { label: "test", baseDelayMs: 1 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    },
  );
```

Keep all other tests unchanged.

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 6 (8 individual tests become 2 `it.each` blocks).

**Step 3: Commit**

Message: `refactor(tests): condense retry status code tests with it.each`

---

### Task 6: Condense compiler.test.ts — remove duplicate schema tests

Remove the entire `describe("compileIntent (mocked LLM)", ...)` block (lines 101-176) which duplicates `venice/schemas.test.ts`. Import shared `makeIntent` fixture.

**Files:**
- Modify: `packages/agent/src/delegation/__tests__/compiler.test.ts`

**Step 1: Apply changes**

1. Replace the local `makeIntent` function (lines 17-27) with:
   ```typescript
   import { makeIntent } from "../../__tests__/fixtures.js";
   ```

2. Delete the entire `describe("compileIntent (mocked LLM)", ...)` block (lines 100-176).

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 5.

**Step 3: Commit**

Message: `refactor(tests): remove duplicate schema validation tests from compiler`

---

### Task 7: Condense audit.test.ts — use shared fixtures

Replace local `makeSampleIntent` and `makeSampleDelegation` with shared imports.

**Files:**
- Modify: `packages/agent/src/delegation/__tests__/audit.test.ts`

**Step 1: Apply changes**

1. Replace lines 13-43 (the two local helper functions) with:
   ```typescript
   import { makeIntent as makeSampleIntent, makeSampleDelegation } from "../../__tests__/fixtures.js";
   ```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: 242 tests pass (minus any previous reductions), no test removed — just DRYer.

**Step 3: Commit**

Message: `refactor(tests): use shared fixtures in audit tests`

---

### Task 8: Condense erc8004.test.ts — it.each for scaling

Collapse the 3 individual scaling tests into one `it.each`.

**Files:**
- Modify: `packages/agent/src/identity/__tests__/erc8004.test.ts`

**Step 1: Apply changes**

Replace the three tests "scales value correctly for integer input" (lines 97-105), "scales value correctly for negative input" (lines 107-115), and "handles fractional values with rounding" (lines 149-158) with one `it.each`:

```typescript
  it.each([
    [3, 300n, "integer"],
    [-2.5, -250n, "negative"],
    [4.555, 456n, "fractional with rounding"],
  ] as const)(
    "scales value %f to %s (%s)",
    async (input, expected, _label) => {
      mockWriteContract.mockResolvedValue("0xhash" as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
      await giveFeedback(1n, input, "tag");
      const args = mockWriteContract.mock.calls[0][0].args;
      expect(args[1]).toBe(expected);
    },
  );
```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 2.

**Step 3: Commit**

Message: `refactor(tests): condense erc8004 scaling tests with it.each`

---

### Task 9: Condense permit2.test.ts — remove subset tests

Remove "sends approval tx when allowance is zero" (subset of low-allowance test) and the two subset `signPermit2Data` tests.

**Files:**
- Modify: `packages/agent/src/uniswap/__tests__/permit2.test.ts`

**Step 1: Apply changes**

1. Delete "sends approval tx when allowance is zero" test (lines 142-158).
2. Delete "returns the hex signature from signTypedData" test (lines 224-238) — already covered by first `signPermit2Data` test.
3. Delete "uses walletClient.account for signing" test (lines 240-255) — already covered by first `signPermit2Data` test.

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 3.

**Step 3: Commit**

Message: `refactor(tests): remove subset permit2 tests`

---

### Task 10: Condense redeemer.test.ts — shared factory

Extract repeated `RedeemParams` construction into a local factory.

**Files:**
- Modify: `packages/agent/src/delegation/__tests__/redeemer.test.ts`

**Step 1: Apply changes**

Add this factory inside `describe("redeemDelegation", ...)`, after the existing `mockDelegation`, `mockSmartAccount`, and `chain` declarations (around line 224):

```typescript
  function makeRedeemParams(
    callOverrides: Partial<RedeemParams["call"]> = {},
  ): RedeemParams {
    return {
      delegation: mockDelegation,
      delegatorSmartAccount: mockSmartAccount,
      call: { to: "0xTargetContract" as Hex, ...callOverrides },
    };
  }
```

Then replace every manually constructed `params: RedeemParams = { ... }` in that describe block with `const params = makeRedeemParams(...)`:

- Line 228-235: `const params = makeRedeemParams({ data: "0xCalldata" as Hex, value: 100n });`
- Line 248-254: `const params = makeRedeemParams({ data: "0xCalldata" as Hex, value: 100n });`
- Line 268-272: `const params = makeRedeemParams();`
- Line 287-291: `const params = makeRedeemParams();`
- Line 304-308: `const params = makeRedeemParams();`
- Line 323-328: `const params = makeRedeemParams({ value: 1000000000000000n });`

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Same test count — just DRYer.

**Step 3: Commit**

Message: `refactor(tests): extract redeemParams factory in redeemer tests`

---

### Task 11: Condense thegraph.test.ts and portfolio.test.ts — remove subset tests

Remove tests that are strict subsets of other tests.

**Files:**
- Modify: `packages/agent/src/data/__tests__/thegraph.test.ts`
- Modify: `packages/agent/src/data/__tests__/portfolio.test.ts`

**Step 1: Apply changes**

1. In `thegraph.test.ts`: delete "returns correct PoolData type shape" test (lines 151-173) — subset of test 1.
2. In `portfolio.test.ts`: delete "should include drift and maxDrift fields" test (lines 91-99) — subset of test 2 (zero balances).

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 2.

**Step 3: Commit**

Message: `refactor(tests): remove subset tests in thegraph and portfolio`

---

### Task 12: Condense constants.test.ts — remove redundant type checks

**Files:**
- Modify: `packages/common/src/__tests__/constants.test.ts`

**Step 1: Apply changes**

1. Delete "starts with 0x and is 42 characters" test (lines 12-14) — the exact value test on line 9 already proves this.
2. Delete "is a number" test (lines 22-24) — `.toBe(3147)` already proves the type.

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by 2.

**Step 3: Commit**

Message: `refactor(tests): remove redundant type assertions in constants tests`

---

### Task 13: Condense tokens.test.ts — remove TOKEN_META block, use describe.each

**Files:**
- Modify: `packages/common/src/__tests__/tokens.test.ts`

**Step 1: Apply changes**

1. Delete the entire `describe("TOKEN_META", ...)` block (lines 17-38) — the getter tests already prove the map contents.

2. Replace the three separate `getTokenBg`, `getTokenLabelColor`, and `getTokenLabel` describe blocks (lines 44-109) with:

```typescript
describe.each([
  ["getTokenBg", getTokenBg, { ETH: "bg-emerald-500", USDC: "bg-indigo-500" }, "bg-zinc-500"],
  ["getTokenLabelColor", getTokenLabelColor, { ETH: "text-emerald-400", USDC: "text-indigo-400" }, "text-zinc-400"],
] as const)("%s", (_name, fn, expected, fallback) => {
  it("returns correct value for ETH", () => {
    expect(fn("ETH")).toBe(expected.ETH);
  });

  it("returns correct value for USDC", () => {
    expect(fn("USDC")).toBe(expected.USDC);
  });

  it("normalizes to uppercase", () => {
    expect(fn("eth")).toBe(expected.ETH);
  });

  it("returns fallback for unknown token", () => {
    expect(fn("DOGE")).toBe(fallback);
    expect(fn("")).toBe(fallback);
  });
});

describe("getTokenLabel", () => {
  it("returns label for known token", () => {
    expect(getTokenLabel("ETH")).toBe("ETH");
    expect(getTokenLabel("WETH")).toBe("WETH");
    expect(getTokenLabel("USDC")).toBe("USDC");
  });

  it("normalizes to uppercase", () => {
    expect(getTokenLabel("eth")).toBe("ETH");
    expect(getTokenLabel("weth")).toBe("WETH");
  });

  it("returns the input uppercased for unknown token", () => {
    expect(getTokenLabel("doge")).toBe("DOGE");
    expect(getTokenLabel("SHIB")).toBe("SHIB");
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by ~5 (TOKEN_META block removed, getters consolidated).

**Step 3: Commit**

Message: `refactor(tests): condense token tests, remove redundant TOKEN_META block`

---

### Task 14: Condense format.test.ts — describe.each for truncate, it.each for pure functions, beforeEach for timers

**Files:**
- Modify: `packages/common/src/__tests__/format.test.ts`

**Step 1: Apply changes**

1. Replace the two separate `truncateAddress` and `truncateHash` describe blocks (lines 18-62) with:

```typescript
describe.each([
  ["truncateAddress", truncateAddress],
  ["truncateHash", truncateHash],
] as const)("%s", (_name, fn) => {
  it("truncates long strings", () => {
    expect(fn("0xf13021F02E23a8113C1bD826575a1682F6Fac927")).toMatch(/^0x.{4}\.\.\..{4}$/);
  });

  it("returns short strings unchanged", () => {
    expect(fn("0xabc")).toBe("0xabc");
  });

  it("returns 11-char strings unchanged (below threshold)", () => {
    expect(fn("0x123456789")).toBe("0x123456789");
  });

  it("truncates 12-char strings (at threshold)", () => {
    const result = fn("0x12345678ab");
    expect(result).toMatch(/^.{6}\.\.\..{4}$/);
  });
});
```

2. Replace `formatCurrency` describe (lines 68-88) with:

```typescript
describe("formatCurrency", () => {
  it.each([
    [0, "$0.00"],
    [1000, "$1,000.00"],
    [150.5, "$150.50"],
    [99.999, "$100.00"],
    [1234567.89, "$1,234,567.89"],
  ] as const)("formats %f as %s", (input, expected) => {
    expect(formatCurrency(input)).toBe(expected);
  });
});
```

3. Replace `formatTimestamp` describe (lines 94-150) with:

```typescript
describe("formatTimestamp", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["2026-03-15T12:00:25.000Z", "2026-03-15T12:00:30.000Z", "5s ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:03:00.000Z", "3m ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T14:00:00.000Z", "2h ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-16T12:00:00.000Z", "1d ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:00:00.000Z", "0s ago"],
    ["2026-03-15T12:00:00.000Z", "2026-03-15T12:00:59.000Z", "59s ago"],
  ] as const)("formats %s relative to %s as '%s'", (timestamp, now, expected) => {
    vi.setSystemTime(new Date(now));
    expect(formatTimestamp(timestamp)).toBe(expected);
  });

  it("shows date for timestamps older than 7 days", () => {
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));
    const result = formatTimestamp("2026-03-15T12:00:00.000Z");
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });
});
```

4. Replace `formatPercentage` describe (lines 156-180) with:

```typescript
describe("formatPercentage", () => {
  it.each([
    [0.05, undefined, "5.0%"],
    [0, undefined, "0.0%"],
    [1, undefined, "100.0%"],
    [0.1234, 2, "12.34%"],
    [1.5, undefined, "150.0%"],
    [0.005, undefined, "0.5%"],
  ] as const)("formats %f with decimals=%s as %s", (value, decimals, expected) => {
    expect(formatPercentage(value, decimals)).toBe(expected);
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Test count drops by ~10 (many individual tests collapsed into `it.each`).

**Step 3: Commit**

Message: `refactor(tests): condense format tests with describe.each and it.each`

---

### Task 15: Condense trading.test.ts — shared request fixture

Extract the repeated `checkApproval` params into a shared fixture at the top of the describe block.

**Files:**
- Modify: `packages/agent/src/uniswap/__tests__/trading.test.ts`

**Step 1: Apply changes**

Inside `describe("Uniswap Trading API", ...)`, after `beforeEach`, add:

```typescript
  const defaultApprovalParams = {
    token: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    amount: "1000",
    chainId: 1,
    walletAddress: "0xwallet0000000000000000000000000000000000" as Address,
  };
```

Then replace the 4 inline constructions in `checkApproval` tests:

- Test 1 (line 48-52): `checkApproval({ ...defaultApprovalParams, amount: "1000000", chainId: 11155111 })`
- Test 2 (line 78-83): `checkApproval(defaultApprovalParams)`
- Test 3 (line 94-99): `checkApproval(defaultApprovalParams)`
- Test 4 (line 118-123): `checkApproval(defaultApprovalParams)`

**Step 2: Run tests**

Run: `pnpm test:unit`
Expected: Tests pass. Same test count — just DRYer.

**Step 3: Commit**

Message: `refactor(tests): extract shared approval fixture in trading tests`

---

## Verification

After all tasks are complete:

1. Run `pnpm test:unit` — all tests pass
2. Run `wc -l` on all 22 test files + the 2 new shared files — confirm ~4,500 lines (down from 5,088)
3. Run `pnpm run lint` — no lint errors
4. Run `pnpm run build` — builds clean

---

## Risk Notes

- **`vi.mock` hoisting:** Vitest hoists `vi.mock()` calls to the top of the file regardless of where they appear. Extracting them into a function call (`mockAgentDeps()`) works because the function itself contains `vi.mock()` calls that get hoisted when the function is invoked at the top level. If tests fail after Task 3 or 4, the fallback is to keep inline mocks but deduplicate by importing shared config objects.
- **`it.each` display names:** Vitest's `it.each` interpolates `%s`, `%i`, `%f` into test names. BigInt values render oddly with `%s` — use `%f` or a label column instead.
- **`describe.each` type inference:** Use `as const` on the array to preserve tuple types for the callback parameters.
