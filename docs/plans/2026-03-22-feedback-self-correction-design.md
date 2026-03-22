# Feedback Self-Correction Loop — Design & Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the feedback loop so judge scores from past swaps are fed into the Venice rebalance prompt, enabling the agent to self-correct.

**Architecture:** After each swap is judged, persist scores + reasoning to a new `swap_scores` SQLite table. Before each rebalance decision, query the last 5 scores and inject a "PAST PERFORMANCE FEEDBACK" section into the Venice system prompt. The LLM reads its own report card and adjusts behavior.

**Tech Stack:** SQLite (drizzle-orm), Venice LLM (LangChain structured output), Vitest

---

## Design

### Problem

The agent's ERC-8004 judge evaluates every swap and produces per-dimension scores (decision-quality, execution-quality, goal-progress) with textual reasoning. These are submitted on-chain via the Validation and Reputation registries. However, the agent never reads them back. The rebalance decision prompt sent to Venice is stateless — it only sees current portfolio state, drift, and constraints. The demo claims feedback drives self-correction, but it doesn't.

### Design Decisions

- **Dual storage (local + on-chain):** Write scores to SQLite for fast local queries. On-chain submission already exists and remains the source of truth for external verification.
- **Window size: 5 swaps.** Enough to detect trends without bloating the prompt. For a 7-day intent doing ~1 trade/day, this is roughly the full history.
- **Scores + judge reasoning in prompt.** The judge already generates natural-language critiques explaining why scores are low. Including both numbers and text gives Venice enough signal to self-correct without hard-coding correction rules.
- **Prompt-only influence.** No mechanical parameter adjustment (e.g., auto-reducing trade size on low scores). Trust the LLM to interpret feedback and adjust. Simpler, fewer moving parts, appropriate for hackathon scope.

### Data Flow

```
Swap completes
  -> Judge evaluates (Venice LLM) -> JudgeResult { scores, reasonings, composite }
  -> Write to swap_scores table (new)
  -> Submit on-chain (existing, unchanged)
  ...
Next cycle:
  -> Drift exceeds threshold
  -> Query last 5 swap_scores for this intent (new)
  -> Format as "PAST PERFORMANCE FEEDBACK" section (new)
  -> Append to Venice system prompt (new)
  -> Venice reads its report card and adjusts behavior
```

### What Stays Unchanged

- On-chain submission pipeline (Validation Registry, Reputation Registry)
- Judge evaluation logic and prompts
- Evidence storage and content-addressed hashing
- `evaluateSwap()` / `evaluateSwapFailure()` function signatures
- Dashboard display of judge results

---

## Implementation Plan

### Task 1: Add `swap_scores` table to schema and connection

**Files:**
- Modify: `packages/agent/src/db/schema.ts:46` (after `agentLogs` table)
- Modify: `packages/agent/src/db/connection.ts:55-58` (before closing backtick of `CREATE_TABLES_SQL`)
- Modify: `packages/agent/src/db/index.ts:8` (add new exports)

**Step 1: Add drizzle schema definition**

In `packages/agent/src/db/schema.ts`, add after the `agentLogs` table (after line 62):

```typescript
export const swapScores = sqliteTable("swap_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  intentId: text("intent_id")
    .notNull()
    .references(() => intents.id),
  swapId: integer("swap_id").references(() => swaps.id),
  cycle: integer("cycle").notNull(),
  composite: real("composite").notNull(),
  decisionScore: integer("decision_score").notNull(),
  decisionReasoning: text("decision_reasoning").notNull(),
  executionScore: integer("execution_score").notNull(),
  executionReasoning: text("execution_reasoning").notNull(),
  goalScore: integer("goal_score").notNull(),
  goalReasoning: text("goal_reasoning").notNull(),
  outcome: text("outcome").notNull().default("success"),
  createdAt: text("created_at").notNull(),
});
```

**Step 2: Add CREATE TABLE SQL**

In `packages/agent/src/db/connection.ts`, add to `CREATE_TABLES_SQL` after the `agent_logs` index (before the closing backtick on line 58):

```sql
  CREATE TABLE IF NOT EXISTS swap_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    swap_id INTEGER REFERENCES swaps(id),
    cycle INTEGER NOT NULL,
    composite REAL NOT NULL,
    decision_score INTEGER NOT NULL,
    decision_reasoning TEXT NOT NULL,
    execution_score INTEGER NOT NULL,
    execution_reasoning TEXT NOT NULL,
    goal_score INTEGER NOT NULL,
    goal_reasoning TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'success',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_swap_scores_intent
    ON swap_scores(intent_id, cycle DESC);
```

