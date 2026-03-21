# Judge Prompts, Sponsor Chips, Identity Link, Rebalance Prompt, Identity Guard

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework judge evaluation prompts to evaluate constraint fidelity (not strategy quality), add sponsor brand chips throughout the dashboard, make ERC-8004 identity a clickable explorer link, tighten rebalance LLM prompt with hard rules, and guard the agent loop from running without an on-chain identity.

**Architecture:** Five independent changes touching the agent backend (judge prompts, rebalance prompt, identity guard) and the dashboard frontend (sponsor chips, identity link). The judge prompt rework also requires plumbing `agentReasoning` from the rebalance decision through to swap evidence. Sponsor chips replace the existing `SponsorBadge` component with a new `SponsorChip` that includes brand logos.

**Tech Stack:** TypeScript, Vitest, Next.js (React), Tailwind CSS, Venice LLM structured output, ERC-8004 on Base Sepolia, Playwright (e2e tests)

---

### Task 1: Rewrite judge system prompts

**Files:**
- Modify: `packages/agent/src/identity/judge.ts:35-64`
- Test: `packages/agent/src/identity/__tests__/judge.test.ts`

**Step 1: Update the test expectations**

In `packages/agent/src/identity/__tests__/judge.test.ts`, update the test at line 40 that checks for `"independent validator"`. The new prompt still contains this phrase, so it should still pass. But add a new assertion that the prompt contains the constraint-fidelity framing:

```typescript
// In the "buildJudgePrompt includes all dimension criteria" test, add:
expect(systemPrompt).toContain("faithfully executed within the user's delegated constraints");
expect(systemPrompt).not.toContain("made good decisions");
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run src/identity/__tests__/judge.test.ts`
Expected: FAIL — current prompt contains "made good decisions" and lacks "faithfully executed"

**Step 3: Rewrite JUDGE_SYSTEM_PROMPT and JUDGE_FAILURE_SYSTEM_PROMPT**

In `packages/agent/src/identity/judge.ts`, replace lines 35-64:

```typescript
const JUDGE_SYSTEM_PROMPT = `You are an independent validator auditing an autonomous DeFi agent that operates under a user-defined delegation. The user chose the strategy (target allocation, budget, trade limits). The agent's job is to execute faithfully within the user's delegated constraints — not to second-guess the strategy itself.

You receive structured evidence about a swap the agent executed. Your job: determine whether the agent faithfully executed within the user's delegated constraints and whether the execution was technically sound.

For each dimension, provide:
1. A score from 0-100
2. Your reasoning, citing specific numbers from the evidence

Calibration — what scores mean:
  90-100: Exceptional. The agent operated well within all constraints and handled complexity optimally.
  70-89:  Good. Constraints respected, execution sound, minor room for improvement.
  50-69:  Adequate. Constraints respected but execution was suboptimal.
  30-49:  Questionable. A constraint was nearly violated, or execution was poor.
  0-29:   Poor. A constraint was violated, or the action was clearly irrational given the delegation.

Most routine swaps that respect all constraints should score 70-85. Reserve extreme scores for genuine constraint violations or genuinely exceptional handling of edge cases.`;

const JUDGE_FAILURE_SYSTEM_PROMPT = `You are an independent validator auditing an autonomous DeFi agent. The agent attempted a swap that FAILED. You receive structured evidence about the failed attempt. Your job: determine whether the agent's decision to attempt this swap was justified given the user's delegated constraints, and how the failure affects its track record.

For each dimension, provide:
1. A score from 0-100
2. Your reasoning, citing specific numbers from the evidence

Calibration for failed swaps:
  Execution Quality: Always 0 — the swap failed, no execution occurred.
  Goal Progress: Always 0 — portfolio unchanged, no progress made.
  Decision Quality: Judge independently — was the attempt reasonable given the constraints?
    70-89: Decision respected all constraints; failure was due to external factors (network, liquidity).
    40-69: Decision was borderline; agent should have anticipated the failure risk from available data.
    0-39:  Decision violated or nearly violated a constraint, or obvious signs the swap would fail were ignored.

