# Activity Feed with SSE & SQLite Log Storage

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-integrate the orphaned activity feed into the intent detail view, backed by SQLite for historical queries and SSE for live streaming, with HttpOnly cookie auth.

**Architecture:** Dual-write log entries to SQLite (queryable source of truth for dashboard) and JSONL (write-only audit artifact for Protocol Labs). An in-process EventEmitter on IntentLogger notifies SSE subscribers of new entries. The frontend loads historical entries via REST on mount, then connects an EventSource for live updates. Auth uses an HttpOnly cookie set on verify, which EventSource sends automatically (same-origin).

**Tech Stack:** Hono v4.12.8 (`streamSSE` from `hono/streaming`), drizzle-orm + better-sqlite3 (WAL mode), EventEmitter from `node:events`, native `EventSource` browser API, existing React components (ActivityFeed, CycleGroup, FeedEntry, groupFeedByCycle).

---

## Task 1: Add `agent_logs` table to SQLite schema

**Files:**
- Modify: `packages/agent/src/db/schema.ts:49` (append after swaps table)
- Modify: `packages/agent/src/db/connection.ts:34-43` (add CREATE TABLE to SQL string)

**Step 1: Write the failing test**

Add to `packages/agent/src/db/__tests__/repository.test.ts` after the existing `CREATE TABLE swaps` block in `CREATE_TABLES_SQL` (line 41):

```typescript
// Add to CREATE_TABLES_SQL (after the swaps table, before the closing backtick):
  CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    timestamp TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    cycle INTEGER,
    tool TEXT,
    parameters TEXT,
    result TEXT,
    duration_ms INTEGER,
    error TEXT
  );
```

Then add a new describe block at the end of the test file:

```typescript
describe("agent_logs", () => {
  it("inserts and retrieves log entries by intent", () => {
    repo.createIntent(SAMPLE_INTENT);
    repo.insertLog({
      intentId: "test-intent-1",
      timestamp: "2026-03-18T12:00:00Z",
      sequence: 0,
      action: "cycle_complete",
      cycle: 1,
      result: JSON.stringify({ drift: 0.03 }),
    });
    repo.insertLog({
      intentId: "test-intent-1",
      timestamp: "2026-03-18T12:01:00Z",
      sequence: 1,
      action: "rebalance_decision",
      cycle: 1,
      tool: "venice-reasoning",
      result: JSON.stringify({ shouldRebalance: false, reasoning: "Low drift" }),
    });

    const logs = repo.getIntentLogs("test-intent-1");
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe("cycle_complete");
    expect(logs[1].action).toBe("rebalance_decision");
  });

  it("getIntentLogs supports afterSequence cursor", () => {
    repo.createIntent(SAMPLE_INTENT);
    for (let i = 0; i < 5; i++) {
      repo.insertLog({
        intentId: "test-intent-1",
        timestamp: `2026-03-18T12:0${i}:00Z`,
        sequence: i,
        action: `action_${i}`,
      });
    }

    const after2 = repo.getIntentLogs("test-intent-1", { afterSequence: 1 });
    expect(after2).toHaveLength(3);
    expect(after2[0].sequence).toBe(2);
  });

  it("getIntentLogs supports limit", () => {
    repo.createIntent(SAMPLE_INTENT);
    for (let i = 0; i < 10; i++) {
      repo.insertLog({
        intentId: "test-intent-1",
        timestamp: `2026-03-18T12:00:0${i}Z`,
        sequence: i,
        action: `action_${i}`,
      });
    }

    const limited = repo.getIntentLogs("test-intent-1", { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("only returns logs for the requested intent", () => {
    repo.createIntent(SAMPLE_INTENT);
    repo.createIntent({ ...SAMPLE_INTENT, id: "other" });
    repo.insertLog({
      intentId: "test-intent-1",
      timestamp: "2026-03-18T12:00:00Z",
      sequence: 0,
      action: "a",
    });
    repo.insertLog({
      intentId: "other",
      timestamp: "2026-03-18T12:00:00Z",
      sequence: 0,
      action: "b",
    });

    expect(repo.getIntentLogs("test-intent-1")).toHaveLength(1);
    expect(repo.getIntentLogs("other")).toHaveLength(1);
  });

  it("rejects log with invalid intent_id (FK constraint)", () => {
    expect(() =>
      repo.insertLog({
        intentId: "nonexistent",
        timestamp: "2026-03-18T12:00:00Z",
        sequence: 0,
        action: "test",
      }),
    ).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/db/__tests__/repository.test.ts`
Expected: FAIL — `repo.insertLog is not a function`

**Step 3: Add the drizzle schema**

In `packages/agent/src/db/schema.ts`, add after line 49:

```typescript
export const agentLogs = sqliteTable("agent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  intentId: text("intent_id")
    .notNull()
    .references(() => intents.id),
  timestamp: text("timestamp").notNull(),
  sequence: integer("sequence").notNull(),
  action: text("action").notNull(),
  cycle: integer("cycle"),
  tool: text("tool"),
  parameters: text("parameters"), // JSON blob
  result: text("result"), // JSON blob
  durationMs: integer("duration_ms"),
  error: text("error"),
});
```

In `packages/agent/src/db/connection.ts`, add to `CREATE_TABLES_SQL` after the swaps table (before the closing backtick on line 43):

```sql
  CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    timestamp TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    cycle INTEGER,
    tool TEXT,
    parameters TEXT,
    result TEXT,
    duration_ms INTEGER,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_logs_intent_seq
    ON agent_logs(intent_id, sequence);
```

**Step 4: Add repository methods**

In `packages/agent/src/db/repository.ts`:

Add import for the new table at line 4:
```typescript
import { intents, swaps, nonces, agentLogs } from "./schema.js";
```

Add types after line 10:
```typescript
type AgentLogInsert = Omit<typeof agentLogs.$inferInsert, "id">;
type AgentLogSelect = typeof agentLogs.$inferSelect;
export type { AgentLogInsert, AgentLogSelect };
```

Add methods to `IntentRepository` class (after `deleteNonce` method, before closing brace):

```typescript
  // Agent logs
  insertLog(data: AgentLogInsert): AgentLogSelect {
    const result = this.db
      .insert(agentLogs)
      .values(data)
      .returning()
      .get();
    return result;
  }

  getIntentLogs(
    intentId: string,
    opts?: { afterSequence?: number; limit?: number },
  ): AgentLogSelect[] {
    const afterSeq = opts?.afterSequence ?? -1;
    const limit = opts?.limit ?? 10_000;
    return this.db
      .select()
      .from(agentLogs)
      .where(
        and(
          eq(agentLogs.intentId, intentId),
          gt(agentLogs.sequence, afterSeq),
        ),
      )
      .orderBy(agentLogs.sequence)
      .limit(limit)
      .all();
  }
```

**Step 5: Update the test's CREATE_TABLES_SQL**

In `packages/agent/src/db/__tests__/repository.test.ts`, add the agent_logs table to the test's `CREATE_TABLES_SQL` string (after the swaps table):

```sql
  CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    timestamp TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    cycle INTEGER,
    tool TEXT,
    parameters TEXT,
    result TEXT,
    duration_ms INTEGER,
    error TEXT
  );
```

**Step 6: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/db/__tests__/repository.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```
feat(db): add agent_logs table for queryable log storage
```

---

## Task 2: Add EventEmitter and dual-write to IntentLogger

**Files:**
- Modify: `packages/agent/src/logging/intent-log.ts`
- Modify: `packages/agent/src/logging/__tests__/intent-log.test.ts`

**Step 1: Write the failing tests**

Add to `packages/agent/src/logging/__tests__/intent-log.test.ts`:

```typescript
import { onLogEntry } from "../intent-log.js";

// ... inside the existing describe("IntentLogger") block:

it("emits log events via onLogEntry", () => {
  const received: { intentId: string; entry: ReturnType<typeof logger.log> }[] = [];
  const unsub = onLogEntry((intentId, entry) => {
    received.push({ intentId, entry });
  });

  logger.log("test_event", { cycle: 1 });
  logger.log("another_event");

  unsub();

  expect(received).toHaveLength(2);
  expect(received[0].intentId).toBe(TEST_INTENT_ID);
  expect(received[0].entry.action).toBe("test_event");
  expect(received[0].entry.cycle).toBe(1);
  expect(received[1].entry.action).toBe("another_event");
});

it("unsubscribe stops receiving events", () => {
  const received: unknown[] = [];
  const unsub = onLogEntry((_id, entry) => {
    received.push(entry);
  });

  logger.log("before_unsub");
  unsub();
  logger.log("after_unsub");

  expect(received).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/logging/__tests__/intent-log.test.ts`
Expected: FAIL — `onLogEntry is not a function` (or not exported)

**Step 3: Add EventEmitter to IntentLogger**

Rewrite `packages/agent/src/logging/intent-log.ts`:

```typescript
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import type { AgentLogEntry } from "@maw/common";
import { AgentLogEntrySchema } from "@maw/common";

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

export type LogEntryListener = (intentId: string, entry: AgentLogEntry) => void;

export function onLogEntry(listener: LogEntryListener): () => void {
  logEmitter.on("log", listener);
  return () => {
    logEmitter.off("log", listener);
  };
}

export class IntentLogger {
  private sequence = 0;
  private filePath: string;

  constructor(
    private intentId: string,
    private logDir = "data/logs",
  ) {
    this.filePath = `${this.logDir}/${this.intentId}.jsonl`;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  log(
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
      sequence: this.sequence++,
      action,
      ...opts,
    };

    // Write to JSONL audit file
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.filePath, line, "utf-8");

    // Emit for SSE subscribers
    logEmitter.emit("log", this.intentId, entry);

    return entry;
  }

  readAll(): AgentLogEntry[] {
    if (!existsSync(this.filePath)) return [];

    const content = readFileSync(this.filePath, "utf-8");
    const entries: AgentLogEntry[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const result = AgentLogEntrySchema.safeParse(parsed);
        if (result.success) {
          entries.push(result.data);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  }

  getFilePath(): string {
    return this.filePath;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/logging/__tests__/intent-log.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```
feat(logging): add EventEmitter to IntentLogger for SSE notifications
```

---

## Task 3: Dual-write IntentLogger to SQLite

**Files:**
- Modify: `packages/agent/src/logging/intent-log.ts`
- Modify: `packages/agent/src/logging/__tests__/intent-log.test.ts`

**Step 1: Write the failing test**

Add a new describe block in `packages/agent/src/logging/__tests__/intent-log.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as dbSchema from "../../db/schema.js";
import { IntentRepository } from "../../db/repository.js";

// Add this SQL constant at the top level (copy from repository.test.ts, including agent_logs table)
const CREATE_TABLES_SQL = `
  CREATE TABLE nonces (
    wallet_address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE intents (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    intent_text TEXT NOT NULL,
    parsed_intent TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    permissions_context TEXT,
    delegation_manager TEXT,
    signed_delegation TEXT NOT NULL,
    delegator_smart_account TEXT NOT NULL,
    cycle INTEGER NOT NULL DEFAULT 0,
    trades_executed INTEGER NOT NULL DEFAULT 0,
    total_spent_usd REAL NOT NULL DEFAULT 0,
    last_cycle_at INTEGER,
    agent_id TEXT
  );
  CREATE TABLE swaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    tx_hash TEXT NOT NULL,
    sell_token TEXT NOT NULL,
    buy_token TEXT NOT NULL,
    sell_amount TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
  CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    timestamp TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    cycle INTEGER,
    tool TEXT,
    parameters TEXT,
    result TEXT,
    duration_ms INTEGER,
    error TEXT
  );
`;

const NOW = Math.floor(Date.now() / 1000);
const SAMPLE_INTENT = {
  id: "test-intent-123",
  walletAddress: "0x1234",
  intentText: "test",
  parsedIntent: "{}",
  status: "active" as const,
  createdAt: NOW,
  expiresAt: NOW + 86400,
  signedDelegation: "{}",
  delegatorSmartAccount: "0xabcd",
};