**Step 3: Add new type exports**

In `packages/agent/src/db/index.ts`, add `SwapScoreInsert` and `SwapScoreSelect` to the repository exports.

**Step 4: Commit**

```
git add packages/agent/src/db/schema.ts packages/agent/src/db/connection.ts packages/agent/src/db/index.ts
git commit -m "feat: add swap_scores table schema and SQL"
```

---

### Task 2: Add repository methods + tests (TDD)

**Files:**
- Modify: `packages/agent/src/db/repository.ts:164` (add methods at end of class)
- Modify: `packages/agent/src/db/__tests__/repository.test.ts:471` (add test describe block)

**Step 1: Write failing tests**

Add to `packages/agent/src/db/__tests__/repository.test.ts`, inside the outer `describe("IntentRepository")` block but after the `getMaxLogSequence` describe. The test file's `CREATE_TABLES_SQL` must also be updated to include the new `swap_scores` table.

First, update `CREATE_TABLES_SQL` in the test file (after the `agent_logs` table):

```sql
  CREATE TABLE swap_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    swap_id INTEGER REFERENCES swaps(id),
    cycle INTEGER NOT NULL,
    composite REAL NOT NULL,
    decision_score INTEGER NOT NULL,
    decision_reasoning TEXT NOT NULL,
    execution_score INTEGER NOT NULL,
    execution_reasoning TEXT NOT NULL,
    goal_score INTEGER NOT NULL,
    goal_reasoning TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'success',
    created_at TEXT NOT NULL
  );
```

Then add the test block:

```typescript
  describe("swap_scores", () => {
    const SAMPLE_SCORE = {
      intentId: "test-intent-1",
      cycle: 1,
      composite: 75.5,
      decisionScore: 80,
      decisionReasoning: "Good trade direction.",
      executionScore: 65,
      executionReasoning: "Slippage was high.",
      goalScore: 78,
      goalReasoning: "Drift reduced meaningfully.",
      outcome: "success",
      createdAt: "2026-03-22T12:00:00Z",
    };

    it("inserts and retrieves a swap score", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.insertSwapScore(SAMPLE_SCORE);
      const scores = repo.getRecentScores("test-intent-1");
      expect(scores).toHaveLength(1);
      expect(scores[0].composite).toBeCloseTo(75.5);
      expect(scores[0].decisionScore).toBe(80);
      expect(scores[0].executionReasoning).toBe("Slippage was high.");
    });

    it("returns scores ordered by cycle descending", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.insertSwapScore({ ...SAMPLE_SCORE, cycle: 1, composite: 70 });
      repo.insertSwapScore({ ...SAMPLE_SCORE, cycle: 3, composite: 85 });
      repo.insertSwapScore({ ...SAMPLE_SCORE, cycle: 2, composite: 60 });
      const scores = repo.getRecentScores("test-intent-1");
      expect(scores).toHaveLength(3);
      expect(scores[0].cycle).toBe(3);
      expect(scores[1].cycle).toBe(2);
      expect(scores[2].cycle).toBe(1);
    });

    it("respects limit parameter (default 5)", () => {
      repo.createIntent(SAMPLE_INTENT);
      for (let i = 1; i <= 8; i++) {
        repo.insertSwapScore({ ...SAMPLE_SCORE, cycle: i, composite: 70 + i });
      }
      const defaultLimit = repo.getRecentScores("test-intent-1");
      expect(defaultLimit).toHaveLength(5);
      expect(defaultLimit[0].cycle).toBe(8);

      const custom = repo.getRecentScores("test-intent-1", 3);
      expect(custom).toHaveLength(3);
    });

    it("returns empty array when no scores exist", () => {
      repo.createIntent(SAMPLE_INTENT);
      expect(repo.getRecentScores("test-intent-1")).toEqual([]);
    });

    it("scopes scores to the requested intent", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({ ...SAMPLE_INTENT, id: "other" });
      repo.insertSwapScore(SAMPLE_SCORE);
      repo.insertSwapScore({ ...SAMPLE_SCORE, intentId: "other", cycle: 2 });
      expect(repo.getRecentScores("test-intent-1")).toHaveLength(1);
      expect(repo.getRecentScores("other")).toHaveLength(1);
    });

    it("stores outcome field for failed swaps", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.insertSwapScore({ ...SAMPLE_SCORE, outcome: "failed" });
      const scores = repo.getRecentScores("test-intent-1");
      expect(scores[0].outcome).toBe("failed");
    });

    it("links to swap via swapId when provided", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.insertSwap({
        intentId: "test-intent-1",
        txHash: "0xabc",
        sellToken: "ETH",
        buyToken: "USDC",
        sellAmount: "0.1",
        status: "confirmed",
        timestamp: new Date().toISOString(),
      });
      const swaps = repo.getSwapsByIntent("test-intent-1");
      repo.insertSwapScore({ ...SAMPLE_SCORE, swapId: swaps[0].id });
      const scores = repo.getRecentScores("test-intent-1");
      expect(scores[0].swapId).toBe(swaps[0].id);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run src/db/__tests__/repository.test.ts`