The error message, agent reasoning, and constraint parameters in the evidence are critical inputs.`;
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run src/identity/__tests__/judge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/identity/judge.ts packages/agent/src/identity/__tests__/judge.test.ts
git commit -m "feat: rewrite judge system prompts to evaluate constraint fidelity"
```

---

### Task 2: Rewrite dimension criteria

**Files:**
- Modify: `packages/agent/src/identity/dimensions.ts:22-51`
- Test: `packages/agent/src/identity/__tests__/dimensions.test.ts`

**Step 1: Add test for new criteria content**

In `packages/agent/src/identity/__tests__/dimensions.test.ts`, add:

```typescript
it("decision-quality criteria references constraint adherence", () => {
  const dims = getDimensionsForIntent("rebalance");
  const decision = dims.find((d) => d.tag === "decision-quality")!;
  expect(decision.criteria).toContain("drift threshold");
  expect(decision.criteria).toContain("per-trade limit");
  expect(decision.criteria).not.toContain("gas efficiency");
});

it("execution-quality criteria does not penalize gas on small trades", () => {
  const dims = getDimensionsForIntent("rebalance");
  const execution = dims.find((d) => d.tag === "execution-quality")!;
  expect(execution.criteria).not.toContain("gas\nefficiency");
  expect(execution.criteria).toContain("slippage");
});

it("goal-progress criteria focuses on drift direction not magnitude", () => {
  const dims = getDimensionsForIntent("rebalance");
  const goal = dims.find((d) => d.tag === "goal-progress")!;
  expect(goal.criteria).toContain("correct direction");
  expect(goal.criteria).not.toContain("meaningfully");
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run src/identity/__tests__/dimensions.test.ts`
Expected: FAIL — current criteria don't contain these phrases

**Step 3: Rewrite UNIVERSAL_DIMENSIONS criteria**

In `packages/agent/src/identity/dimensions.ts`, replace lines 22-51:

```typescript
export const UNIVERSAL_DIMENSIONS: EvaluationDimension[] = [
  {
    tag: "decision-quality",
    name: "Decision Quality",
    criteria: `Did the agent's decision to trade respect the user's delegated constraints?
Consider: Was the portfolio drift above the user's configured drift threshold?
Was the proposed trade size within the daily budget and per-trade limit?
Did the agent's stated reasoning reference actual portfolio data?
Was the timing justified by drift urgency rather than trading for its own sake?
A trade that correctly identifies drift above threshold and sizes within limits scores well.`,
    weight: 0.4,
  },
  {
    tag: "execution-quality",
    name: "Execution Quality",
    criteria: `Was the trade technically well-executed within the user's constraints?
Consider: Was actual slippage within the user's configured maximum?
Was the delegation path used when available (preferred over direct tx)?
Did the swap complete successfully on-chain?
Do NOT penalize for gas costs relative to trade size — the user chose the trade size limits.
A successful swap with slippage under the max that used the delegation path scores well.`,
    weight: 0.3,
  },
  {
    tag: "goal-progress",
    name: "Goal Progress",
    criteria: `Did this trade move the portfolio in the correct direction toward the user's target allocation?