describe("IntentLogger with DB", () => {
  let dbLogger: IntentLogger;
  let repo: IntentRepository;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(CREATE_TABLES_SQL);
    const db = drizzle(sqlite, { schema: dbSchema });
    repo = new IntentRepository(db);
    repo.createIntent(SAMPLE_INTENT);

    dbLogger = new IntentLogger(TEST_INTENT_ID, TEST_DIR, repo);
  });

  afterEach(() => {
    sqlite.close();
    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    if (existsSync(path)) rmSync(path);
  });

  it("writes to both JSONL file and SQLite", () => {
    dbLogger.log("dual_write_test", { cycle: 3, tool: "test-tool" });

    // Check JSONL file
    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const fileContent = readFileSync(path, "utf-8").trim();
    const fileEntry = JSON.parse(fileContent);
    expect(fileEntry.action).toBe("dual_write_test");

    // Check SQLite
    const dbLogs = repo.getIntentLogs(TEST_INTENT_ID);
    expect(dbLogs).toHaveLength(1);
    expect(dbLogs[0].action).toBe("dual_write_test");
    expect(dbLogs[0].cycle).toBe(3);
    expect(dbLogs[0].tool).toBe("test-tool");
  });

  it("stores JSON blobs for parameters and result", () => {
    dbLogger.log("with_json", {
      parameters: { key: "value" },
      result: { data: [1, 2, 3] },
    });

    const dbLogs = repo.getIntentLogs(TEST_INTENT_ID);
    expect(dbLogs).toHaveLength(1);
    expect(JSON.parse(dbLogs[0].parameters!)).toEqual({ key: "value" });
    expect(JSON.parse(dbLogs[0].result!)).toEqual({ data: [1, 2, 3] });
  });

  it("works without repo (JSONL-only fallback)", () => {
    const fileOnlyLogger = new IntentLogger(TEST_INTENT_ID, TEST_DIR);
    fileOnlyLogger.log("file_only");

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const content = readFileSync(path, "utf-8").trim();
    expect(JSON.parse(content).action).toBe("file_only");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/logging/__tests__/intent-log.test.ts`
Expected: FAIL — IntentLogger constructor doesn't accept a repo parameter

**Step 3: Update IntentLogger to accept optional repo**

Modify `packages/agent/src/logging/intent-log.ts` — update the constructor and `log` method:

```typescript
import type { IntentRepository } from "../db/repository.js";

// ... (keep logEmitter, onLogEntry, LogEntryListener as-is from Task 2)

export class IntentLogger {
  private sequence = 0;
  private filePath: string;

  constructor(
    private intentId: string,
    private logDir = "data/logs",
    private repo?: IntentRepository,
  ) {
    this.filePath = `${this.logDir}/${this.intentId}.jsonl`;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  log(
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
      sequence: this.sequence++,
      action,
      ...opts,
    };

    // Write to JSONL audit file
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.filePath, line, "utf-8");

    // Write to SQLite (if repo provided)
    if (this.repo) {
      this.repo.insertLog({
        intentId: this.intentId,
        timestamp: entry.timestamp,
        sequence: entry.sequence,
        action: entry.action,
        cycle: entry.cycle ?? null,
        tool: entry.tool ?? null,
        parameters: opts?.parameters ? JSON.stringify(opts.parameters) : null,
        result: opts?.result ? JSON.stringify(opts.result) : null,
        durationMs: entry.duration_ms ?? null,
        error: entry.error ?? null,
      });
    }

    // Emit for SSE subscribers
    logEmitter.emit("log", this.intentId, entry);

    return entry;
  }

  // readAll() and getFilePath() remain unchanged
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/logging/__tests__/intent-log.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```
feat(logging): dual-write IntentLogger to SQLite and JSONL
```

---

## Task 4: Wire repo into IntentLogger in AgentWorker

**Files:**
- Modify: `packages/agent/src/agent-worker.ts:45`

**Step 1: Pass repo to IntentLogger**

In `packages/agent/src/agent-worker.ts`, change line 45 from:
```typescript
this.intentLogger = new IntentLogger(intentId);
```
to:
```typescript
this.intentLogger = new IntentLogger(intentId, "data/logs", this.deps.repo);
```

**Step 2: Update the mock in server.test.ts**

In `packages/agent/src/__tests__/server.test.ts`, update the IntentLogger mock (line 75-82) to accept 3 args:

```typescript
vi.mock("../logging/intent-log.js", () => {
  class MockLogger {
    constructor(_intentId: string, _logDir?: string, _repo?: unknown) {}
    log = vi.fn();
    readAll = vi.fn().mockReturnValue([]);
    getFilePath = vi.fn().mockReturnValue("data/logs/mock.jsonl");
  }
  return { IntentLogger: MockLogger, onLogEntry: vi.fn().mockReturnValue(() => {}) };
});
```

**Step 3: Run all tests**

Run: `pnpm --filter @maw/agent test`
Expected: ALL PASS

**Step 4: Commit**

```
feat(worker): pass repo to IntentLogger for dual-write
```

---

## Task 5: Switch REST endpoint to read from SQLite

**Files:**
- Modify: `packages/agent/src/routes/intents.ts:120-138`

**Step 1: Write the approach**

The `GET /api/intents/:id` endpoint currently creates a fresh `IntentLogger` and calls `readAll()`. Change it to query the DB via `deps.repo.getIntentLogs()`. Accept optional `after` and `limit` query params for cursor pagination.

**Step 2: Update the route**

In `packages/agent/src/routes/intents.ts`, replace lines 120-138 (the GET /:id handler):

```typescript
  // GET /:id — get intent detail
  app.get("/:id", (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const afterSeq = Number(c.req.query("after") ?? -1);
    const limit = Number(c.req.query("limit") ?? 500);

    const workerStatus = deps.workerPool.getStatus(intentId);
    const liveState = deps.workerPool.getState(intentId);
    const logs = deps.repo.getIntentLogs(intentId, {
      afterSequence: isNaN(afterSeq) ? -1 : afterSeq,
      limit: isNaN(limit) || limit < 1 ? 500 : Math.min(limit, 10_000),
    });

    return c.json({ ...intent, workerStatus, liveState, logs });
  });
```

Remove the `IntentLogger` import from the top of the file (line 12) since it's only used by the logs download endpoint now. Actually, keep it — it's still used by the GET /:id/logs download endpoint at line 169.

**Step 3: Run tests**

Run: `pnpm --filter @maw/agent test`
Expected: ALL PASS (server.test.ts mocks repo.getIntentLogs, which doesn't exist on MockRepo yet)

If tests fail because MockRepo doesn't have `getIntentLogs`, add it to the mock in `server.test.ts`:

```typescript
getIntentLogs = vi.fn().mockReturnValue([]);
```

**Step 4: Commit**

```
feat(api): switch intent detail to read logs from SQLite with cursor pagination
```

---

## Task 6: Add HttpOnly cookie to auth verify

**Files:**
- Modify: `packages/agent/src/routes/auth.ts:76-78`
- Modify: `packages/agent/src/middleware/auth.ts:10-24`
- Modify: `packages/agent/src/__tests__/server.test.ts` (add cookie auth test)

**Step 1: Write the failing test**

Add to `packages/agent/src/__tests__/server.test.ts` in the "Route dispatch" describe block:

```typescript
it("POST /api/auth/verify sets HttpOnly cookie", async () => {
  const { verifyAuthToken } = await import("../auth.js");
  (verifyAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce("0xwallet");

  const res = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: "0xwallet", signature: "0xsig" }),
  });

  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toContain("maw_token=");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Path=/api");
});

it("GET /api/intents authenticates via cookie", async () => {
  const { verifyAuthToken } = await import("../auth.js");
  (verifyAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce("0xwallet");

  const res = await app.request("/api/intents?wallet=0xwallet", {
    headers: { Cookie: "maw_token=mock-token" },
  });

  expect(res.status).toBe(200);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/__tests__/server.test.ts`
Expected: FAIL — no cookie set, cookie auth not recognized

**Step 3: Set cookie on verify response**

In `packages/agent/src/routes/auth.ts`, replace lines 76-78:

```typescript
    // Clean up nonce and issue token
    deps.repo.deleteNonce(walletLower);
    const token = createAuthToken(walletLower);

    // Set HttpOnly cookie for SSE EventSource (can't set custom headers)
    c.header(
      "Set-Cookie",
      `maw_token=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400`,
    );

    return c.json({ token });
```

**Step 4: Update auth middleware to check cookie**

Replace `packages/agent/src/middleware/auth.ts`:

```typescript
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifyAuthToken } from "../auth.js";

export type AuthEnv = {
  Variables: {
    wallet: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  // Check Authorization header first, then cookie fallback (for SSE EventSource)
  let token: string | undefined;

  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else {
    token = getCookie(c, "maw_token");
  }

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const wallet = verifyAuthToken(token);
  if (!wallet) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("wallet", wallet);
  await next();
});
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/__tests__/server.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```
feat(auth): add HttpOnly cookie on verify for SSE EventSource auth
```

---

## Task 7: Add SSE endpoint

**Files:**
- Modify: `packages/agent/src/routes/intents.ts` (add GET /:id/events route)
- Modify: `packages/agent/src/__tests__/server.test.ts` (add SSE auth test)

**Step 1: Write the failing test**

Add to `packages/agent/src/__tests__/server.test.ts`:

```typescript
describe("SSE endpoint", () => {
  it("GET /api/intents/:id/events returns 401 without auth", async () => {
    const res = await app.request("/api/intents/some-id/events");
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/__tests__/server.test.ts`
Expected: FAIL — route falls through to SPA (returns 200 HTML instead of 401)

**Step 3: Add the SSE route**

In `packages/agent/src/routes/intents.ts`, add at the top:

```typescript
import { streamSSE } from "hono/streaming";
import { onLogEntry } from "../logging/intent-log.js";
```

Add this route handler before the `GET /:id/logs` route (before line 157):

```typescript
  // GET /:id/events — SSE stream of live log entries
  app.get("/:id/events", async (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return streamSSE(c, async (stream) => {
      const unsub = onLogEntry((id, entry) => {
        if (id !== intentId) return;
        stream.writeSSE({
          data: JSON.stringify(entry),
          event: "log",
          id: String(entry.sequence),
        });
      });

      stream.onAbort(() => {
        unsub();
      });

      // Keep connection alive with heartbeat every 30s
      while (true) {
        await stream.sleep(30_000);
        await stream.writeSSE({ data: "", event: "heartbeat", id: "" });
      }
    });
  });
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- packages/agent/src/__tests__/server.test.ts`
Expected: ALL PASS

**Step 5: Update the SPA fallback HTML to list the new endpoint**

In `packages/agent/src/server.ts`, add to the API endpoint list (around line 148):

```html
<li>GET /api/intents/:id/events — SSE stream of live log entries</li>
```

**Step 6: Commit**

```
feat(api): add SSE endpoint for live intent log streaming
```

---

## Task 8: Enrich per-intent logs with missing actions

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts` (add ~8 intentLogger calls)
- Modify: `packages/agent/src/agent-loop/swap.ts` (add ~5 intentLogger calls)
- Modify: `packages/agent/src/agent-loop/market-data.ts` (add intentLogger pass-through)

**Step 1: Plan the additions**

Currently per-intent log only gets: `worker_start`, `worker_stop`, `worker_error`, `cycle_complete`, `rebalance_decision`, `swap_executed`, `judge_completed`.

Missing (only go to global log): `privacy_guarantee`, `erc8004_register`, `erc8004_register_failed`, `adversarial_check`, `delegation_created`, `delegation_failed`, `audit_report`, `cycle_error`, `price_fetch`, `portfolio_check`, `budget_check`, `pool_data_fetch`, `safety_block`, `quote_received`, `permit2_approval`, `delegation_caveat_enforced`, `delegation_redeem_failed`, `swap_failed`, `judge_started`, `judge_failed`.

**Step 2: Add intentLogger calls in index.ts**

After each `logAction(...)` call in the initialization phase, add a corresponding `config.intentLogger?.log(...)` call. These are one-liners. Add after each of the following lines:

After line 142 (privacy_guarantee):
```typescript
config.intentLogger?.log("privacy_guarantee", {
  tool: "venice-inference",
  result: { provider: "venice.ai", dataRetention: "none", modelsUsed: [FAST_MODEL, RESEARCH_MODEL, REASONING_MODEL] },
});
```

After line 151 (erc8004_register from DB):
```typescript
config.intentLogger?.log("erc8004_register", {
  tool: "erc8004-identity",
  result: { agentId: config.existingAgentId!.toString(), source: "database" },
});
```

After line 170 (erc8004_register new):
```typescript
config.intentLogger?.log("erc8004_register", {
  tool: "erc8004-identity",
  result: { txHash, agentId: agentId?.toString() },
});
```

After line 175 (erc8004_register_failed):
```typescript
config.intentLogger?.log("erc8004_register_failed", {
  tool: "erc8004-identity",
  error: err instanceof Error ? err.message : String(err),
});
```

After line 203 (adversarial_check):
```typescript
config.intentLogger?.log("adversarial_check", {
  result: { warnings: warnings.map((w) => w.message) },
});
```

After line 229 (delegation_created):
```typescript
config.intentLogger?.log("delegation_created", {
  tool: "metamask-delegation",
  duration_ms: Date.now() - startDelegation,
  result: { delegate: agentAddress, caveatsCount: "caveats" in state.delegation && Array.isArray(state.delegation.caveats) ? state.delegation.caveats.length : 0 },
});
```

After line 235 (delegation_failed):
```typescript
config.intentLogger?.log("delegation_failed", { error: msg });
```

After line 253 (audit_report):
```typescript
config.intentLogger?.log("audit_report", {
  result: { allows: report.allows, prevents: report.prevents, worstCase: report.worstCase, warnings: report.warnings },
});
```

After line 278 (cycle_error):
```typescript
config.intentLogger?.log("cycle_error", {
  cycle: state.cycle,
  error: msg,
});
```

**Step 3: Add intentLogger calls in swap.ts**

The swap module needs access to `config.intentLogger`. It already has it via `config: AgentConfig`.

After line 64 (safety_block budget):
```typescript
config.intentLogger?.log("safety_block", {
  cycle: state.cycle,
  result: { reason: "budget_exceeded", swapAmountUsd },
});
```

After line 73 (safety_block trade limit):
```typescript
config.intentLogger?.log("safety_block", {
  cycle: state.cycle,
  result: { reason: "trade_limit_reached" },
});
```

After line 126 (permit2_approval):
```typescript
config.intentLogger?.log("permit2_approval", {
  cycle: state.cycle,
  tool: "uniswap-permit2",
  result: { txHash: approvalTx, token: swap.sellToken },
});
```

After line 158 (quote_received):
```typescript
config.intentLogger?.log("quote_received", {
  cycle: state.cycle,
  tool: "uniswap-trading-api",
  duration_ms: Date.now() - startQuote,
  result: { input: quote.quote.input, output: quote.quote.output, viaDelegation: !!canUseDelegation },
});
```

After line 216 (delegation_caveat_enforced):
```typescript
config.intentLogger?.log("delegation_caveat_enforced", {
  cycle: state.cycle,
  tool: "metamask-delegation",
  result: { enforcer: delegationMsg, action: "fallback_to_direct_tx" },
});
```

After line 223 (delegation_redeem_failed):
```typescript
config.intentLogger?.log("delegation_redeem_failed", {
  cycle: state.cycle,
  tool: "metamask-delegation",
  error: delegationMsg,
});
```

After line 341 (judge_started):
```typescript
config.intentLogger?.log("judge_started", { cycle: currentCycle, tool: "venice-judge" });
```

After line 380 (judge_failed):
```typescript
config.intentLogger?.log("judge_failed", {
  cycle: currentCycle,
  tool: "venice-judge",
  error: judgeErr instanceof Error ? judgeErr.message : String(judgeErr),
});
```

After line 395 (swap_failed):
```typescript
config.intentLogger?.log("swap_failed", {
  cycle: state.cycle,
  tool: "uniswap-trading-api",
  error: msg,
  duration_ms: Date.now() - startQuote,
});
```

**Step 4: Add intentLogger pass-through in market-data.ts**

Update `gatherMarketData` signature to accept optional intentLogger:

```typescript
import type { IntentLogger } from "../logging/intent-log.js";

export async function gatherMarketData(
  chainId: number,
  agentAddress: Address,
  cycle: number,
  intentLogger?: IntentLogger,
): Promise<MarketData> {
```

After each `logAction(...)` in market-data.ts, add:
```typescript
intentLogger?.log("price_fetch", { cycle, tool: "venice-web-search", duration_ms: Date.now() - startPrice, result: { price: ethPrice.price } });
```
(And similarly for `portfolio_check`, `budget_check`, `pool_data_fetch`.)

Update the call site in `index.ts` `runCycle()` (line 443):
```typescript
const market = await gatherMarketData(config.chainId, agentAddress, state.cycle, config.intentLogger);
```

**Step 5: Run tests**

Run: `pnpm --filter @maw/agent test`
Expected: ALL PASS (the agent-loop tests mock everything, so the new optional calls are no-ops)

**Step 6: Commit**

```
feat(logging): enrich per-intent logs with all action types
```

---

## Task 9: Add `useIntentFeed` frontend hook

**Files:**
- Create: `apps/dashboard/hooks/use-intent-feed.ts`
- Modify: `apps/dashboard/lib/api.ts:91-100` (type the logs field)

**Step 1: Update API types**

In `apps/dashboard/lib/api.ts`, change line 94:

```typescript
export async function fetchIntentDetail(
  intentId: string,
  token: string,
): Promise<IntentRecord & { logs: AgentLogEntry[]; liveState: unknown }> {
```

Add `AgentLogEntry` to the import on line 6:
```typescript
import type { ParsedIntent, AuditReport, IntentRecord, AgentLogEntry } from "@maw/common";
```

**Step 2: Create the hook**

Create `apps/dashboard/hooks/use-intent-feed.ts`:

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLogEntry } from "@maw/common";
import { fetchIntentDetail } from "@/lib/api";

export function useIntentFeed(
  intentId: string | null,
  token: string | null,
) {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const maxSeqRef = useRef(-1);
  const esRef = useRef<EventSource | null>(null);

  const loadHistorical = useCallback(async () => {
    if (!intentId || !token) return;
    try {
      const data = await fetchIntentDetail(intentId, token);
      const logs = data.logs ?? [];
      setEntries(logs);
      maxSeqRef.current = logs.length > 0
        ? Math.max(...logs.map((e) => e.sequence))
        : -1;
    } finally {
      setLoading(false);
    }
  }, [intentId, token]);

  useEffect(() => {
    if (!intentId || !token) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadHistorical();

    // Connect SSE for live updates
    const es = new EventSource(`/api/intents/${intentId}/events`);
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const entry = JSON.parse(e.data) as AgentLogEntry;
        setEntries((prev) => {
          // Deduplicate by sequence
          if (prev.some((p) => p.sequence === entry.sequence)) return prev;
          return [...prev, entry];
        });
        if (entry.sequence > maxSeqRef.current) {
          maxSeqRef.current = entry.sequence;
        }
      } catch {
        // Skip malformed SSE data
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects. On reconnect we may have missed entries,
      // so reload historical data to fill gaps.
      loadHistorical();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [intentId, token, loadHistorical]);

  return { entries, loading };
}
```

**Step 3: Verify it compiles**

Run: `pnpm --filter @maw/dashboard build` (or `pnpm --filter @maw/dashboard lint`)
Expected: No type errors

**Step 4: Commit**

```
feat(dashboard): add useIntentFeed hook with REST + SSE
```

---

## Task 10: Update `useIntentDetail` types

**Files:**
- Modify: `apps/dashboard/hooks/use-intent-detail.ts:6-8`

**Step 1: Fix the types**

Change lines 6-9:

```typescript
import type { AgentLogEntry } from "@maw/common";

export interface IntentDetail extends IntentRecord {
  logs: AgentLogEntry[];
  liveState: unknown;
}
```

**Step 2: Verify it compiles**

Run: `pnpm --filter @maw/dashboard lint`
Expected: No type errors

**Step 3: Commit**

```
fix(dashboard): type IntentDetail.logs as AgentLogEntry[]
```

---

## Task 11: Wire ActivityFeed into IntentDetailView

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx:88-261`

**Step 1: Add imports**

At the top of `monitor.tsx`, add:

```typescript
import type { AgentLogEntry } from "@maw/common";
import { useIntentFeed } from "@/hooks/use-intent-feed";
import { ActivityFeed } from "./activity-feed";
```

**Step 2: Add the feed hook and component**

In the `IntentDetailView` function (line 88), add the hook call after the existing hooks:

```typescript
const { entries: feed } = useIntentFeed(intentId, token);
```

Then add the `ActivityFeed` component in the JSX. Insert it after the Stats grid (after the closing `</div>` of the grid at ~line 211) and before the Target Allocation card:

```tsx
{/* Activity Feed */}
<ActivityFeed feed={feed} />
```

**Step 3: Verify it renders**

Run: `pnpm run dev:dashboard` and navigate to Monitor > select an intent.
Expected: Activity Feed card appears between stats and allocation.

**Step 4: Run lint**

Run: `pnpm --filter @maw/dashboard lint`
Expected: No errors

**Step 5: Commit**

```
feat(dashboard): re-integrate activity feed into intent detail view
```

---

## Task 12: Update dashboard auth to send credentials for cookie

**Files:**
- Modify: `apps/dashboard/lib/api.ts`

**Step 1: Add credentials to verify call**

In `apps/dashboard/lib/api.ts`, update `verifySignature` (line 23) to include credentials:

```typescript
export async function verifySignature(
  wallet: string,
  signature: string,
): Promise<string> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Auth verification failed");
  const data = await res.json();
  return data.token;
}
```

Also add `credentials: "include"` to all other authenticated fetch calls (`fetchIntents`, `fetchIntentDetail`, `deleteIntent`, `createIntent`) so the cookie is sent alongside the Bearer token. This ensures both auth methods work.

**Step 2: Verify it compiles**

Run: `pnpm --filter @maw/dashboard lint`
Expected: No errors

**Step 3: Commit**

```
feat(dashboard): include credentials on fetch for cookie auth
```

---

## Task 13: Update CORS to allow credentials

**Files:**
- Modify: `packages/agent/src/server.ts:50-57`

**Step 1: Update CORS config**

When `credentials: "include"` is used, the server can't use `origin: "*"`. Update the CORS config:

```typescript
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
```

This reflects the request origin back (required for credentials) and sets `Access-Control-Allow-Credentials: true`.

**Step 2: Run tests**

Run: `pnpm --filter @maw/agent test`
Expected: ALL PASS (update CORS test expectations if needed — the origin header will now mirror the request)

**Step 3: Commit**

```
fix(server): update CORS to support credentials for cookie auth
```

---

## Task 14: Add `feedEntry` label for new action types

**Files:**
- Modify: `apps/dashboard/components/feed-entry.tsx` (check label coverage)

**Step 1: Verify label coverage**

Read `apps/dashboard/components/feed-entry.tsx` and check that `getEntryLabel()` has entries for all action types that now flow through per-intent logs. The function already has 20+ labels. Check against the full list from Task 8.

Missing labels to add if not present:
```typescript
privacy_guarantee: "Privacy Guarantee",
budget_check: "Budget Check",
worker_start: "Worker Start",
worker_stop: "Worker Stop",
worker_error: "Worker Error",
judge_started: "Judge Started",
judge_failed: "Judge Failed",
delegation_caveat_enforced: "Caveat Enforced",
delegation_redeem_failed: "Delegation Failed",
```

**Step 2: Run lint**

Run: `pnpm --filter @maw/dashboard lint`
Expected: No errors

**Step 3: Commit**

```
feat(dashboard): add feed entry labels for all per-intent action types
```

---

## Task 15: Update API_PATHS constant

**Files:**
- Modify: `packages/common/src/constants.ts:15-20`

**Step 1: Add the new path**

```typescript
export const API_PATHS = Object.freeze({
  authNonce: "/api/auth/nonce",
  authVerify: "/api/auth/verify",
  parseIntent: "/api/parse-intent",
  intents: "/api/intents",
  intentEvents: "/api/intents/:id/events",
} as const);
```

**Step 2: Run build**

Run: `pnpm run build`
Expected: ALL PASS

**Step 3: Commit**

```
feat(common): add intentEvents path to API_PATHS
```

---

## Task 16: End-to-end verification

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 2: Run type check**

Run: `pnpm run lint`
Expected: No errors

**Step 3: Run build**

Run: `pnpm run build`
Expected: Clean build

**Step 4: Manual smoke test**

1. Start the server: `pnpm run serve`
2. Open the dashboard
3. Connect wallet, create an intent
4. Navigate to Monitor > select the intent
5. Verify:
   - Activity feed shows initialization entries (worker_start, delegation_created, audit_report)
   - As cycles run, new entries appear in real-time (no page refresh)
   - Cycle groups are collapsible, most recent is expanded
   - Error entries show in red
   - Rebalance decisions show Hold/Rebalance badge with reasoning
   - Swaps show Etherscan links
6. Open browser DevTools > Network tab, filter EventStream
   - Verify SSE connection to `/api/intents/:id/events`
   - Verify heartbeat events every 30s
   - Verify log events arrive in real-time

**Step 5: Final commit**

```
test: verify activity feed with SSE end-to-end
```
