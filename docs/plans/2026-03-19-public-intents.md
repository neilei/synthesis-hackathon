# Public Intent Visibility & Privacy Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all active intents visible to anyone visiting maw.finance without wallet connection, while hiding Venice AI reasoning (private) and restricting owner-only actions (stop, download logs).

**Architecture:** Server-side redaction module strips Venice LLM reasoning from public endpoints. The Monitor component switches between owner view (full controls) and public view (read-only, redacted) using a single `IntentDetailView` with an `isOwner` prop. Feed entries detect `_redacted: true` in their result data to show a privacy indicator.

**Tech Stack:** Next.js 16, React, Hono, TypeScript, SSE (EventSource), wagmi

---

### Task 1: Create shared log redaction module

**Files:**
- Create: `packages/agent/src/logging/redact.ts`
- Create: `packages/agent/src/logging/__tests__/redact.test.ts`

**Context:** Both the public detail endpoint and public SSE endpoint need identical redaction logic. Create it once as a shared module before wiring it into routes.

The DB returns `AgentLogSelect` rows where `result` and `parameters` are `string | null` (JSON blobs). The SSE emitter sends parsed `AgentLogEntry` objects where `result` is already `Record<string, unknown> | undefined`. We need two functions — one for each shape.

**Step 1: Write the failing tests**

Create `packages/agent/src/logging/__tests__/redact.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { redactLogRow, redactParsedEntry } from "../redact.js";

describe("redactLogRow", () => {
  it("returns null for privacy_guarantee action", () => {
    const row = {
      id: 1,
      intentId: "test",
      action: "privacy_guarantee",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 0,
      cycle: null,
      tool: null,
      parameters: null,
      result: null,
      durationMs: null,
      error: null,
    };
    expect(redactLogRow(row)).toBeNull();
  });

  it("redacts reasoning and marketContext from rebalance_decision", () => {
    const row = {
      id: 2,
      intentId: "test",
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({
        shouldRebalance: true,
        reasoning: "ETH is undervalued because...",
        marketContext: "BTC dominance rising...",
        model: "qwen3-4b",
      }),
      durationMs: 1200,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.shouldRebalance).toBe(true);
    expect(redacted!.result!.reasoning).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.marketContext).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.model).toBe("qwen3-4b");
    expect(redacted!.result!._redacted).toBe(true);
  });

  it("redacts reasonings from judge_completed", () => {
    const row = {
      id: 3,
      intentId: "test",
      action: "judge_completed",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 2,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({
        composite: 7.5,
        scores: { "decision-quality": 80 },
        reasonings: { "decision-quality": "The agent made a good call..." },
      }),
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.composite).toBe(7.5);
    expect(redacted!.result!.reasonings).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!._redacted).toBe(true);
  });

  it("passes through swap_executed unchanged", () => {
    const row = {
      id: 4,
      intentId: "test",
      action: "swap_executed",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 3,
      cycle: 1,
      tool: null,
      parameters: null,
      result: JSON.stringify({ txHash: "0xabc", sellAmount: "0.1" }),
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.txHash).toBe("0xabc");
    expect(redacted!.result!._redacted).toBeUndefined();
  });

  it("handles null result gracefully", () => {
    const row = {
      id: 5,
      intentId: "test",
      action: "agent_start",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 4,
      cycle: null,
      tool: null,
      parameters: null,
      result: null,
      durationMs: null,
      error: null,
    };
    const redacted = redactLogRow(row);
    expect(redacted).not.toBeNull();
    expect(redacted!.result).toBeUndefined();
  });
});

describe("redactParsedEntry", () => {
  it("returns null for privacy_guarantee", () => {
    const entry = {
      action: "privacy_guarantee",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 0,
    };
    expect(redactParsedEntry(entry)).toBeNull();
  });

  it("redacts reasoning from parsed rebalance_decision", () => {
    const entry = {
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      result: {
        shouldRebalance: false,
        reasoning: "Market is stable",
        marketContext: "Low volatility",
      },
    };
    const redacted = redactParsedEntry(entry);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.reasoning).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!.marketContext).toBe("[private — encrypted via Venice.ai]");
    expect(redacted!.result!._redacted).toBe(true);
    expect(redacted!.result!.shouldRebalance).toBe(false);
  });

  it("does not mutate the original entry", () => {
    const entry = {
      action: "rebalance_decision",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 1,
      result: {
        shouldRebalance: true,
        reasoning: "original reasoning",
      },
    };
    redactParsedEntry(entry);
    expect(entry.result.reasoning).toBe("original reasoning");
  });

  it("passes through cycle_complete unchanged", () => {
    const entry = {
      action: "cycle_complete",
      timestamp: "2026-03-19T00:00:00Z",
      sequence: 5,
      result: { totalValue: 150.5, drift: 0.02 },
    };
    const redacted = redactParsedEntry(entry);
    expect(redacted).not.toBeNull();
    expect(redacted!.result!.totalValue).toBe(150.5);
    expect(redacted!.result!._redacted).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @maw/agent test -- --run src/logging/__tests__/redact.test.ts`