Consider: Was drift reduced (compare before vs after)?
Was the sell/buy token pair the right choice to reduce the largest drift?
Was portfolio value preserved through the transaction (no excessive loss)?
Any trade that reduces drift in the correct direction scores well, regardless of magnitude.
Do NOT penalize small trades — the user's per-trade limit determines trade size.`,
    weight: 0.3,
  },
];
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run src/identity/__tests__/dimensions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/identity/dimensions.ts packages/agent/src/identity/__tests__/dimensions.test.ts
git commit -m "feat: rewrite dimension criteria to focus on constraint adherence"
```

---

### Task 3: Plumb agentReasoning from rebalance decision to judge evidence

**Files:**
- Modify: `packages/agent/src/agent-loop/swap.ts:48-55,423,528`
- Modify: `packages/agent/src/agent-loop/index.ts:530-537`
- Test: `packages/agent/src/__tests__/swap-safety.test.ts`

**Step 1: Add reasoning parameter to executeSwap signature**

In `packages/agent/src/agent-loop/swap.ts`, change the function signature at line 48-55:

```typescript
export async function executeSwap(
  config: AgentConfig,
  state: AgentState,
  swap: { sellToken: string; buyToken: string; sellAmount: string; maxSlippage: string },
  agentAddress: Address,
  chain: typeof sepolia | typeof base,
  ethPriceUsd: number,
  agentReasoning: string = "",
): Promise<void> {
```

**Step 2: Replace the two hardcoded empty strings**

At line 423 (success path), change:
```typescript
        agentReasoning: "",
```
to:
```typescript
        agentReasoning,
```

At line 528 (failure path), change:
```typescript
        agentReasoning: "",
```
to:
```typescript
        agentReasoning,
```

**Step 3: Pass reasoning from runCycle**

In `packages/agent/src/agent-loop/index.ts`, at line 530-537, change:

```typescript
  await executeSwap(
    config,
    state,
    decision.targetSwap,
    agentAddress,
    chain,
    market.ethPrice.price,
    decision.reasoning,
  );
```

**Step 4: Update swap-safety tests**

In `packages/agent/src/__tests__/swap-safety.test.ts`, find all calls to `executeSwap(...)` and add the 7th argument `""` (empty string reasoning for test scenarios). The test calls should look like:

```typescript
await executeSwap(config, state, swap, agentAddress, sepolia, 2500, "test reasoning");
```

If there are multiple calls, update each. The tests don't verify reasoning content, just that safety checks still work.

**Step 5: Run tests**

Run: `cd packages/agent && pnpm vitest run src/__tests__/swap-safety.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/agent/src/agent-loop/swap.ts packages/agent/src/agent-loop/index.ts packages/agent/src/__tests__/swap-safety.test.ts
git commit -m "feat: plumb agentReasoning from rebalance decision to judge evidence"
```

---

### Task 4: Tighten rebalance decision prompt with hard rules

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:426-444`

**Step 1: Replace the vague prompt ending**

In `packages/agent/src/agent-loop/index.ts`, in the `getRebalanceDecision` function, replace the system prompt content (lines 426-444). The full replacement for the system message content:

```typescript
      content: `You are a DeFi portfolio rebalancing agent. Analyze the current portfolio state and decide if a rebalance is needed.

Current portfolio:
${JSON.stringify(market.portfolio.allocation, null, 2)}

Target allocation:
${JSON.stringify(config.intent.targetAllocation, null, 2)}

Current drift: ${JSON.stringify(market.drift, null, 2)} (max: ${(market.maxDrift * 100).toFixed(1)}%)
Drift threshold: ${(config.intent.driftThreshold * 100).toFixed(1)}%
ETH price: $${market.ethPrice.price.toFixed(2)}
${market.poolContext ? `\nLiquidity data:\n${market.poolContext}\n\nUse the TVL and volume data above to assess whether sufficient liquidity exists for the proposed swap size. If the swap amount is >1% of pool TVL, consider reducing the trade size or splitting across cycles.` : ""}
Daily budget: $${config.intent.dailyBudgetUsd}
Trades executed: ${state.tradesExecuted}
Total spent: $${state.totalSpentUsd.toFixed(2)} / $${(config.intent.dailyBudgetUsd * config.intent.timeWindowDays).toFixed(2)}
Max slippage: ${(config.intent.maxSlippage * 100).toFixed(2)}%

HARD RULES — violations will be rejected by the safety system:
1. The sellAmount MUST NOT exceed $${config.intent.maxPerTradeUsd > 0 ? config.intent.maxPerTradeUsd : config.intent.dailyBudgetUsd} in USD value (per-trade limit).
2. The sellAmount MUST NOT exceed $${(config.intent.dailyBudgetUsd * config.intent.timeWindowDays - state.totalSpentUsd).toFixed(2)} remaining total budget.
3. maxSlippage MUST NOT exceed ${(config.intent.maxSlippage * 100).toFixed(2)}%.
4. Only trade tokens in the target allocation: ${Object.keys(config.intent.targetAllocation).join(", ")}.
5. If shouldRebalance is true, targetSwap MUST be provided with valid sellAmount.

Size the trade to make meaningful progress on drift while staying well within these limits.`,
```

**Step 2: Run type check**

Run: `cd packages/agent && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/index.ts
git commit -m "feat: tighten rebalance prompt with hard constraint rules"
```

---

### Task 5: Guard agent loop — require ERC-8004 identity before main loop

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:200-202`

**Step 1: Add the identity guard**

In `packages/agent/src/agent-loop/index.ts`, after line 200 (the closing `}` of the registration block, just before `logger.info("=== VEIL AGENT STARTING ===")`), insert:

```typescript
  // HARD GATE: Do not enter the main loop without an on-chain identity.
  // Without an agentId, no judge evaluation can happen, and the agent
  // would trade without on-chain accountability.
  if (state.agentId == null) {
    const msg = "Cannot start agent: ERC-8004 identity registration failed. No agentId available.";
    logger.error(msg);
    state.deployError = msg;
    state.running = false;
    logAction("agent_halted", { error: msg });
    config.intentLogger?.log("agent_halted", { error: msg });
    return state;
  }
