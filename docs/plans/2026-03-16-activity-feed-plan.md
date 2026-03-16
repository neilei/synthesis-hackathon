# Activity Feed & Cycle History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the AI Reasoning card in the Monitor tab with a scrollable activity feed that groups log entries by cycle, showing cycle-level portfolio snapshots as headers and individual events (decisions, swaps, errors) within each cycle.

**Architecture:** Backend enriches log entries with a `cycle` field and adds portfolio state to `cycle_complete` entries. Frontend groups the feed array by cycle, renders collapsible cycle headers with metrics, and shows individual entries when expanded. No new API endpoints — the existing `feed` array in `AgentStateResponse` carries everything.

**Tech Stack:** Zod (schema), vitest (unit tests), Playwright (e2e), React/Tailwind (components)

---

### Task 1: Add `cycle` field to AgentLogEntrySchema

**Files:**
- Modify: `packages/common/src/schemas.ts:60-69`
- Test: `packages/common/src/__tests__/schemas.test.ts:140-195`

**Step 1: Write the failing test**

In `packages/common/src/__tests__/schemas.test.ts`, add to the `AgentLogEntrySchema` describe block:

```typescript
  it("accepts an entry with a cycle field", () => {
    const withCycle = { ...minimal, cycle: 3 };
    const result = AgentLogEntrySchema.safeParse(withCycle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycle).toBe(3);
    }
  });

  it("accepts an entry without a cycle field", () => {
    const result = AgentLogEntrySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycle).toBeUndefined();
    }
  });
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/common test`
Expected: FAIL — `cycle` not in schema, stripped by Zod

**Step 3: Write minimal implementation**

In `packages/common/src/schemas.ts`, add `cycle` to `AgentLogEntrySchema`:

```typescript
export const AgentLogEntrySchema = z.object({
  timestamp: z.string(),
  sequence: z.number(),
  action: z.string(),
  cycle: z.number().optional(),
  tool: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  duration_ms: z.number().optional(),
  error: z.string().optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @veil/common test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/common/src/schemas.ts packages/common/src/__tests__/schemas.test.ts
git commit -m "feat(common): add optional cycle field to AgentLogEntrySchema"
```

---

### Task 2: Add `cycle` param to `logAction()` and pass it in agent-loop

**Files:**
- Modify: `packages/agent/src/logging/agent-log.ts:23-44`
- Modify: `packages/agent/src/agent-loop.ts` (lines 255, 261, 329, 337, 358, 386, 394, 461, 503, 511, 561, 580, 640, 688, 712, 726)
- Test: `packages/agent/src/logging/__tests__/agent-log.test.ts`

**Step 1: Write the failing test**

In `packages/agent/src/logging/__tests__/agent-log.test.ts`, add to the `logAction` describe block:

```typescript
  it("includes cycle field when provided", () => {
    const entry = logAction("rebalance_decision", {
      cycle: 5,
    });

    expect(entry.cycle).toBe(5);
  });

  it("omits cycle field when not provided", () => {
    const entry = logAction("agent_start");

    expect(entry.cycle).toBeUndefined();
  });

  it("writes cycle to JSONL output", () => {
    logAction("test_cycle", { cycle: 3 });

    const [, content] = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(content.trim());
    expect(parsed.cycle).toBe(3);
  });
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/agent test`
Expected: FAIL — `cycle` not accepted by `logAction` opts type

**Step 3: Write minimal implementation**

In `packages/agent/src/logging/agent-log.ts`, add `cycle` to the opts type:

```typescript
export function logAction(
  action: string,
  opts?: {
    cycle?: number;
    tool?: string;
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    duration_ms?: number;
    error?: string;
  },
): AgentLogEntry {
  const entry: AgentLogEntry = {
    timestamp: new Date().toISOString(),
    sequence: sequence++,
    action,
    ...opts,
  };

  const line = JSON.stringify(entry) + "\n";
  appendFileSync(LOG_PATH, line, "utf-8");

  return entry;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @veil/agent test`
Expected: PASS

**Step 5: Add cycle to all logAction calls inside runCycle and executeSwap**

In `packages/agent/src/agent-loop.ts`, every `logAction()` call that happens inside or below `runCycle()` needs `cycle: state.cycle`. The calls are:

- Line 255: `logAction("cycle_error", { cycle: state.cycle, ...` — already has `parameters: { cycle }`, add `cycle` as top-level field
- Line 261: `logAction("cycle_complete", { cycle: state.cycle, ...` — same
- Line 329: `logAction("budget_check", { cycle: state.cycle, ...`
- Line 337: `logAction("price_fetch", { cycle: state.cycle, ...`
- Line 358: `logAction("portfolio_check", { cycle: state.cycle, ...`
- Line 386: `logAction("pool_data_fetch", { cycle: state.cycle, ...` (success)
- Line 394: `logAction("pool_data_fetch", { cycle: state.cycle, ...` (error)
- Line 461: `logAction("rebalance_decision", { cycle: state.cycle, ...`
- Line 503: `logAction("safety_block", { cycle: state.cycle, ...`
- Line 511: `logAction("safety_block", { cycle: state.cycle, ...`
- Line 561: `logAction("permit2_approval", { cycle: state.cycle, ...`
- Line 580: `logAction("quote_received", { cycle: state.cycle, ...`
- Line 640: `logAction("delegation_redeem_failed", { cycle: state.cycle, ...`
- Line 688: `logAction("swap_executed", { cycle: state.cycle, ...`
- Line 712: `logAction("erc8004_feedback", { cycle: state.cycle, ...`  — this is inside an async `.then()`, need to capture `state.cycle` in a const before the async gap
- Line 726: `logAction("swap_failed", { cycle: state.cycle, ...`

The approach: `gatherMarketData`, `getRebalanceDecision`, and `executeSwap` don't currently receive `state`. However, `executeSwap` already receives `state` (line 484). `gatherMarketData` does not — it needs a `cycle` parameter added.

Changes needed:
1. Add `cycle: number` param to `gatherMarketData(config, agentAddress, cycle)`
2. Pass `state.cycle` from `runCycle()` call at line 750
3. Add `cycle` to all `logAction()` calls in `gatherMarketData`
4. Add `cycle` to all `logAction()` calls in `getRebalanceDecision` — also needs a cycle param, or access state.cycle (it already receives `state`)
5. Add `cycle` to all `logAction()` calls in `executeSwap` — already receives `state`
6. Add `cycle` to the `cycle_error` and `cycle_complete` calls in the main loop (lines 255, 261)

**Step 6: Run full test suite**

Run: `pnpm run build && pnpm run test:unit`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/agent/src/logging/agent-log.ts packages/agent/src/agent-loop.ts packages/agent/src/logging/__tests__/agent-log.test.ts
git commit -m "feat(agent): pass cycle number to all logAction calls"
```

---

### Task 3: Enrich `cycle_complete` with portfolio state snapshot

**Files:**
- Modify: `packages/agent/src/agent-loop.ts:261-269`

**Step 1: Modify the cycle_complete logAction call**

In `packages/agent/src/agent-loop.ts`, change the `cycle_complete` call (around line 261) to include state snapshot:

```typescript
    logAction("cycle_complete", {
      cycle: state.cycle,
      parameters: { cycle: state.cycle },
      duration_ms: Date.now() - cycleStart,
      result: {
        tradesExecuted: state.tradesExecuted,
        totalSpentUsd: state.totalSpentUsd,
        budgetTier: getBudgetTier(),
        allocation: state.allocation,
        drift: state.drift,
        totalValue: state.totalValue,
        ethPrice: state.ethPrice,
      },
    });
```

No new tests needed — the `result` field is `Record<string, unknown>` (free-form). The frontend will type-narrow when reading.

**Step 2: Run build**

Run: `pnpm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop.ts
git commit -m "feat(agent): include portfolio snapshot in cycle_complete log entries"
```

---

### Task 4: Create feed grouping utility

**Files:**
- Create: `apps/dashboard/lib/group-feed.ts`
- Create: `apps/dashboard/lib/group-feed.test.ts`

**Step 1: Write the failing tests**

Create `apps/dashboard/lib/group-feed.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentLogEntry } from "@veil/common";
import { groupFeedByCycle } from "./group-feed";