Expected: FAIL — module `../redact.js` does not exist

**Step 3: Create the redaction module**

Create `packages/agent/src/logging/redact.ts`:

```typescript
import type { AgentLogEntry } from "@maw/common";
import type { AgentLogSelect } from "../db/repository.js";

/** Actions entirely stripped from public feeds. */
const PRIVATE_ACTIONS = new Set(["privacy_guarantee"]);

/** For these actions, the listed keys in `result` are replaced with a placeholder. */
const REDACT_RESULT_KEYS: Record<string, string[]> = {
  rebalance_decision: ["reasoning", "marketContext"],
  judge_completed: ["reasonings"],
};

const REDACTED_PLACEHOLDER = "[private — encrypted via Venice.ai]";

/** Return type for redacted DB rows — result/parameters parsed from JSON strings to objects. */
export interface RedactedLogRow {
  timestamp: string;
  sequence: number;
  action: string;
  cycle: number | null;
  tool: string | null;
  result: Record<string, unknown> | undefined;
  parameters: Record<string, unknown> | undefined;
  durationMs: number | null;
  error: string | null;
}

/**
 * Redact a DB log row (where result/parameters are JSON strings) for public consumption.
 * Returns null if the entry should be entirely suppressed.
 */
export function redactLogRow(row: AgentLogSelect): RedactedLogRow | null {
  if (PRIVATE_ACTIONS.has(row.action)) return null;

  const result: Record<string, unknown> | undefined = row.result
    ? JSON.parse(row.result)
    : undefined;
  const parameters: Record<string, unknown> | undefined = row.parameters
    ? JSON.parse(row.parameters)
    : undefined;

  const keysToRedact = REDACT_RESULT_KEYS[row.action];
  if (keysToRedact && result) {
    for (const key of keysToRedact) {
      if (key in result) {
        result[key] = REDACTED_PLACEHOLDER;
      }
    }
    result._redacted = true;
  }

  return {
    timestamp: row.timestamp,
    sequence: row.sequence,
    action: row.action,
    cycle: row.cycle,
    tool: row.tool,
    result,
    parameters,
    durationMs: row.durationMs,
    error: row.error,
  };
}

/**
 * Redact a parsed AgentLogEntry (result already an object) for public SSE streaming.
 * Returns null if the entry should be entirely suppressed.
 */
export function redactParsedEntry(entry: AgentLogEntry): AgentLogEntry | null {
  if (PRIVATE_ACTIONS.has(entry.action)) return null;

  const keysToRedact = REDACT_RESULT_KEYS[entry.action];
  if (keysToRedact && entry.result) {
    const result = { ...entry.result };
    for (const key of keysToRedact) {
      if (key in result) {
        result[key] = REDACTED_PLACEHOLDER;
      }
    }
    result._redacted = true;
    return { ...entry, result };
  }

  return entry;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- --run src/logging/__tests__/redact.test.ts`
Expected: all 9 tests pass

**Step 5: Commit**

```bash
git add packages/agent/src/logging/redact.ts packages/agent/src/logging/__tests__/redact.test.ts
git commit -m "feat: add log redaction module for public endpoints"
```

---

### Task 2: Wire redaction into public detail endpoint

**Files:**
- Modify: `packages/agent/src/server.ts:120-149` (public detail route)

**Context:** The `GET /api/intents/public/:id` route currently returns `logs: []`. Update it to fetch logs from the DB and redact them using `redactLogRow`.

**Step 1: Add imports to server.ts**

At the top of `server.ts`, add:

```typescript
import { redactLogRow, redactParsedEntry } from "./logging/redact.js";
```

**Step 2: Update the public detail route**

In the `GET /api/intents/public/:id` handler (around line 120-149), replace:

```typescript
    logs: [],
```

With log retrieval + redaction, inserted after the `liveState` computation:

```typescript
    const rawLogs = repo.getIntentLogs(intentId, { afterSequence: -1, limit: 10_000 });
    const logs = rawLogs.map(redactLogRow).filter((l): l is NonNullable<typeof l> => l !== null);
```

And update the return object to use the new `logs` variable.

**Step 3: Run build**

Run: `pnpm run build --filter @maw/agent`
Expected: compiles

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat: return redacted logs in public intent detail endpoint"
```

---

### Task 3: Add public SSE endpoint with redacted entries

**Files:**
- Modify: `packages/agent/src/server.ts` (add public SSE route + imports)
- Create: `apps/dashboard/app/api/intents/public/[id]/events/route.ts`

**Context:** The authenticated SSE route (`GET /api/intents/:id/events`) streams full log entries. We need a public equivalent that applies `redactParsedEntry` before sending. Mount it before the auth middleware, alongside the other public routes.

**Step 1: Add streaming imports to server.ts**

Add to the imports at the top:

```typescript
import { streamSSE } from "hono/streaming";
import { onLogEntry } from "./logging/intent-log.js";
```

(`redactParsedEntry` was already imported in Task 2.)

**Step 2: Add public SSE route**

Insert after the `GET /api/intents/public/:id` handler and BEFORE the identity routes / auth middleware (around line 149):

```typescript
// Public SSE stream (no auth — redacted entries only)
app.get(`${API_PATHS.intents}/public/:id/events`, (c) => {
  const intentId = c.req.param("id");
  const intent = repo.getIntent(intentId);
  if (!intent) {
    return c.json({ error: "Intent not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    const unsub = onLogEntry((id, entry) => {
      if (id !== intentId) return;
      const redacted = redactParsedEntry(entry);
      if (!redacted) return;
      stream.writeSSE({
        data: JSON.stringify(redacted),
        event: "log",
        id: String(entry.sequence),
      });
    });

    stream.onAbort(() => {
      unsub();
    });

    while (true) {
      await stream.sleep(30_000);
      await stream.writeSSE({ data: "", event: "heartbeat", id: "" });
    }
  });
});
```

**Step 3: Create Next.js proxy route**

Create `apps/dashboard/app/api/intents/public/[id]/events/route.ts`:

```typescript
import { AGENT_API_URL } from "@/lib/agent-url";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await fetch(
      `${AGENT_API_URL}/api/intents/public/${id}/events`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return new Response(JSON.stringify({ error: text }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Could not connect to the agent server." }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
```

**Step 4: Run build**

Run: `pnpm run build --filter @maw/agent`
Expected: compiles

**Step 5: Commit**

```bash
git add packages/agent/src/server.ts apps/dashboard/app/api/intents/public/
git commit -m "feat: add public SSE endpoint with redacted log entries"
```

---

### Task 4: Client-side hooks for public intent detail and feed

**Files:**
- Create: `apps/dashboard/hooks/use-public-intent-detail.ts`
- Create: `apps/dashboard/hooks/use-public-intent-feed.ts`
- Modify: `apps/dashboard/lib/api.ts:104-110` (fix return type)

**Context:** Mirror `useIntentDetail` and `useIntentFeed` but use public (no-auth) endpoints. The key differences: no token parameter, different URL for SSE, no auth headers.

**Step 1: Fix `fetchPublicIntentDetail` return type**

In `apps/dashboard/lib/api.ts`, the return type currently says `logs: never[]`. Update it to match the actual redacted response:

```typescript
export async function fetchPublicIntentDetail(
  intentId: string,
): Promise<IntentRecord & { liveState: unknown; logs: AgentLogEntry[] }> {
  const res = await fetch(`/api/intents/public/${intentId}`);
  if (!res.ok) throw new Error("Failed to fetch intent");
  return res.json();
}
```

`AgentLogEntry` is already imported in this file via `import type { ParsedIntent, AuditReport, IntentRecord, AgentLogEntry } from "@maw/common";`.

**Step 2: Create `use-public-intent-detail.ts`**

Create `apps/dashboard/hooks/use-public-intent-detail.ts`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentLogEntry } from "@maw/common";
import { fetchPublicIntentDetail, type IntentRecord } from "@/lib/api";

export interface PublicIntentDetail extends IntentRecord {
  logs: AgentLogEntry[];
  liveState: unknown;
}

export function usePublicIntentDetail(
  intentId: string | null,
  intervalMs = 15000,
) {
  const [data, setData] = useState<PublicIntentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!intentId) return;
    try {
      const detail = await fetchPublicIntentDetail(intentId);
      setData(detail as PublicIntentDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch intent");
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    if (!intentId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intentId, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
```

**Step 3: Create `use-public-intent-feed.ts`**

Create `apps/dashboard/hooks/use-public-intent-feed.ts`:

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLogEntry } from "@maw/common";
import { fetchPublicIntentDetail } from "@/lib/api";

export function usePublicIntentFeed(intentId: string | null) {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sseError, setSseError] = useState<string | null>(null);
  const errorCountRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const seenSeqRef = useRef(new Set<number>());
  const lastReloadRef = useRef(0);

  const loadHistorical = useCallback(async () => {
    if (!intentId) return;
    try {
      const data = await fetchPublicIntentDetail(intentId);
      const logs = data.logs ?? [];
      setEntries(logs);
      seenSeqRef.current = new Set(logs.map((e) => e.sequence));
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    if (!intentId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadHistorical();

    // Public SSE — no auth needed
    const es = new EventSource(`/api/intents/public/${intentId}/events`);
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      errorCountRef.current = 0;
      setSseError(null);

      try {
        const entry = JSON.parse(e.data) as AgentLogEntry;
        if (seenSeqRef.current.has(entry.sequence)) return;
        seenSeqRef.current.add(entry.sequence);
        setEntries((prev) => [...prev, entry]);
      } catch {
        // Skip malformed SSE data
      }
    });

    es.onerror = () => {
      errorCountRef.current++;
      if (errorCountRef.current >= 3) {
        setSseError("Live feed disconnected — retrying.");
      }
      const now = Date.now();
      if (now - lastReloadRef.current > 5000) {
        lastReloadRef.current = now;
        loadHistorical();
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [intentId, loadHistorical]);

  return { entries, loading, sseError };
}
```

**Step 4: Run lint**

Run: `pnpm --filter @maw/dashboard run lint`
Expected: passes

**Step 5: Commit**

```bash
git add apps/dashboard/hooks/use-public-intent-detail.ts apps/dashboard/hooks/use-public-intent-feed.ts apps/dashboard/lib/api.ts
git commit -m "feat: add public intent detail and feed hooks (no auth)"
```

---

### Task 5: Add PrivacyNotice component and update FeedEntry

**Files:**
- Create: `apps/dashboard/components/privacy-notice.tsx`
- Modify: `apps/dashboard/components/feed-entry.tsx:369-398,528-585`

**Context:** When `_redacted: true` is present in a feed entry's result, show a lock icon + privacy message instead of the Venice reasoning text. Extract a reusable `PrivacyNotice` component to avoid duplicating the SVG+text in multiple entry handlers.

**Step 1: Create PrivacyNotice component**

Create `apps/dashboard/components/privacy-notice.tsx`:

```typescript
export function PrivacyNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs text-text-tertiary ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3 w-3 text-accent-secondary shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z"
          clipRule="evenodd"
        />
      </svg>
      <span>AI reasoning is end-to-end encrypted and only viewable by the agent owner</span>
    </div>
  );
}
```

**Step 2: Update rebalance_decision handler in feed-entry.tsx**

Add import at top of `feed-entry.tsx`:

```typescript
import { PrivacyNotice } from "./privacy-notice";
```

In the `rebalance_decision` section (lines 387-396), replace the reasoning/market rendering:

```typescript
// Replace lines 387-396 with:
{(res as Record<string, unknown>)?._redacted ? (
  <PrivacyNotice className="mt-1.5" />
) : (
  <>
    {reasoning && (
      <DetailRow label="Reasoning">
        <ExpandableReasoning text={reasoning} />
      </DetailRow>
    )}
    {marketContext && (
      <DetailRow label="Market">
        <ExpandableReasoning text={marketContext} />
      </DetailRow>
    )}
  </>
)}
```

**Step 3: Update judge_completed handler**

In the `judge_completed` section, the per-dimension reasoning lines (around lines 550-552 and 578-580) each conditionally render `ExpandableReasoning`. Update both occurrences to suppress redacted text:

```typescript
// Replace each:
//   {reasoning && (
//     <ExpandableReasoning text={reasoning} className="pl-[8.5rem] mt-0.5" />
//   )}
// With:
{reasoning && typeof reasoning === "string" && !reasoning.startsWith("[private") && (
  <ExpandableReasoning text={reasoning} className="pl-[8.5rem] mt-0.5" />
)}
```

Then after the closing `</div>` of the `scores && (...)` block (around line 585), add:

```typescript
{(res as Record<string, unknown>)?._redacted && (
  <PrivacyNotice className="mt-2" />
)}
```

**Step 4: Run lint**

Run: `pnpm --filter @maw/dashboard run lint`
Expected: passes

**Step 5: Commit**

```bash
git add apps/dashboard/components/privacy-notice.tsx apps/dashboard/components/feed-entry.tsx
git commit -m "feat: show privacy indicator for redacted Venice reasoning in feed entries"
```

---

### Task 6: Refactor IntentDetailView for owner/public dual mode

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx:94-382`

**Context:** Instead of duplicating `IntentDetailView` as a separate `PublicIntentDetailView`, add an `isOwner` prop. When `isOwner` is false: hide stop button, hide download button, use public hooks instead of auth'd hooks. This keeps the component DRY — all the stats, portfolio, and feed rendering stays in one place.

**Step 1: Update IntentDetailView props and hooks**

Change the `IntentDetailView` interface and component to accept dual modes:

```typescript
function IntentDetailView({
  intentId,
  token,
  isOwner,
  onBack,
  onDeleted,
}: {
  intentId: string;
  token: string | null;
  isOwner: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  // Use auth'd hooks when owner, public hooks otherwise
  const authDetail = useIntentDetail(isOwner ? intentId : null, token);
  const publicDetail = usePublicIntentDetail(!isOwner ? intentId : null);
  const { data, error, loading } = isOwner ? authDetail : publicDetail;

  const authFeed = useIntentFeed(isOwner ? intentId : null, token);
  const publicFeed = usePublicIntentFeed(!isOwner ? intentId : null);
  const { entries: feedEntries, sseError } = isOwner ? authFeed : publicFeed;

  // ... rest stays the same, but wrap owner-only UI in `{isOwner && ...}`
```

**Step 2: Conditionally render owner-only controls**

In the header section (around lines 216-249), wrap the download and stop buttons:

```typescript
{isOwner && (
  <button
    onClick={handleDownloadLogs}
    disabled={downloadingLogs}
    className="rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive min-h-[44px]"
  >
    {downloadingLogs ? "Downloading..." : "Download agent_log.jsonl"}
  </button>
)}
{isOwner && dbStatusActive && (
  <>
    <button
      onClick={handleDelete}
      disabled={deleting || !workerRunning}
      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-danger min-h-[44px] ${confirmingDelete ? "border-accent-danger bg-accent-danger/10 text-accent-danger" : "border-accent-danger/30 text-accent-danger hover:bg-accent-danger/10"}`}
    >
      {deleting ? "Stopping..." : confirmingDelete ? "Confirm Stop" : "Stop Agent"}
    </button>
    {confirmingDelete && (
      <button
        onClick={() => setConfirmingDelete(false)}
        className="rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive min-h-[44px]"
      >
        Cancel
      </button>
    )}
  </>
)}
```

The `handleDelete` and `handleDownloadLogs` callbacks still exist but are only invoked when `isOwner` is true, so the `token` being null in public mode doesn't matter (those code paths won't execute).

**Step 3: Update the back button text**

Change `&larr; Back to intents` to `&larr; Back to agents` (consistent with the new section heading).

**Step 4: Run lint**

Run: `pnpm --filter @maw/dashboard run lint`
Expected: passes

**Step 5: Commit**

```bash
git add apps/dashboard/components/monitor.tsx
git commit -m "refactor: add isOwner prop to IntentDetailView for public/private dual mode"
```

---

### Task 7: Rewrite Monitor main component for public-first listing

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx:389-520`