```

**Step 2: Run type check**

Run: `cd packages/agent && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop/index.ts
git commit -m "feat: require ERC-8004 identity before entering main loop"
```

---

### Task 6: Download sponsor brand assets

**Files:**
- Create: `apps/dashboard/public/sponsors/venice.svg`
- Create: `apps/dashboard/public/sponsors/metamask.svg`
- Create: `apps/dashboard/public/sponsors/uniswap.svg`
- Create: `apps/dashboard/public/sponsors/protocol-labs.svg`

**Step 1: Download brand logos**

Download SVG logos from the official brand kits:
- Venice.ai: Get the logomark from their site/brand kit
- MetaMask: Fox head logomark SVG
- Uniswap: Pink unicorn logomark SVG
- Protocol Labs: Logomark SVG

Save each as a small (16-24px target display) SVG in `apps/dashboard/public/sponsors/`.

If SVGs are not readily available as clean downloads, create minimal placeholder SVGs using brand colors:
- Venice: `#8B5CF6` (purple)
- MetaMask: `#F6851B` (orange)
- Uniswap: `#FF007A` (pink)
- Protocol Labs: `#00B3E6` (blue)

**Step 2: Commit**

```bash
git add apps/dashboard/public/sponsors/
git commit -m "feat: add sponsor brand logo assets"
```

---

### Task 7: Create SponsorChip component and replace SponsorBadge usages

**Files:**
- Create: `apps/dashboard/components/sponsor-chip.tsx`
- Modify: `apps/dashboard/components/configure.tsx:227,295`
- Modify: `apps/dashboard/components/audit.tsx:39,113`
- Modify: `apps/dashboard/components/activity-feed.tsx:46`
- Modify: `apps/dashboard/components/delegation-details.tsx:95`
- Modify: `apps/dashboard/components/monitor.tsx:349` (remove SponsorBadge, handled in Task 9)
- Modify: `apps/dashboard/components/footer.tsx:7` (fix "Venice" to "Venice.ai")

**Step 1: Create SponsorChip component**

Create `apps/dashboard/components/sponsor-chip.tsx`:

```typescript
/**
 * Inline sponsor chip with brand logo. Replaces SponsorBadge with
 * visual brand attribution. Used in section footers and feed entries.
 *
 * @module @maw/dashboard/components/sponsor-chip
 */
import Image from "next/image";

type Sponsor = "venice" | "metamask" | "uniswap" | "protocol-labs";

const SPONSOR_CONFIG: Record<Sponsor, { logo: string; alt: string }> = {
  venice: { logo: "/sponsors/venice.svg", alt: "Venice.ai" },
  metamask: { logo: "/sponsors/metamask.svg", alt: "MetaMask" },
  uniswap: { logo: "/sponsors/uniswap.svg", alt: "Uniswap" },
  "protocol-labs": { logo: "/sponsors/protocol-labs.svg", alt: "Protocol Labs" },
};

interface SponsorChipProps {
  sponsor: Sponsor;
  text: string;
  className?: string;
}

export function SponsorChip({ sponsor, text, className = "" }: SponsorChipProps) {
  const config = SPONSOR_CONFIG[sponsor];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-text-tertiary ${className}`}>
      <Image
        src={config.logo}
        alt={config.alt}
        width={14}
        height={14}
        className="opacity-60"
      />
      {text}
    </span>
  );
}