const entry = (overrides: Partial<AgentLogEntry> & { action: string }): AgentLogEntry => ({
  timestamp: "2026-03-16T12:00:00.000Z",
  sequence: 0,
  ...overrides,
});

describe("groupFeedByCycle", () => {
  it("groups entries by cycle number", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "rebalance_decision", cycle: 1, sequence: 1 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 2 }),
      entry({ action: "price_fetch", cycle: 2, sequence: 3 }),
      entry({ action: "cycle_complete", cycle: 2, sequence: 4 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups).toHaveLength(2);
    expect(groups[0].cycle).toBe(1);
    expect(groups[0].entries).toHaveLength(3);
    expect(groups[1].cycle).toBe(2);
    expect(groups[1].entries).toHaveLength(2);
  });

  it("puts entries without cycle in an init group (cycle null)", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "agent_start", sequence: 0 }),
      entry({ action: "audit_report", sequence: 1 }),
      entry({ action: "price_fetch", cycle: 1, sequence: 2 }),
      entry({ action: "cycle_complete", cycle: 1, sequence: 3 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups).toHaveLength(2);
    expect(groups[0].cycle).toBeNull();
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].cycle).toBe(1);
  });

  it("extracts snapshot from cycle_complete result", () => {
    const feed: AgentLogEntry[] = [
      entry({
        action: "cycle_complete",
        cycle: 1,
        sequence: 0,
        result: {
          allocation: { ETH: 0.6, USDC: 0.4 },
          drift: 0.03,
          totalValue: 1500,
          ethPrice: 2500,
          tradesExecuted: 1,
          totalSpentUsd: 45,
          budgetTier: "$200/day",
        },
      }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].snapshot).toEqual({
      allocation: { ETH: 0.6, USDC: 0.4 },
      drift: 0.03,
      totalValue: 1500,
      ethPrice: 2500,
    });
  });

  it("snapshot is null when cycle_complete has no result", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].snapshot).toBeNull();
  });

  it("returns empty array for empty feed", () => {
    expect(groupFeedByCycle([])).toEqual([]);
  });

  it("preserves entry order within each group", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "a", cycle: 1, sequence: 0 }),
      entry({ action: "b", cycle: 1, sequence: 1 }),
      entry({ action: "c", cycle: 1, sequence: 2 }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].entries.map((e) => e.action)).toEqual(["a", "b", "c"]);
  });

  it("detects errors in a cycle group", () => {
    const feed: AgentLogEntry[] = [
      entry({ action: "price_fetch", cycle: 1, sequence: 0 }),
      entry({ action: "cycle_error", cycle: 1, sequence: 1, error: "boom" }),
    ];

    const groups = groupFeedByCycle(feed);
    expect(groups[0].hasError).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/dashboard test`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `apps/dashboard/lib/group-feed.ts`:

```typescript
import type { AgentLogEntry } from "@veil/common";

export interface CycleSnapshot {
  allocation: Record<string, number>;
  drift: number;
  totalValue: number;
  ethPrice: number;
}

export interface CycleGroup {
  cycle: number | null;
  entries: AgentLogEntry[];
  snapshot: CycleSnapshot | null;
  hasError: boolean;
}

function extractSnapshot(entries: AgentLogEntry[]): CycleSnapshot | null {
  const complete = entries.find((e) => e.action === "cycle_complete");
  if (!complete?.result) return null;
  const r = complete.result;
  if (
    typeof r.allocation !== "object" ||
    r.allocation === null ||
    typeof r.drift !== "number" ||
    typeof r.totalValue !== "number" ||
    typeof r.ethPrice !== "number"
  ) {
    return null;
  }
  return {
    allocation: r.allocation as Record<string, number>,
    drift: r.drift,
    totalValue: r.totalValue,
    ethPrice: r.ethPrice,
  };
}

export function groupFeedByCycle(feed: AgentLogEntry[]): CycleGroup[] {
  if (feed.length === 0) return [];

  const map = new Map<number | null, AgentLogEntry[]>();
  const order: (number | null)[] = [];

  for (const entry of feed) {
    const key = entry.cycle ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(entry);
  }

  return order.map((key) => {
    const entries = map.get(key)!;
    return {
      cycle: key,
      entries,
      snapshot: key !== null ? extractSnapshot(entries) : null,
      hasError: entries.some((e) => !!e.error),
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @veil/dashboard test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/dashboard/lib/group-feed.ts apps/dashboard/lib/group-feed.test.ts
git commit -m "feat(dashboard): add feed grouping utility for cycle-based activity feed"
```

---

### Task 5: Create FeedEntry component

**Files:**
- Create: `apps/dashboard/components/feed-entry.tsx`

**Step 1: Create the component**

This component renders a single `AgentLogEntry` with visual treatment based on its type.

```tsx
import type { AgentLogEntry } from "@veil/common";
import { Badge } from "./ui/badge";
import { truncateHash, formatTimestamp } from "@veil/common";

interface FeedEntryProps {
  entry: AgentLogEntry;
}

function getEntryLabel(action: string): string {
  const labels: Record<string, string> = {
    rebalance_decision: "Rebalance",
    swap_executed: "Swap",
    swap_failed: "Swap Failed",
    cycle_error: "Cycle Error",
    safety_block: "Safety Block",
    delegation_redeem_failed: "Delegation Failed",
    permit2_approval: "Permit2 Approval",
    quote_received: "Quote",
    price_fetch: "Price Fetch",
    portfolio_check: "Portfolio",
    pool_data_fetch: "Pool Data",
    budget_check: "Budget Check",
    cycle_complete: "Cycle Complete",
    erc8004_feedback: "ERC-8004 Feedback",
    agent_start: "Agent Start",
    agent_stop: "Agent Stop",
    audit_report: "Audit Report",
    delegation_created: "Delegation Created",
    delegation_failed: "Delegation Failed",
    adversarial_check: "Safety Check",
    erc8004_register: "Identity Registered",
    erc8004_register_failed: "Identity Failed",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

export function FeedEntry({ entry }: FeedEntryProps) {
  const isError = !!entry.error;
  const isRebalance = entry.action === "rebalance_decision";
  const isSwap = entry.action === "swap_executed";

  // Error entries
  if (isError) {
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-danger" />
        <div className="min-w-0">
          <span className="font-medium text-accent-danger">
            {getEntryLabel(entry.action)}
          </span>
          <span className="ml-2 text-text-tertiary">{entry.error}</span>
        </div>
      </div>
    );
  }

  // Rebalance decision
  if (isRebalance && entry.result) {
    const r = entry.result as Record<string, unknown>;
    const shouldRebalance = r.shouldRebalance as boolean;
    const reasoning = r.reasoning as string;
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-positive" />
        <div className="min-w-0">
          <Badge variant={shouldRebalance ? "positive" : "warning"}>
            {shouldRebalance ? "Rebalance" : "Hold"}
          </Badge>
          <span className="ml-2 text-text-secondary">{reasoning}</span>
        </div>
      </div>
    );
  }

  // Swap executed
  if (isSwap && entry.result) {
    const r = entry.result as Record<string, unknown>;
    const txHash = r.txHash as string;
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-secondary" />
        <div className="min-w-0">
          <span className="font-medium text-text-primary">Swap</span>
          <span className="ml-2 text-text-secondary">
            {r.sellAmount as string} {r.sellToken as string} → {r.buyToken as string}
          </span>
          {txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 font-mono text-xs text-accent-secondary hover:underline"
            >
              {truncateHash(txHash)}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Default: muted entry
  return (
    <div className="flex items-start gap-2 py-1 text-sm">
      <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
      <div className="min-w-0">
        <span className="text-text-tertiary">{getEntryLabel(entry.action)}</span>
        {entry.duration_ms != null && (
          <span className="ml-2 font-mono text-xs tabular-nums text-text-tertiary">
            {entry.duration_ms}ms
          </span>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Run build to verify types**

Run: `pnpm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/components/feed-entry.tsx
git commit -m "feat(dashboard): add FeedEntry component for activity feed"
```

---

### Task 6: Create CycleGroup component

**Files:**
- Create: `apps/dashboard/components/cycle-group.tsx`

**Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import type { CycleGroup as CycleGroupData } from "@/lib/group-feed";
import { FeedEntry } from "./feed-entry";
import { formatCurrency, formatPercentage } from "@veil/common";

interface CycleGroupProps {
  group: CycleGroupData;
  defaultExpanded?: boolean;
}

export function CycleGroup({ group, defaultExpanded = false }: CycleGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Init group (no cycle number)
  if (group.cycle === null) {
    return (
      <div className="border-b border-border-subtle pb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary hover:bg-bg-primary"
        >
          <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          Initialization
          <span className="ml-auto font-mono tabular-nums text-text-tertiary">
            {group.entries.length} events
          </span>
        </button>
        {expanded && (
          <div className="mt-1 space-y-0 pl-4">
            {group.entries.map((entry) => (
              <FeedEntry key={entry.sequence} entry={entry} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const snap = group.snapshot;
  const driftPct = snap ? snap.drift * 100 : null;
  const allocSummary = snap
    ? Object.entries(snap.allocation)
        .map(([token, pct]) => `${(pct * 100).toFixed(0)}% ${token}`)
        .join(" / ")
    : null;

  return (
    <div className="border-b border-border-subtle pb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-bg-primary ${group.hasError ? "text-accent-danger" : "text-text-secondary"}`}
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <span className="font-medium text-text-primary">Cycle {group.cycle}</span>
        {snap && (
          <>
            <span className="font-mono tabular-nums">{formatCurrency(snap.totalValue)}</span>
            <span className={`font-mono tabular-nums ${driftPct != null && driftPct > 5 ? "text-accent-danger" : "text-accent-positive"}`}>
              {driftPct != null ? formatPercentage(snap.drift) : "—"}
            </span>
            <span className="hidden text-text-tertiary sm:inline">{allocSummary}</span>
          </>
        )}
        {group.hasError && (
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-danger" />
        )}
        <span className="ml-auto font-mono tabular-nums text-text-tertiary">
          {group.entries.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0 pl-4">
          {group.entries.map((entry) => (
            <FeedEntry key={entry.sequence} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Run build to verify types**

Run: `pnpm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/components/cycle-group.tsx
git commit -m "feat(dashboard): add CycleGroup component with collapsible cycle headers"
```

---

### Task 7: Create ActivityFeed component

**Files:**
- Create: `apps/dashboard/components/activity-feed.tsx`

**Step 1: Create the component**

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { AgentLogEntry } from "@veil/common";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { SponsorBadge } from "./sponsor-badge";
import { CycleGroup } from "./cycle-group";
import { groupFeedByCycle } from "@/lib/group-feed";

interface ActivityFeedProps {
  feed: AgentLogEntry[];
}

export function ActivityFeed({ feed }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Track if user is scrolled to the bottom
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    wasAtBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  };

  // Auto-scroll to bottom when feed changes (if user was at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [feed]);

  const groups = groupFeedByCycle(feed);

  return (
    <Card className="flex flex-col p-5">
      <SectionHeading className="mb-3">Activity Feed</SectionHeading>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-1 overflow-y-auto"
        style={{ maxHeight: "400px" }}
      >
        {groups.length > 0 ? (
          groups.map((group) => (
            <CycleGroup
              key={group.cycle ?? "init"}
              group={group}
              defaultExpanded={group === groups[groups.length - 1]}
            />
          ))
        ) : (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-sm text-text-tertiary">
              Waiting for the agent&apos;s first cycle...
            </p>
          </div>
        )}
      </div>
      <div className="mt-5 border-t border-border-subtle pt-3">
        <SponsorBadge text="Powered by Venice" />
      </div>
    </Card>
  );
}
```

**Step 2: Run build to verify types**

Run: `pnpm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/components/activity-feed.tsx
git commit -m "feat(dashboard): add ActivityFeed component with auto-scroll and cycle grouping"
```

---

### Task 8: Replace AI Reasoning card with ActivityFeed in Monitor

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx`

**Step 1: Replace the AI Reasoning card**

In `apps/dashboard/components/monitor.tsx`:

1. Remove the `RebalanceResult` interface (lines 28-32)
2. Remove the `findLatestRebalanceEntry` function (lines 34-57)
3. Remove the `latestReasoning` variable (line 195)
4. Add import: `import { ActivityFeed } from "./activity-feed";`
5. Replace the AI Reasoning card (the `<Card className="flex flex-col p-5">` block starting around line 239) with:

```tsx
        {/* Activity Feed */}
        <ActivityFeed feed={data.feed} />
```

This removes the entire AI Reasoning card and its Venice sponsor badge (which is already in the ActivityFeed component).

**Step 2: Run build and lint**

Run: `pnpm run build && pnpm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/components/monitor.tsx
git commit -m "feat(dashboard): replace AI Reasoning card with ActivityFeed in Monitor tab"
```

---

### Task 9: Update Playwright e2e tests for Monitor

**Files:**
- Modify: `apps/dashboard/tests/monitor.spec.ts`

**Step 1: Update mock data and tests**

The existing tests reference "AI Reasoning" and the Venice sponsor badge. Update:

1. Update `mockAgentState` to include feed entries with cycle data:

```typescript
function mockAgentState(
  page: import("@playwright/test").Page,
  overrides: Record<string, unknown> = {},
) {
  return page.route("**/api/state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: true,
        cycle: 3,
        ethPrice: 2000,
        drift: 0.02,
        totalValue: 1500,
        trades: 1,
        totalSpent: 45,
        budgetTier: "$200",
        allocation: { ETH: 0.58, USDC: 0.42 },
        target: { ETH: 0.6, USDC: 0.4 },
        transactions: [
          {
            txHash:
              "0xabc123def456789012345678901234567890123456789012345678901234abcd",
            sellToken: "USDC",
            buyToken: "ETH",
            sellAmount: "45.00",
            status: "confirmed",
            timestamp: new Date().toISOString(),
          },
        ],
        feed: [
          {
            timestamp: new Date().toISOString(),
            sequence: 0,
            action: "rebalance_decision",
            cycle: 1,
            result: {
              shouldRebalance: false,
              reasoning: "Portfolio within threshold",
              marketContext: "Stable market",
            },
          },
          {
            timestamp: new Date().toISOString(),
            sequence: 1,
            action: "cycle_complete",
            cycle: 1,
            result: {
              allocation: { ETH: 0.58, USDC: 0.42 },
              drift: 0.02,
              totalValue: 1500,
              ethPrice: 2000,
              tradesExecuted: 1,
              totalSpentUsd: 45,
              budgetTier: "$200",
            },
          },
        ],
        ...overrides,
      }),
    }),
  );
}
```

2. Replace the "shows sponsor badges" test — remove assertion for "Powered by Venice" being at a specific location since it moved into the feed. Keep it but check it's still visible somewhere.

3. Add new tests:

```typescript
  test("shows activity feed with cycle header", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Activity Feed")).toBeVisible();
    await expect(page.getByText("Cycle 1")).toBeVisible();
  });

  test("shows rebalance decision in activity feed", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    // Click cycle header to expand (last cycle is expanded by default)
    await page.getByText("Cycle 1").click();
    await expect(page.getByText("Portfolio within threshold")).toBeVisible();
  });

  test("shows error entries in feed with red styling", async ({ page }) => {
    await mockAgentState(page, {
      feed: [
        {
          timestamp: new Date().toISOString(),
          sequence: 0,
          action: "cycle_error",
          cycle: 1,
          error: "Uniswap API validation failed",
        },
      ],
    });
    await navigateToMonitor(page);

    await page.getByText("Cycle 1").click();
    await expect(page.getByText("Uniswap API validation failed")).toBeVisible();
  });

  test("shows empty feed state before first cycle", async ({ page }) => {
    await mockAgentState(page, { feed: [], cycle: 0 });
    await navigateToMonitor(page);

    await expect(
      page.getByText("Waiting for the agent's first cycle..."),
    ).toBeVisible();
  });
```

**Step 2: Run e2e tests**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/tests/monitor.spec.ts
git commit -m "test(dashboard): update monitor e2e tests for activity feed"
```

---

### Task 10: Final verification

**Step 1: Run full suite**

```bash
pnpm run lint
pnpm run build
pnpm run test:unit
```

Expected: All pass.

**Step 2: Run e2e tests**

```bash
pnpm --filter @veil/dashboard test:e2e
```

Expected: All pass.

**Step 3: Commit and push**

```bash
git push origin main
```