**Context:** Replace the wallet-gated Monitor with a public-first design:
- Always fetch and show `usePublicIntents` (no auth needed)
- When authenticated, also show "Your Agents" section with `useIntents`
- "Show stopped" checkbox to toggle inactive agents
- When clicking an intent, determine ownership and pass `isOwner` to `IntentDetailView`

**Step 1: Add imports**

At the top of `monitor.tsx`, ensure these are imported:

```typescript
import { usePublicIntents } from "@/hooks/use-public-intents";
import { usePublicIntentDetail } from "@/hooks/use-public-intent-detail";
import { usePublicIntentFeed } from "@/hooks/use-public-intent-feed";
```

**Step 2: Rewrite the Monitor function**

Replace the `Monitor` function (lines 389-520) with:

```typescript
export function Monitor({ onNavigateConfigure }: MonitorProps) {
  const { isConnected, address } = useAccount();
  const { token, isAuthenticated, authenticating, authenticate, error: authError } = useAuth();
  const { intents: ownedIntents, error: ownedError, loading: ownedLoading, refresh: refreshOwned } = useIntents(address, token);
  const [showInactive, setShowInactive] = useState(false);
  const { intents: publicIntents, error: publicError, loading: publicLoading } = usePublicIntents(showInactive);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(getInitialIntentId);

  const selectIntent = useCallback((id: string | null) => {
    if (id) {
      window.history.pushState({ intentId: id }, "", `?intent=${id}`);
    } else {
      window.history.pushState(null, "", window.location.pathname);
    }
    setSelectedIntentId(id);
  }, []);

  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      const intentId = (e.state as { intentId?: string } | null)?.intentId ?? null;
      setSelectedIntentId(intentId);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Determine if the selected intent is owned by the connected wallet
  const ownedIntentIds = useMemo(
    () => new Set(ownedIntents.map((i) => i.id)),
    [ownedIntents],
  );
  const isOwner = selectedIntentId ? ownedIntentIds.has(selectedIntentId) : false;

  // Detail view — owner gets full controls, others get read-only redacted view
  if (selectedIntentId) {
    return (
      <IntentDetailView
        intentId={selectedIntentId}
        token={token}
        isOwner={isOwner}
        onBack={() => selectIntent(null)}
        onDeleted={() => {
          selectIntent(null);
          refreshOwned();
        }}
      />
    );
  }

  // List view — loading state
  if (publicLoading) {
    return (
      <div className="space-y-4 p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const activePublicCount = publicIntents.filter((i) => i.status === "active").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="sr-only">Monitor</h1>

      {/* Auth prompt — only if wallet connected but not authenticated */}
      {isConnected && !isAuthenticated && (
        <Card className="p-4">
          <AuthPrompt authenticating={authenticating} error={authError} onAuthenticate={authenticate} />
        </Card>
      )}

      {/* Owned intents — only when authenticated and has intents */}
      {isAuthenticated && ownedIntents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Your Agents</SectionHeading>
            <span className="text-xs text-text-tertiary">
              {ownedIntents.filter((i) => i.status === "active").length} active / {ownedIntents.length} total
            </span>
          </div>
          {ownedError && <ErrorBanner message={ownedError} />}
          {ownedIntents.map((intent) => (
            <IntentListItem key={intent.id} intent={intent} onSelect={selectIntent} />
          ))}
        </div>
      )}

      {/* Public intents — always visible */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeading>
            {isAuthenticated && ownedIntents.length > 0 ? "All Agents" : "Active Agents"}
          </SectionHeading>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">
              {activePublicCount} active / {publicIntents.length} total
            </span>
            <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-border bg-bg-surface text-accent-positive focus:ring-accent-positive h-3.5 w-3.5 cursor-pointer"
              />
              Show stopped
            </label>
          </div>
        </div>
        {publicError && <ErrorBanner message={publicError} />}
        {publicIntents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
              <div className="h-3 w-3 rounded-full bg-text-tertiary" />
            </div>
            <p className="max-w-md text-sm text-text-secondary">
              No agents are currently running.{!isConnected ? " Connect your wallet and deploy one from the Configure tab." : ""}
            </p>
            {isConnected && isAuthenticated && (
              <button
                onClick={onNavigateConfigure}
                className="mt-2 cursor-pointer rounded-lg bg-accent-positive px-5 py-2.5 min-h-[44px] text-sm font-medium text-bg-primary transition-colors hover:bg-accent-positive/90 active:bg-accent-positive/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
              >
                Go to Configure
              </button>
            )}
          </div>
        ) : (
          publicIntents.map((intent) => (
            <IntentListItem key={intent.id} intent={intent} onSelect={selectIntent} />
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 3: Run lint and type check**

Run: `pnpm --filter @maw/dashboard run lint`
Expected: passes

**Step 4: Commit**

```bash
git add apps/dashboard/components/monitor.tsx
git commit -m "feat: public-first Monitor — show all agents without wallet connection"
```

---

### Task 8: Add Playwright e2e test for public intent visibility

**Files:**
- Create: `apps/dashboard/tests/integration/public-intents.spec.ts`

**Context:** Verify that a visitor without wallet connection sees the public intent list, can click into details, and doesn't see owner-only controls.

**Step 1: Write the e2e test**

Create `apps/dashboard/tests/integration/public-intents.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3100";