export type { Sponsor };
```

**Step 2: Replace all SponsorBadge usages**

In `apps/dashboard/components/configure.tsx`:
- Change import from `SponsorBadge` to `SponsorChip`
- Line 227: `<SponsorBadge text="Powered by Venice" />` → `<SponsorChip sponsor="venice" text="Powered by Venice.ai" />`
- Line 295: `<SponsorBadge text="Enforced by MetaMask Delegation" />` → `<SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />`

In `apps/dashboard/components/audit.tsx`:
- Change import from `SponsorBadge` to `SponsorChip`
- Line 39: `<SponsorBadge text="Powered by Venice" />` → `<SponsorChip sponsor="venice" text="Powered by Venice.ai" />`
- Line 113: `<SponsorBadge text="Enforced by MetaMask Delegation" />` → `<SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />`

In `apps/dashboard/components/activity-feed.tsx`:
- Change import from `SponsorBadge` to `SponsorChip`
- Line 46: `<SponsorBadge text="Powered by Venice" />` → `<SponsorChip sponsor="venice" text="Powered by Venice.ai" />`

In `apps/dashboard/components/delegation-details.tsx`:
- Change import from `SponsorBadge` to `SponsorChip`
- Line 95: `<SponsorBadge text="Secured by MetaMask ERC-7715 / ERC-7710" />` → `<SponsorChip sponsor="metamask" text="Secured by MetaMask ERC-7715 / ERC-7710" />`

In `apps/dashboard/components/monitor.tsx`:
- Remove the `SponsorBadge` import (the line 349 usage will be replaced in Task 9)
- Line 349: Remove `<SponsorBadge text="Identity via ERC-8004" />` entirely (will be replaced with identity link)

In `apps/dashboard/components/footer.tsx`:
- Line 7: Change `{ name: "Venice", url: "https://venice.ai" }` to `{ name: "Venice.ai", url: "https://venice.ai" }`

**Step 3: Run lint**

Run: `cd apps/dashboard && pnpm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/dashboard/components/sponsor-chip.tsx apps/dashboard/components/configure.tsx apps/dashboard/components/audit.tsx apps/dashboard/components/activity-feed.tsx apps/dashboard/components/delegation-details.tsx apps/dashboard/components/monitor.tsx apps/dashboard/components/footer.tsx
git commit -m "feat: replace SponsorBadge with SponsorChip (logo + text)"
```

---

### Task 8: Add SponsorChip to feed entries

**Files:**
- Modify: `apps/dashboard/components/feed-entry.tsx`

**Step 1: Add SponsorChip import**

At the top of `feed-entry.tsx`, add:
```typescript
import { SponsorChip } from "./sponsor-chip";
```

**Step 2: Add sponsor chips to relevant feed entry types**

For each entry type, add a `<SponsorChip>` after the entry label or in the entry's metadata area. The chip should appear inline, not on its own line. Add to these entries:

- `price_fetch` (line ~146): Add `<SponsorChip sponsor="venice" text="Venice.ai" className="ml-2" />` after the price display
- `rebalance_decision` (line ~230): Add `<SponsorChip sponsor="venice" text="Venice.ai" className="ml-2" />` after the decision label
- `swap_executed` (line ~278): Add `<SponsorChip sponsor="uniswap" text="Uniswap" className="ml-2" />` after the entry label
- `judge_started` (line ~324): Add `<SponsorChip sponsor="venice" text="Venice.ai" className="ml-2" />` after "Judge evaluation started"
- `judge_completed` (line ~336): Add `<SponsorChip sponsor="venice" text="Venice.ai" className="ml-2" />` near the composite score
- `delegation_created` (line ~300): Add `<SponsorChip sponsor="metamask" text="MetaMask" className="ml-2" />` after the entry label
- `erc8004_register` (line ~490): Add `<SponsorChip sponsor="protocol-labs" text="ERC-8004" className="ml-2" />` after the entry label

Keep chips small and unobtrusive — they're attribution, not decoration.

**Step 3: Run lint**

Run: `cd apps/dashboard && pnpm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/dashboard/components/feed-entry.tsx
git commit -m "feat: add sponsor chips to feed entry types"
```

---

### Task 9: ERC-8004 identity clickable link in monitor status bar

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx:332-351`