Expected: FAIL — `insertSwapScore` and `getRecentScores` are not defined on `IntentRepository`.

**Step 3: Implement repository methods**

In `packages/agent/src/db/repository.ts`, add the import for `swapScores` in the existing import line, add new types, and add methods to `IntentRepository`:

Add to imports (line 4):
```typescript
import { intents, swaps, nonces, agentLogs, swapScores } from "./schema.js";
```

Add types after existing type aliases (after line 12):
```typescript
type SwapScoreInsert = Omit<typeof swapScores.$inferInsert, "id">;
type SwapScoreSelect = typeof swapScores.$inferSelect;
```

Add to the `export type` line (line 14):
```typescript
export type { IntentInsert, IntentSelect, SwapInsert, SwapSelect, NonceSelect, AgentLogInsert, AgentLogSelect, SwapScoreInsert, SwapScoreSelect };
```

Add methods at the end of the `IntentRepository` class (before the closing `}`):
```typescript
  // Swap scores (judge feedback)

  insertSwapScore(data: SwapScoreInsert): void {
    this.db.insert(swapScores).values(data).run();
  }

  getRecentScores(intentId: string, limit: number = 5): SwapScoreSelect[] {
    return this.db
      .select()
      .from(swapScores)
      .where(eq(swapScores.intentId, intentId))
      .orderBy(desc(swapScores.cycle))
      .limit(limit)
      .all();
  }
```

Add `desc` to the drizzle-orm import (line 1):
```typescript
import { eq, and, gt, lte, max, desc } from "drizzle-orm";
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run src/db/__tests__/repository.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```
git add packages/agent/src/db/repository.ts packages/agent/src/db/__tests__/repository.test.ts
git commit -m "feat: add insertSwapScore and getRecentScores repository methods"
```

---

### Task 3: Thread repository into AgentConfig and worker

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:42-72` (AgentConfig interface)
- Modify: `packages/agent/src/agent-worker.ts:101-123` (config construction)

**Step 1: Add `repo` to `AgentConfig`**

In `packages/agent/src/agent-loop/index.ts`, add to the `AgentConfig` interface (after `existingAgentId` field, around line 63):

```typescript
  /** Repository for reading/writing swap scores (feedback loop) */
  repo?: import("../db/repository.js").IntentRepository;
```

**Step 2: Pass `repo` in `DefaultAgentWorker`**

In `packages/agent/src/agent-worker.ts`, add `repo: this.deps.repo` to the config object (inside the config construction block around line 101-123, after `initialTotalSpentUsd`):

```typescript
      repo: this.deps.repo,
```

**Step 3: Commit**

```
git add packages/agent/src/agent-loop/index.ts packages/agent/src/agent-worker.ts
git commit -m "feat: thread repository into AgentConfig for feedback loop"
```

---

### Task 4: Write swap scores after judge evaluation

**Files:**
- Modify: `packages/agent/src/agent-loop/swap.ts:460-492` (after evaluateSwap returns)
- Modify: `packages/agent/src/agent-loop/swap.ts:543-640` (after evaluateSwapFailure returns)

**Step 1: Persist scores after successful swap judge**

In `packages/agent/src/agent-loop/swap.ts`, after the `evaluateSwap()` call returns and the result is logged (after line 469 `state.lastCycleJudged = state.cycle;`), add:

```typescript
        // Persist judge scores to DB for feedback loop
        if (config.repo) {
          try {
            config.repo.insertSwapScore({
              intentId: config.intentId ?? "",
              cycle: currentCycle,
              composite: result.composite,
              decisionScore: result.scores["decision-quality"] ?? 0,
              decisionReasoning: result.reasonings["decision-quality"] ?? "",
              executionScore: result.scores["execution-quality"] ?? 0,
              executionReasoning: result.reasonings["execution-quality"] ?? "",
              goalScore: result.scores["goal-progress"] ?? 0,
              goalReasoning: result.reasonings["goal-progress"] ?? "",
              outcome: "success",
              createdAt: new Date().toISOString(),
            });
          } catch (err) {
            logger.warn({ err }, "Failed to persist swap score to DB");
          }
        }
```

**Step 2: Persist scores after failed swap judge**

In the same file, after `evaluateSwapFailure()` returns and its result is logged (look for the equivalent `state.lastCycleJudged = state.cycle;` in the failure path), add the same block but with `outcome: "failed"`:

```typescript
        // Persist judge scores to DB for feedback loop
        if (config.repo) {
          try {
            config.repo.insertSwapScore({
              intentId: config.intentId ?? "",
              cycle: state.cycle,
              composite: failureResult.composite,
              decisionScore: failureResult.scores["decision-quality"] ?? 0,
              decisionReasoning: failureResult.reasonings["decision-quality"] ?? "",
              executionScore: failureResult.scores["execution-quality"] ?? 0,
              executionReasoning: failureResult.reasonings["execution-quality"] ?? "",
              goalScore: failureResult.scores["goal-progress"] ?? 0,
              goalReasoning: failureResult.reasonings["goal-progress"] ?? "",
              outcome: "failed",
              createdAt: new Date().toISOString(),
            });
          } catch (err) {
            logger.warn({ err }, "Failed to persist failure swap score to DB");
          }
        }
```

**Step 3: Commit**

```
git add packages/agent/src/agent-loop/swap.ts
git commit -m "feat: persist judge scores to swap_scores table after evaluation"
```

---

### Task 5: Inject feedback into Venice rebalance prompt (TDD)

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:494-601` (getRebalanceDecision function)
- Modify: `packages/agent/src/__tests__/agent-loop.test.ts` (add feedback formatting tests)

**Step 1: Extract prompt building into a testable function**

To make the feedback formatting testable without invoking the LLM, extract a pure function. Add it before `getRebalanceDecision()` in `packages/agent/src/agent-loop/index.ts`:

```typescript
/**
 * Format recent judge scores into a prompt section for the Venice rebalance LLM.
 * Returns empty string if no scores exist (first cycle).
 * Exported for testing.
 */