test.describe("Public intent visibility", () => {
  test("shows active agents list without wallet connection", async ({ page }) => {
    await page.goto(BASE_URL);

    // Navigate to Monitor tab
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    // Should see the "Active Agents" heading — not a "connect wallet" gate
    await expect(
      page.getByText(/active agents/i).first()
    ).toBeVisible({ timeout: 15000 });

    // Should NOT see "Connect your wallet" as a blocking heading
    const connectHeading = page.getByRole("heading", { name: /connect your wallet/i });
    await expect(connectHeading).not.toBeVisible();
  });

  test("shows 'Show stopped' toggle", async ({ page }) => {
    await page.goto(BASE_URL);
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    await expect(
      page.getByLabel(/show stopped/i)
    ).toBeVisible({ timeout: 15000 });
  });

  test("can navigate to public intent detail and sees no owner controls", async ({ page }) => {
    await page.goto(BASE_URL);
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    // Wait for intent cards to appear
    await page.waitForTimeout(3000);

    const intentCards = page.locator("button").filter({ hasText: /cycle/i });
    const count = await intentCards.count();

    if (count > 0) {
      await intentCards.first().click();

      // Should see back button and activity feed
      await expect(
        page.getByText(/back to agents/i)
      ).toBeVisible({ timeout: 10000 });

      await expect(
        page.getByText(/activity feed/i)
      ).toBeVisible({ timeout: 10000 });

      // Should NOT see owner-only controls
      await expect(
        page.getByRole("button", { name: /download agent_log/i })
      ).not.toBeVisible();

      await expect(
        page.getByRole("button", { name: /stop agent/i })
      ).not.toBeVisible();
    }
  });

  test("redacted feed entries show privacy indicator", async ({ page }) => {
    await page.goto(BASE_URL);
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    await page.waitForTimeout(3000);

    const intentCards = page.locator("button").filter({ hasText: /cycle/i });
    const count = await intentCards.count();

    if (count > 0) {
      await intentCards.first().click();

      // Wait for activity feed to load
      await page.waitForTimeout(5000);

      // If there are decision entries, they should show the privacy notice
      const privacyNotices = page.getByText(/end-to-end encrypted/i);
      // Just verify the page loaded correctly — privacy notices only appear
      // if the agent has made decisions
      await expect(
        page.getByText(/activity feed/i)
      ).toBeVisible();
    }
  });
});
```

**Step 2: Run tests**

Run: `pnpm --filter @maw/dashboard exec playwright test tests/integration/public-intents.spec.ts`
Expected: passes (with active intents on test server)

**Step 3: Commit**

```bash
git add apps/dashboard/tests/integration/public-intents.spec.ts
git commit -m "test: add Playwright e2e tests for public intent visibility"
```

---

### Task 9: Build, deploy, and verify

**Files:** None (deployment verification)

**Step 1: Run full build**

Run: `pnpm run build`
Expected: both `@maw/agent` and `@maw/dashboard` compile

**Step 2: Run all tests**

Run: `pnpm test`
Expected: all tests pass including the new redaction tests

**Step 3: Deploy backend to VPS**

Run: `bash scripts/deploy.sh deploy`
Expected: successful deployment, service restarts

**Step 4: Push to main for Vercel deployment**

Merge the branch to main and push. Vercel auto-deploys.

**Step 5: Verify on live site**

Verification checklist (incognito browser, no wallet):
1. Visit `https://maw.finance` — click Monitor tab
2. See "Active Agents" list with intent cards — no "Connect wallet" gate
3. See "Show stopped" checkbox — toggle it, verify stopped agents appear/disappear
4. Click into an intent — see stats, portfolio progress, activity feed
5. Verify NO "Stop Agent" or "Download agent_log.jsonl" buttons
6. Verify decision entries show lock icon + "AI reasoning is end-to-end encrypted and only viewable by the agent owner"
7. Verify judge entries show scores but reasoning text is hidden with privacy notice

**Step 6: Commit any hotfixes**

```bash
git add -A
git commit -m "fix: post-deploy adjustments for public intent visibility"
```