**Step 1: Extract agentId from liveState**

In `IntentDetailView`, after the `const parsed = ...` line (line 196), add:

```typescript
  const agentId = (data.liveState as Record<string, unknown> | null)?.agentId as string | undefined;
```

**Step 2: Replace the SponsorBadge in the status bar**

Replace the status bar's `<SponsorBadge text="Identity via ERC-8004" />` (line 349) with:

```typescript
        {agentId && (
          <a
            href={`https://sepolia.basescan.org/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/${agentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <SponsorChip sponsor="protocol-labs" text={`Agent #${agentId}`} />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        )}
```

Make sure to add the `SponsorChip` import if not already present (should be from Task 7):

```typescript
import { SponsorChip } from "./sponsor-chip";
```

And remove the wrapping `<span className="ml-auto hidden sm:inline-flex">` that previously contained the SponsorBadge — the `<a>` tag now handles that styling.

**Step 3: Run lint**

Run: `cd apps/dashboard && pnpm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/dashboard/components/monitor.tsx
git commit -m "feat: clickable ERC-8004 identity link in monitor status bar"
```

---

### Task 10: Update Playwright e2e test expectations

**Files:**
- Modify: `apps/dashboard/tests/configure.spec.ts:282`
- Modify: `apps/dashboard/tests/audit.spec.ts:109`

**Step 1: Update test strings**

In `apps/dashboard/tests/configure.spec.ts` line 282:
```typescript
    await expect(page.getByText("Powered by Venice.ai")).toBeVisible({ timeout: 5000 });
```

In `apps/dashboard/tests/audit.spec.ts` line 109:
```typescript
    await expect(page.getByText("Powered by Venice.ai")).toBeVisible();
```

**Step 2: Run Playwright tests**

Run: `cd apps/dashboard && pnpm test:e2e`
Expected: PASS (or failures unrelated to our changes — verify manually)

**Step 3: Commit**

```bash
git add apps/dashboard/tests/configure.spec.ts apps/dashboard/tests/audit.spec.ts
git commit -m "test: update e2e tests for Venice.ai sponsor text"
```

---

### Task 11: Delete obsolete SponsorBadge component

**Files:**
- Delete: `apps/dashboard/components/sponsor-badge.tsx`

**Step 1: Verify no remaining imports**

Run: `grep -r "sponsor-badge" apps/dashboard/components/ apps/dashboard/tests/`
Expected: No results (all imports were changed to `sponsor-chip` in Task 7-8)

If any remain, update them first.

**Step 2: Delete the file**

```bash
rm apps/dashboard/components/sponsor-badge.tsx
```

**Step 3: Run lint and type check**

Run: `cd apps/dashboard && pnpm run lint && pnpm tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -A apps/dashboard/components/sponsor-badge.tsx
git commit -m "chore: remove obsolete SponsorBadge component"
```

---

### Task 12: Final verification

**Step 1: Run all agent unit tests**

Run: `cd packages/agent && pnpm vitest run`
Expected: All pass

**Step 2: Run dashboard lint + type check**

Run: `cd apps/dashboard && pnpm run lint && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Run dashboard build**

Run: `pnpm run build:dashboard`
Expected: Build succeeds

**Step 4: Run Playwright e2e tests**

Run: `cd apps/dashboard && pnpm test:e2e`
Expected: All pass (or known unrelated failures)

**Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup after judge prompts + sponsor chips"
```