export function formatFeedbackPrompt(
  scores: import("../db/repository.js").SwapScoreSelect[],
): string {
  if (scores.length === 0) return "";

  const entries = scores.map((s) => {
    const lines = [
      `Cycle ${s.cycle} (${s.outcome}) -- Composite: ${Math.round(s.composite)}/100`,
      `  Decision Quality (40% weight): ${s.decisionScore} -- "${s.decisionReasoning}"`,
      `  Execution Quality (30% weight): ${s.executionScore} -- "${s.executionReasoning}"`,
      `  Goal Progress (30% weight): ${s.goalScore} -- "${s.goalReasoning}"`,
    ];
    return lines.join("\n");
  });

  return `\nPAST PERFORMANCE FEEDBACK (from independent Venice judge):\n\n${entries.join("\n\n")}\n\nUse this feedback to improve your decisions. If execution quality is consistently low, prefer smaller trade sizes for better fills. If goal progress is low, reconsider trade direction.`;
}
```

**Step 2: Write failing tests**

Add to `packages/agent/src/__tests__/agent-loop.test.ts`, importing the new function:

Update the import line to include `formatFeedbackPrompt`:
```typescript
import { calculateDrift, resolveTokenAddress, formatFeedbackPrompt } from "../agent-loop/index.js";
```

Add a new describe block:

```typescript
describe("Agent Loop - formatFeedbackPrompt", () => {
  it("returns empty string when no scores exist", () => {
    expect(formatFeedbackPrompt([])).toBe("");
  });

  it("formats a single score entry", () => {
    const scores = [{
      id: 1,
      intentId: "test",
      swapId: null,
      cycle: 3,
      composite: 75.5,
      decisionScore: 80,
      decisionReasoning: "Good direction.",
      executionScore: 65,
      executionReasoning: "High slippage.",
      goalScore: 78,
      goalReasoning: "Drift reduced.",
      outcome: "success",
      createdAt: "2026-03-22T12:00:00Z",
    }];
    const result = formatFeedbackPrompt(scores);
    expect(result).toContain("PAST PERFORMANCE FEEDBACK");
    expect(result).toContain("Cycle 3 (success) -- Composite: 76/100");
    expect(result).toContain('Decision Quality (40% weight): 80 -- "Good direction."');
    expect(result).toContain('Execution Quality (30% weight): 65 -- "High slippage."');
    expect(result).toContain('Goal Progress (30% weight): 78 -- "Drift reduced."');
    expect(result).toContain("Use this feedback to improve");
  });

  it("formats multiple scores in order", () => {
    const scores = [
      {
        id: 2, intentId: "test", swapId: null, cycle: 5, composite: 85,
        decisionScore: 90, decisionReasoning: "Excellent.",
        executionScore: 80, executionReasoning: "Clean.",
        goalScore: 85, goalReasoning: "On target.",
        outcome: "success", createdAt: "2026-03-22T13:00:00Z",
      },
      {
        id: 1, intentId: "test", swapId: null, cycle: 4, composite: 40,
        decisionScore: 50, decisionReasoning: "Questionable.",
        executionScore: 0, executionReasoning: "Failed.",
        goalScore: 0, goalReasoning: "No progress.",
        outcome: "failed", createdAt: "2026-03-22T12:00:00Z",
      },
    ];
    const result = formatFeedbackPrompt(scores);
    const cycle5Pos = result.indexOf("Cycle 5");
    const cycle4Pos = result.indexOf("Cycle 4");
    expect(cycle5Pos).toBeLessThan(cycle4Pos);
    expect(result).toContain("Cycle 4 (failed)");
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run src/__tests__/agent-loop.test.ts`
Expected: FAIL — `formatFeedbackPrompt` is not exported.

**Step 4: Implement `formatFeedbackPrompt` and inject into prompt**

Add the `formatFeedbackPrompt` function as shown in Step 1.

Then modify `getRebalanceDecision()` to query scores and inject them. At the start of the function (after line 500 `logger.info(...)`), add:

```typescript
  // Query recent judge feedback for self-correction
  let feedbackSection = "";
  if (config.repo && config.intentId) {
    try {
      const recentScores = config.repo.getRecentScores(config.intentId, 5);
      feedbackSection = formatFeedbackPrompt(recentScores);
    } catch (err) {
      logger.warn({ err }, "Failed to query recent scores for feedback prompt");
    }
  }
```

Then inject `feedbackSection` into the system prompt. Replace the last line of the system prompt (line 542):

```
Size the trade to make meaningful progress on drift while staying well within these limits.`
```

with:

```
${feedbackSection}
Size the trade to make meaningful progress on drift while staying well within these limits.`
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run src/__tests__/agent-loop.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```
git add packages/agent/src/agent-loop/index.ts packages/agent/src/__tests__/agent-loop.test.ts
git commit -m "feat: inject judge feedback into Venice rebalance prompt"
```

---

### Task 6: Verify build and full test suite

**Step 1: Run type check**

Run: `cd packages/agent && pnpm tsc --noEmit`
Expected: No type errors.

**Step 2: Run unit tests**

Run: `pnpm test:unit`
Expected: ALL PASS

**Step 3: Run build**

Run: `turbo run build`
Expected: Build succeeds.

**Step 4: Run lint**

Run: `pnpm run lint`
Expected: No lint errors (or only pre-existing ones).

**Step 5: Final commit if any fixes needed**

```
git add -A
git commit -m "chore: fix any type/lint issues from feedback loop feature"
```

---

### Task 7: Update db/index.ts exports

**Files:**
- Modify: `packages/agent/src/db/index.ts`

**Step 1: Add new type exports**

Update the re-export line from `repository.js` to include the new types:

```typescript
export {
  IntentRepository,
  type IntentInsert,
  type IntentSelect,
  type SwapInsert,
  type SwapSelect,
  type NonceSelect,
  type SwapScoreInsert,
  type SwapScoreSelect,
} from "./repository.js";
```

**Step 2: Commit**

```
git add packages/agent/src/db/index.ts
git commit -m "chore: export SwapScoreInsert and SwapScoreSelect types"
```
