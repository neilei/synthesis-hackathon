# Intent Persistence & Multi-Wallet Agent System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SQLite persistence, multi-agent worker pool, browser-side MetaMask delegation signing, and wallet-scoped REST API so configured intents survive server restarts and multiple wallets can run agents concurrently.

**Architecture:** SQLite (drizzle-orm + better-sqlite3) stores intents, delegations, and execution state. A WorkerPool manages N concurrent agent loops with configurable concurrency. The frontend gains wagmi wallet connection and MetaMask delegation signing (ERC-7715 for demo + createDelegation for real Uniswap execution). Auth uses nonce signing. Per-intent JSONL log files replace the singleton agent_log.jsonl.

**Tech Stack:** drizzle-orm, better-sqlite3, wagmi, viem, @metamask/smart-accounts-kit, nanoid, vitest, Playwright

**Design doc:** `docs/plans/2026-03-16-intent-persistence-design.md`

---

## Phase 1: Foundation (No Breaking Changes)

Phase 1 adds the persistence layer and worker pool alongside the existing singleton agent. Nothing breaks — old endpoints keep working.

---

### Task 1.1: Add SQLite dependencies to packages/agent

**Files:**
- Modify: `packages/agent/package.json`

**Step 1: Install dependencies**

Run:
```bash
cd /Users/adoll/projects/synthesis-hackathon
pnpm --filter @veil/agent add drizzle-orm better-sqlite3 nanoid
pnpm --filter @veil/agent add -D drizzle-kit @types/better-sqlite3
```

**Step 2: Add drizzle config**

Create `packages/agent/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/veil.db",
  },
});
```

**Step 3: Create data directory with .gitkeep**

Run:
```bash
mkdir -p packages/agent/data/logs
touch packages/agent/data/.gitkeep
echo 'data/*.db' >> packages/agent/.gitignore
echo 'data/logs/*.jsonl' >> packages/agent/.gitignore
```

**Step 4: Verify build**

Run: `pnpm --filter @veil/agent build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/package.json packages/agent/drizzle.config.ts packages/agent/data/.gitkeep packages/agent/.gitignore pnpm-lock.yaml
git commit -m "chore(agent): add drizzle-orm, better-sqlite3, nanoid dependencies"
```

---

### Task 1.2: Create database schema

**Files:**
- Create: `packages/agent/src/db/schema.ts`

**Step 1: Create the schema file**

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const nonces = sqliteTable("nonces", {
  walletAddress: text("wallet_address").primaryKey(),
  nonce: text("nonce").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const intents = sqliteTable("intents", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  intentText: text("intent_text").notNull(),
  parsedIntent: text("parsed_intent").notNull(), // JSON
  status: text("status", {
    enum: ["active", "paused", "completed", "expired", "cancelled"],
  }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),

  // ERC-7715 demo
  permissionsContext: text("permissions_context"),
  delegationManager: text("delegation_manager"),

  // Real delegation
  signedDelegation: text("signed_delegation").notNull(), // JSON
  delegatorSmartAccount: text("delegator_smart_account").notNull(),

  // Execution state
  cycle: integer("cycle").notNull().default(0),
  tradesExecuted: integer("trades_executed").notNull().default(0),
  totalSpentUsd: real("total_spent_usd").notNull().default(0),
  lastCycleAt: integer("last_cycle_at", { mode: "number" }),

  // ERC-8004
  agentId: text("agent_id"),
});

export const swaps = sqliteTable("swaps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  intentId: text("intent_id")
    .notNull()
    .references(() => intents.id),
  txHash: text("tx_hash").notNull(),
  sellToken: text("sell_token").notNull(),
  buyToken: text("buy_token").notNull(),
  sellAmount: text("sell_amount").notNull(),
  status: text("status").notNull(),
  timestamp: text("timestamp").notNull(),
});
```

**Step 2: Verify build**

Run: `pnpm --filter @veil/agent build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/db/schema.ts
git commit -m "feat(agent): add SQLite schema for intents, swaps, nonces"
```

---

### Task 1.3: Create database connection and repository

**Files:**
- Create: `packages/agent/src/db/connection.ts`
- Create: `packages/agent/src/db/repository.ts`
- Create: `packages/agent/src/db/__tests__/repository.test.ts`

**Step 1: Write the failing tests**

Create `packages/agent/src/db/__tests__/repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../schema.js";
import { IntentRepository } from "../repository.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // Create tables directly for in-memory testing
  sqlite.exec(`
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
  `);
  return { db, sqlite };
}

const SAMPLE_INTENT = {
  id: "test-intent-1",
  walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
  intentText: "60/40 ETH/USDC, $200/day, 7 days",
  parsedIntent: JSON.stringify({
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  }),
  status: "active" as const,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
  signedDelegation: JSON.stringify({ mock: "delegation" }),
  delegatorSmartAccount: "0xabcdef1234567890abcdef1234567890abcdef12",
};

describe("IntentRepository", () => {
  let repo: IntentRepository;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    repo = new IntentRepository(testDb.db);
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("createIntent", () => {
    it("inserts and returns an intent", () => {
      const result = repo.createIntent(SAMPLE_INTENT);
      expect(result.id).toBe("test-intent-1");
      expect(result.status).toBe("active");
    });
  });

  describe("getIntent", () => {
    it("returns null for non-existent intent", () => {
      expect(repo.getIntent("nonexistent")).toBeNull();
    });

    it("returns the intent by id", () => {
      repo.createIntent(SAMPLE_INTENT);
      const found = repo.getIntent("test-intent-1");
      expect(found).not.toBeNull();
      expect(found!.walletAddress).toBe(SAMPLE_INTENT.walletAddress);
    });
  });

  describe("getIntentsByWallet", () => {
    it("returns empty array for unknown wallet", () => {
      expect(repo.getIntentsByWallet("0xunknown")).toEqual([]);
    });

    it("returns intents for a wallet", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({ ...SAMPLE_INTENT, id: "test-intent-2" });
      const results = repo.getIntentsByWallet(SAMPLE_INTENT.walletAddress);
      expect(results).toHaveLength(2);
    });
  });

  describe("getActiveIntents", () => {
    it("returns only active non-expired intents", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "expired",
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      });
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "cancelled",
        status: "cancelled",
      });
      const active = repo.getActiveIntents();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("test-intent-1");
    });
  });

  describe("updateIntentStatus", () => {
    it("updates the status", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.updateIntentStatus("test-intent-1", "cancelled");
      const found = repo.getIntent("test-intent-1");
      expect(found!.status).toBe("cancelled");
    });
  });

  describe("updateIntentCycleState", () => {
    it("updates cycle, trades, and spent", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.updateIntentCycleState("test-intent-1", {
        cycle: 5,
        tradesExecuted: 2,
        totalSpentUsd: 150.5,
        lastCycleAt: Math.floor(Date.now() / 1000),
      });
      const found = repo.getIntent("test-intent-1");
      expect(found!.cycle).toBe(5);
      expect(found!.tradesExecuted).toBe(2);
      expect(found!.totalSpentUsd).toBeCloseTo(150.5);
    });
  });

  describe("markExpiredIntents", () => {
    it("marks past-expiry active intents as expired", () => {
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "should-expire",
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      });
      const count = repo.markExpiredIntents();
      expect(count).toBe(1);
      const found = repo.getIntent("should-expire");
      expect(found!.status).toBe("expired");
    });
  });

  describe("swaps", () => {
    it("inserts and retrieves swaps for an intent", () => {
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
      expect(swaps).toHaveLength(1);
      expect(swaps[0].txHash).toBe("0xabc");
    });
  });

  describe("nonces", () => {
    it("creates and retrieves a nonce", () => {
      repo.upsertNonce("0xwallet", "random-nonce-123");
      const nonce = repo.getNonce("0xwallet");
      expect(nonce).not.toBeNull();
      expect(nonce!.nonce).toBe("random-nonce-123");
    });

    it("deletes a nonce", () => {
      repo.upsertNonce("0xwallet", "random-nonce-123");
      repo.deleteNonce("0xwallet");
      expect(repo.getNonce("0xwallet")).toBeNull();
    });

    it("upserts overwrites existing nonce", () => {
      repo.upsertNonce("0xwallet", "first");
      repo.upsertNonce("0xwallet", "second");
      const nonce = repo.getNonce("0xwallet");
      expect(nonce!.nonce).toBe("second");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- src/db/__tests__/repository.test.ts`
Expected: FAIL — module not found

**Step 3: Create connection module**

Create `packages/agent/src/db/connection.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbPath = "data/veil.db"): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");

  // Auto-create tables if they don't exist
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS nonces (
      wallet_address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intents (
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
    CREATE TABLE IF NOT EXISTS swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_id TEXT NOT NULL REFERENCES intents(id),
      tx_hash TEXT NOT NULL,
      sell_token TEXT NOT NULL,
      buy_token TEXT NOT NULL,
      sell_amount TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
```

**Step 4: Create repository module**

Create `packages/agent/src/db/repository.ts`:

```typescript
import { eq, and, gt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { intents, swaps, nonces } from "./schema.js";

type IntentInsert = typeof intents.$inferInsert;
type IntentSelect = typeof intents.$inferSelect;
type SwapInsert = Omit<typeof swaps.$inferInsert, "id">;
type SwapSelect = typeof swaps.$inferSelect;
type NonceSelect = typeof nonces.$inferSelect;

export class IntentRepository {
  constructor(private db: BetterSQLite3Database<typeof schema>) {}

  createIntent(data: IntentInsert): IntentSelect {
    this.db.insert(intents).values(data).run();
    return this.getIntent(data.id)!;
  }

  getIntent(id: string): IntentSelect | null {
    const rows = this.db.select().from(intents).where(eq(intents.id, id)).all();
    return rows[0] ?? null;
  }

  getIntentsByWallet(walletAddress: string): IntentSelect[] {
    return this.db
      .select()
      .from(intents)
      .where(eq(intents.walletAddress, walletAddress))
      .all();
  }

  getActiveIntents(): IntentSelect[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db
      .select()
      .from(intents)
      .where(and(eq(intents.status, "active"), gt(intents.expiresAt, now)))
      .all();
  }

  updateIntentStatus(id: string, status: IntentSelect["status"]): void {
    this.db.update(intents).set({ status }).where(eq(intents.id, id)).run();
  }

  updateIntentCycleState(
    id: string,
    state: {
      cycle: number;
      tradesExecuted: number;
      totalSpentUsd: number;
      lastCycleAt: number;
    },
  ): void {
    this.db.update(intents).set(state).where(eq(intents.id, id)).run();
  }

  updateIntentAgentId(id: string, agentId: string): void {
    this.db.update(intents).set({ agentId }).where(eq(intents.id, id)).run();
  }

  markExpiredIntents(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db
      .update(intents)
      .set({ status: "expired" })
      .where(and(eq(intents.status, "active"), gt(now, intents.expiresAt)))
      .run();
    return result.changes;
  }

  // Swaps
  insertSwap(data: SwapInsert): void {
    this.db.insert(swaps).values(data).run();
  }

  getSwapsByIntent(intentId: string): SwapSelect[] {
    return this.db
      .select()
      .from(swaps)
      .where(eq(swaps.intentId, intentId))
      .all();
  }

  // Nonces
  upsertNonce(walletAddress: string, nonce: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .insert(nonces)
      .values({ walletAddress, nonce, createdAt: now })
      .onConflictDoUpdate({
        target: nonces.walletAddress,
        set: { nonce, createdAt: now },
      })
      .run();
  }

  getNonce(walletAddress: string): NonceSelect | null {
    const rows = this.db
      .select()
      .from(nonces)
      .where(eq(nonces.walletAddress, walletAddress))
      .all();
    return rows[0] ?? null;
  }

  deleteNonce(walletAddress: string): void {
    this.db.delete(nonces).where(eq(nonces.walletAddress, walletAddress)).run();
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @veil/agent test -- src/db/__tests__/repository.test.ts`
Expected: PASS

**Step 6: Verify build**

Run: `pnpm --filter @veil/agent build`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/agent/src/db/
git commit -m "feat(agent): add SQLite database schema, connection, and repository with tests"
```

---

### Task 1.4: Extract delegation builder pure functions to @veil/common

**Files:**
- Create: `packages/common/src/delegation.ts`
- Create: `packages/common/src/__tests__/delegation.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/common/package.json` (add viem peer dep)

The audit generation and delegation-parameter computation functions need to move to common so the frontend can use them. These are pure functions — no network calls, no MetaMask SDK (that stays in agent/dashboard).

**Step 1: Add viem as peer dependency to common**

Run:
```bash
pnpm --filter @veil/common add viem
```

**Step 2: Write the failing tests**

Create `packages/common/src/__tests__/delegation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
  generateAuditReport,
} from "../delegation.js";
import type { ParsedIntent } from "../schemas.js";

const SAMPLE_INTENT: ParsedIntent = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  maxTradesPerDay: 10,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

describe("computeMaxValueWei", () => {
  it("computes max ETH value in wei using conservative price", () => {
    // (200 * 7) / 500 = 2.8 ETH = 2.8e18 wei
    const result = computeMaxValueWei(200, 7);
    expect(result).toBe(BigInt("2800000000000000000"));
  });

  it("accepts custom conservative price", () => {
    // (200 * 7) / 1000 = 1.4 ETH
    const result = computeMaxValueWei(200, 7, 1000);
    expect(result).toBe(BigInt("1400000000000000000"));
  });
});

describe("computeExpiryTimestamp", () => {
  it("computes expiry as now + days * 86400", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = computeExpiryTimestamp(7);
    // Should be within 2 seconds of expected
    expect(result).toBeGreaterThanOrEqual(now + 7 * 86400 - 2);
    expect(result).toBeLessThanOrEqual(now + 7 * 86400 + 2);
  });
});

describe("computeMaxCalls", () => {
  it("computes total calls from trades per day and days", () => {
    expect(computeMaxCalls(10, 7)).toBe(70);
  });
});

describe("generateAuditReport", () => {
  it("generates allows list", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.allows.length).toBeGreaterThan(0);
    expect(report.allows.some((a) => a.includes("$200"))).toBe(true);
  });

  it("generates prevents list", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.prevents.length).toBeGreaterThan(0);
    expect(report.prevents.some((p) => p.includes("$1,400"))).toBe(true);
  });

  it("generates worst case", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.worstCase).toContain("$1,400");
  });

  it("returns empty warnings for safe intents", () => {
    const report = generateAuditReport(SAMPLE_INTENT);
    expect(report.warnings).toEqual([]);
  });

  it("warns for high daily budget", () => {
    const report = generateAuditReport({
      ...SAMPLE_INTENT,
      dailyBudgetUsd: 5000,
    });
    expect(report.warnings.some((w) => w.includes("budget"))).toBe(true);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm --filter @veil/common test -- src/__tests__/delegation.test.ts`
Expected: FAIL — module not found

**Step 4: Create delegation.ts**

Create `packages/common/src/delegation.ts`:

```typescript
import type { ParsedIntent, AuditReport } from "./schemas.js";

const CONSERVATIVE_ETH_PRICE_USD = 500;
const SECONDS_PER_DAY = 86_400;
const SAFETY_MAX_DAILY_BUDGET_USD = 1_000;
const SAFETY_MAX_TIME_WINDOW_DAYS = 30;
const SAFETY_MAX_SLIPPAGE = 0.02;

export function computeMaxValueWei(
  dailyBudgetUsd: number,
  timeWindowDays: number,
  conservativeEthPrice = CONSERVATIVE_ETH_PRICE_USD,
): bigint {
  const totalBudgetEth =
    (dailyBudgetUsd * timeWindowDays) / conservativeEthPrice;
  return BigInt(Math.ceil(totalBudgetEth * 1e18));
}

export function computeExpiryTimestamp(timeWindowDays: number): number {
  return Math.floor(Date.now() / 1000) + timeWindowDays * SECONDS_PER_DAY;
}

export function computeMaxCalls(
  maxTradesPerDay: number,
  timeWindowDays: number,
): number {
  return maxTradesPerDay * timeWindowDays;
}

export interface AdversarialWarning {
  field: string;
  value: number;
  threshold: number;
  message: string;
}

export function detectAdversarialIntent(
  intent: ParsedIntent,
): AdversarialWarning[] {
  const warnings: AdversarialWarning[] = [];
  if (intent.dailyBudgetUsd > SAFETY_MAX_DAILY_BUDGET_USD) {
    warnings.push({
      field: "dailyBudgetUsd",
      value: intent.dailyBudgetUsd,
      threshold: SAFETY_MAX_DAILY_BUDGET_USD,
      message: `Daily budget $${intent.dailyBudgetUsd} exceeds safety threshold of $${SAFETY_MAX_DAILY_BUDGET_USD}`,
    });
  }
  if (intent.timeWindowDays > SAFETY_MAX_TIME_WINDOW_DAYS) {
    warnings.push({
      field: "timeWindowDays",
      value: intent.timeWindowDays,
      threshold: SAFETY_MAX_TIME_WINDOW_DAYS,
      message: `Time window ${intent.timeWindowDays} days exceeds safety threshold of ${SAFETY_MAX_TIME_WINDOW_DAYS} days`,
    });
  }
  if (intent.maxSlippage > SAFETY_MAX_SLIPPAGE) {
    warnings.push({
      field: "maxSlippage",
      value: intent.maxSlippage,
      threshold: SAFETY_MAX_SLIPPAGE,
      message: `Max slippage ${(intent.maxSlippage * 100).toFixed(1)}% exceeds safety threshold of ${(SAFETY_MAX_SLIPPAGE * 100).toFixed(1)}%`,
    });
  }
  return warnings;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function generateAuditReport(intent: ParsedIntent): AuditReport {
  const totalBudget = intent.dailyBudgetUsd * intent.timeWindowDays;
  const totalTrades = intent.maxTradesPerDay * intent.timeWindowDays;
  const slippagePct = (intent.maxSlippage * 100).toFixed(1);
  const driftPct = (intent.driftThreshold * 100).toFixed(1);

  const allocSummary = Object.entries(intent.targetAllocation)
    .map(([token, pct]) => `${token}: ${(pct * 100).toFixed(0)}%`)
    .join(", ");

  const allows = [
    `Trade up to ${formatUsd(intent.dailyBudgetUsd)}/day for ${intent.timeWindowDays} days`,
    `Maximum ${intent.maxTradesPerDay} trades per day (${totalTrades} total)`,
    `Slippage up to ${slippagePct}%`,
    `Rebalance when drift exceeds ${driftPct}%`,
    `Target allocation: ${allocSummary}`,
  ];

  const expiryDate = new Date(
    Date.now() + intent.timeWindowDays * SECONDS_PER_DAY * 1000,
  );
  const expiryStr = expiryDate.toISOString().split("T")[0];

  const prevents = [
    `Spending more than ${formatUsd(totalBudget)} total`,
    `More than ${totalTrades} trades over the full period`,
    `Any activity after ${expiryStr}`,
    `Transfers to non-approved contract targets`,
    `Trading tokens outside the delegation scope`,
  ];

  const maxSlippageLoss = totalBudget * intent.maxSlippage;
  const worstCase = `Maximum possible loss: ${formatUsd(totalBudget)} principal + ${formatUsd(maxSlippageLoss)} slippage = ${formatUsd(totalBudget + maxSlippageLoss)} over ${intent.timeWindowDays} days`;

  const adversarial = detectAdversarialIntent(intent);
  const warnings = adversarial.map((w) => w.message);

  return { allows, prevents, worstCase, warnings };
}
```

**Step 5: Export from index.ts**

Add to `packages/common/src/index.ts`:

```typescript
export {
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
  detectAdversarialIntent,
  generateAuditReport,
  type AdversarialWarning,
} from "./delegation.js";
```

**Step 6: Run tests**

Run: `pnpm --filter @veil/common test -- src/__tests__/delegation.test.ts`
Expected: PASS

**Step 7: Build full monorepo to verify**

Run: `turbo run build`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/common/src/delegation.ts packages/common/src/__tests__/delegation.test.ts packages/common/src/index.ts packages/common/package.json pnpm-lock.yaml
git commit -m "feat(common): extract delegation builder and audit generation pure functions"
```

---

### Task 1.5: Create per-intent logger

**Files:**
- Create: `packages/agent/src/logging/intent-log.ts`
- Create: `packages/agent/src/logging/__tests__/intent-log.test.ts`

This creates a per-intent logger that writes to `data/logs/{intentId}.jsonl` instead of the singleton `agent_log.jsonl`.

**Step 1: Write the failing tests**

Create `packages/agent/src/logging/__tests__/intent-log.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { IntentLogger } from "../intent-log.js";

const TEST_DIR = "data/logs";
const TEST_INTENT_ID = "test-intent-123";

describe("IntentLogger", () => {
  let logger: IntentLogger;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    logger = new IntentLogger(TEST_INTENT_ID, TEST_DIR);
  });

  afterEach(() => {
    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    if (existsSync(path)) rmSync(path);
  });

  it("writes a log entry to the intent-specific JSONL file", () => {
    logger.log("test_action", { tool: "test-tool" });

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const content = readFileSync(path, "utf-8").trim();
    const entry = JSON.parse(content);

    expect(entry.action).toBe("test_action");
    expect(entry.tool).toBe("test-tool");
    expect(entry.timestamp).toBeDefined();
    expect(entry.sequence).toBe(0);
  });

  it("increments sequence number", () => {
    logger.log("first");
    logger.log("second");

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(JSON.parse(lines[0]).sequence).toBe(0);
    expect(JSON.parse(lines[1]).sequence).toBe(1);
  });

  it("includes cycle when provided", () => {
    logger.log("cycle_action", { cycle: 5 });

    const path = `${TEST_DIR}/${TEST_INTENT_ID}.jsonl`;
    const entry = JSON.parse(readFileSync(path, "utf-8").trim());
    expect(entry.cycle).toBe(5);
  });

  it("reads all entries back", () => {
    logger.log("a");
    logger.log("b");
    logger.log("c");

    const entries = logger.readAll();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.action)).toEqual(["a", "b", "c"]);
  });

  it("readAll returns empty array if file does not exist", () => {
    const freshLogger = new IntentLogger("nonexistent", TEST_DIR);
    expect(freshLogger.readAll()).toEqual([]);
  });

  it("getFilePath returns correct path", () => {
    expect(logger.getFilePath()).toBe(`${TEST_DIR}/${TEST_INTENT_ID}.jsonl`);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- src/logging/__tests__/intent-log.test.ts`
Expected: FAIL

**Step 3: Implement IntentLogger**

Create `packages/agent/src/logging/intent-log.ts`:

```typescript
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentLogEntry } from "@veil/common";
import { AgentLogEntrySchema } from "@veil/common";

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

    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.filePath, line, "utf-8");

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

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test -- src/logging/__tests__/intent-log.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/logging/intent-log.ts packages/agent/src/logging/__tests__/intent-log.test.ts
git commit -m "feat(agent): add per-intent JSONL logger"
```

---

### Task 1.6: Create WorkerPool

**Files:**
- Create: `packages/agent/src/worker-pool.ts`
- Create: `packages/agent/src/agent-worker.ts`
- Create: `packages/agent/src/__tests__/worker-pool.test.ts`

This is the core scheduling piece. The WorkerPool manages concurrent AgentWorkers.

**Step 1: Write the failing tests**

Create `packages/agent/src/__tests__/worker-pool.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerPool } from "../worker-pool.js";

// Mock AgentWorker — the real one does network calls
const createMockWorker = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  isRunning: vi.fn().mockReturnValue(false),
  getState: vi.fn().mockReturnValue(null),
  intentId: "mock",
});

describe("WorkerPool", () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool({ maxConcurrency: 2 });
  });

  it("starts with no active workers", () => {
    expect(pool.activeCount()).toBe(0);
    expect(pool.queuedCount()).toBe(0);
  });

  it("reports status correctly", () => {
    expect(pool.getStatus("nonexistent")).toBe("stopped");
  });

  it("shuts down cleanly when empty", async () => {
    await pool.shutdown();
    expect(pool.activeCount()).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- src/__tests__/worker-pool.test.ts`
Expected: FAIL

**Step 3: Create AgentWorker interface and WorkerPool**

Create `packages/agent/src/agent-worker.ts`:

```typescript
import type { AgentState, AgentConfig } from "./agent-loop.js";
import type { IntentLogger } from "./logging/intent-log.js";
import type { IntentRepository } from "./db/repository.js";

export interface AgentWorkerDeps {
  config: AgentConfig;
  intentId: string;
  logger: IntentLogger;
  repo: IntentRepository;
}

export interface AgentWorker {
  intentId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getState(): AgentState | null;
}

// Full implementation will be in Task 2.x when we refactor agent-loop
// For now, this defines the interface the WorkerPool depends on
```

Create `packages/agent/src/worker-pool.ts`:

```typescript
import type { AgentWorker } from "./agent-worker.js";
import type { AgentState } from "./agent-loop.js";

export interface WorkerPoolConfig {
  maxConcurrency: number;
}

export type WorkerFactory = (intentId: string) => AgentWorker;

export class WorkerPool {
  private active = new Map<string, AgentWorker>();
  private queue: string[] = [];
  private workerFactory: WorkerFactory | null = null;
  private maxConcurrency: number;

  constructor(config: WorkerPoolConfig) {
    this.maxConcurrency = config.maxConcurrency;
  }

  setWorkerFactory(factory: WorkerFactory): void {
    this.workerFactory = factory;
  }

  async start(intentId: string): Promise<void> {
    if (this.active.has(intentId)) return;
    if (this.queue.includes(intentId)) return;

    if (this.active.size >= this.maxConcurrency) {
      this.queue.push(intentId);
      return;
    }

    await this.startWorker(intentId);
  }

  async stop(intentId: string): Promise<void> {
    // Remove from queue if queued
    this.queue = this.queue.filter((id) => id !== intentId);

    const worker = this.active.get(intentId);
    if (worker) {
      await worker.stop();
      this.active.delete(intentId);
      await this.drainQueue();
    }
  }

  getStatus(intentId: string): "running" | "queued" | "stopped" {
    if (this.active.has(intentId)) return "running";
    if (this.queue.includes(intentId)) return "queued";
    return "stopped";
  }

  getState(intentId: string): AgentState | null {
    const worker = this.active.get(intentId);
    return worker?.getState() ?? null;
  }

  activeCount(): number {
    return this.active.size;
  }

  queuedCount(): number {
    return this.queue.length;
  }

  async shutdown(): Promise<void> {
    this.queue = [];
    const stops = Array.from(this.active.values()).map((w) => w.stop());
    await Promise.allSettled(stops);
    this.active.clear();
  }

  private async startWorker(intentId: string): Promise<void> {
    if (!this.workerFactory) {
      throw new Error("WorkerPool: no worker factory set");
    }
    const worker = this.workerFactory(intentId);
    this.active.set(intentId, worker);

    // Start in background — don't await the full loop
    worker.start().catch(() => {
      this.active.delete(intentId);
      this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 && this.active.size < this.maxConcurrency) {
      const nextId = this.queue.shift()!;
      await this.startWorker(nextId);
    }
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test -- src/__tests__/worker-pool.test.ts`
Expected: PASS

**Step 5: Verify build**

Run: `pnpm --filter @veil/agent build`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/agent/src/worker-pool.ts packages/agent/src/agent-worker.ts packages/agent/src/__tests__/worker-pool.test.ts
git commit -m "feat(agent): add WorkerPool with concurrency limits and queue"
```

---

### Task 1.7: Phase 1 verification

**Step 1: Run full test suite**

Run: `turbo run build && turbo run test:unit`
Expected: All pass

**Step 2: Run lint**

Run: `turbo run lint`
Expected: All pass

**Step 3: Verify existing endpoints still work**

Run: `pnpm run serve` in one terminal, then:
```bash
curl http://localhost:3147/api/state
```
Expected: Returns default state JSON (existing behavior unchanged)

**Step 4: Commit any fixes, then tag**

```bash
git commit -m "chore: phase 1 complete — foundation layer"
```

---

## Phase 2: New API Endpoints (Additive)

Phase 2 adds the new wallet-scoped REST API alongside the existing endpoints. The old `/api/state` and `/api/deploy` keep working.

---

### Task 2.1: Add auth endpoints

**Files:**
- Create: `packages/agent/src/auth.ts`
- Create: `packages/agent/src/__tests__/auth.test.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Write the failing tests**

Create `packages/agent/src/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { IntentRepository } from "../db/repository.js";
import {
  generateNonce,
  createAuthToken,
  verifyAuthToken,
  NONCE_TTL_SECONDS,
} from "../auth.js";

// In-memory DB setup (same as repository tests)
function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE nonces (
      wallet_address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE intents (
      id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL,
      intent_text TEXT NOT NULL, parsed_intent TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, permissions_context TEXT,
      delegation_manager TEXT, signed_delegation TEXT NOT NULL,
      delegator_smart_account TEXT NOT NULL, cycle INTEGER NOT NULL DEFAULT 0,
      trades_executed INTEGER NOT NULL DEFAULT 0,
      total_spent_usd REAL NOT NULL DEFAULT 0, last_cycle_at INTEGER,
      agent_id TEXT
    );
    CREATE TABLE swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_id TEXT NOT NULL, tx_hash TEXT NOT NULL,
      sell_token TEXT NOT NULL, buy_token TEXT NOT NULL,
      sell_amount TEXT NOT NULL, status TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  return { db, sqlite };
}

describe("auth", () => {
  let repo: IntentRepository;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    repo = new IntentRepository(testDb.db);
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("generateNonce", () => {
    it("returns a random string", () => {
      const nonce = generateNonce();
      expect(nonce.length).toBeGreaterThan(10);
    });

    it("returns different values each time", () => {
      const a = generateNonce();
      const b = generateNonce();
      expect(a).not.toBe(b);
    });
  });

  describe("createAuthToken / verifyAuthToken", () => {
    it("creates a token that can be verified", () => {
      const wallet = "0x1234567890abcdef1234567890abcdef12345678";
      const token = createAuthToken(wallet);
      const result = verifyAuthToken(token);
      expect(result).toBe(wallet.toLowerCase());
    });

    it("returns null for invalid token", () => {
      expect(verifyAuthToken("garbage")).toBeNull();
    });

    it("returns null for expired token", () => {
      const wallet = "0x1234567890abcdef1234567890abcdef12345678";
      const token = createAuthToken(wallet, -1); // already expired
      expect(verifyAuthToken(token)).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- src/__tests__/auth.test.ts`
Expected: FAIL

**Step 3: Implement auth module**

Create `packages/agent/src/auth.ts`:

```typescript
import { randomBytes, createHmac } from "node:crypto";

export const NONCE_TTL_SECONDS = 300; // 5 minutes
const TOKEN_TTL_SECONDS = 86_400; // 24 hours

// Secret for HMAC token signing — generated per server lifecycle
const TOKEN_SECRET = randomBytes(32).toString("hex");

export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export function createAuthToken(
  walletAddress: string,
  ttlSeconds = TOKEN_TTL_SECONDS,
): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${walletAddress.toLowerCase()}:${expires}`;
  const sig = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyAuthToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64").toString();
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;

    const [wallet, expiresStr, sig] = parts;
    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires)) return null;

    // Check expiry
    if (Math.floor(Date.now() / 1000) > expires) return null;

    // Verify signature
    const payload = `${wallet}:${expiresStr}`;
    const expected = createHmac("sha256", TOKEN_SECRET)
      .update(payload)
      .digest("hex");
    if (sig !== expected) return null;

    return wallet;
  } catch {
    return null;
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test -- src/__tests__/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/auth.ts packages/agent/src/__tests__/auth.test.ts
git commit -m "feat(agent): add nonce generation and HMAC auth token system"
```

---

### Task 2.2: Add new API routes to server

**Files:**
- Modify: `packages/agent/src/server.ts`

This task adds the new intent-scoped API routes alongside the existing ones. The new routes are:
- `GET /api/auth/nonce?wallet=`
- `POST /api/auth/verify`
- `POST /api/parse-intent`
- `POST /api/intents`
- `GET /api/intents?wallet=`
- `GET /api/intents/:id`
- `DELETE /api/intents/:id`
- `GET /api/intents/:id/logs`

This is a large task. The implementation should:
1. Read the existing `server.ts` first
2. Add the new route handlers as separate functions
3. Add URL parsing for path params (`:id`)
4. Wire up auth middleware (extract bearer token, verify, get wallet)
5. Integrate with `IntentRepository` and `WorkerPool`
6. Keep all existing routes working

**Due to the size of this task, the implementer should:**
- Read `packages/agent/src/server.ts` fully
- Add routes incrementally, testing each with curl
- Use the existing patterns (parseBody, sendJson, setCors)

**Key implementation details:**
- `POST /api/auth/verify` needs `recoverMessageAddress` from viem
- `POST /api/intents` stores intent in SQLite and calls `workerPool.start(intentId)`
- `GET /api/intents/:id` reads live state from WorkerPool if running, else from SQLite
- `GET /api/intents/:id/logs` streams the JSONL file with appropriate headers
- `DELETE /api/intents/:id` calls `workerPool.stop(intentId)` and updates status to cancelled
- Auth middleware: extract `Authorization: Bearer <token>` header, call `verifyAuthToken()`, compare wallet

**Step 1: Implement routes**

Modify `packages/agent/src/server.ts` to add the new route handlers. The existing `handleDeploy` and `handleState` functions stay unchanged.

**Step 2: Write e2e tests**

Create `packages/agent/src/__tests__/server-intents.e2e.test.ts` that tests the full flow against a running server:
- Auth flow (nonce + verify)
- Create intent
- List intents
- Get intent state
- Delete intent
- Download logs

These tests should use a test SQLite database (in-memory or temp file).

**Step 3: Verify existing endpoints still work**

Run the existing tests + curl both old and new endpoints.

**Step 4: Commit**

```bash
git commit -m "feat(agent): add wallet-scoped intent API with auth"
```

---

### Task 2.3: Add startup resumption

**Files:**
- Create: `packages/agent/src/startup.ts`
- Create: `packages/agent/src/__tests__/startup.test.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Write the failing tests**

Create `packages/agent/src/__tests__/startup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { IntentRepository } from "../db/repository.js";
import { resumeActiveIntents } from "../startup.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE nonces (wallet_address TEXT PRIMARY KEY, nonce TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE intents (
      id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, intent_text TEXT NOT NULL,
      parsed_intent TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, permissions_context TEXT, delegation_manager TEXT,
      signed_delegation TEXT NOT NULL, delegator_smart_account TEXT NOT NULL,
      cycle INTEGER NOT NULL DEFAULT 0, trades_executed INTEGER NOT NULL DEFAULT 0,
      total_spent_usd REAL NOT NULL DEFAULT 0, last_cycle_at INTEGER, agent_id TEXT
    );
    CREATE TABLE swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, intent_id TEXT NOT NULL,
      tx_hash TEXT NOT NULL, sell_token TEXT NOT NULL, buy_token TEXT NOT NULL,
      sell_amount TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL
    );
  `);
  return { db, sqlite };
}

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 100;

const makeIntent = (id: string, expiresAt: number, status = "active" as const) => ({
  id,
  walletAddress: "0x1234",
  intentText: "test",
  parsedIntent: "{}",
  status,
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt,
  signedDelegation: "{}",
  delegatorSmartAccount: "0xabcd",
});

describe("resumeActiveIntents", () => {
  let repo: IntentRepository;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    repo = new IntentRepository(testDb.db);
    sqlite = testDb.sqlite;
  });

  afterEach(() => sqlite.close());

  it("marks expired intents and returns active ones", async () => {
    repo.createIntent(makeIntent("active-1", FUTURE));
    repo.createIntent(makeIntent("expired-1", PAST));
    repo.createIntent(makeIntent("cancelled-1", FUTURE, "cancelled"));

    const startFn = vi.fn().mockResolvedValue(undefined);
    const result = await resumeActiveIntents(repo, startFn, 0);

    expect(result.expired).toBe(1);
    expect(result.resumed).toBe(1);
    expect(startFn).toHaveBeenCalledWith("active-1");
    expect(repo.getIntent("expired-1")!.status).toBe("expired");
  });

  it("staggers starts with delay", async () => {
    repo.createIntent(makeIntent("a", FUTURE));
    repo.createIntent(makeIntent("b", FUTURE));

    const calls: number[] = [];
    const startFn = vi.fn().mockImplementation(async () => {
      calls.push(Date.now());
    });

    await resumeActiveIntents(repo, startFn, 100);

    expect(startFn).toHaveBeenCalledTimes(2);
    if (calls.length === 2) {
      expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(80); // allow some timing slack
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- src/__tests__/startup.test.ts`
Expected: FAIL

**Step 3: Implement startup module**

Create `packages/agent/src/startup.ts`:

```typescript
import type { IntentRepository } from "./db/repository.js";
import { logger } from "./logging/logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resumeActiveIntents(
  repo: IntentRepository,
  startFn: (intentId: string) => Promise<void>,
  staggerMs = 2500,
): Promise<{ expired: number; resumed: number }> {
  // Mark expired intents
  const expired = repo.markExpiredIntents();
  if (expired > 0) {
    logger.info({ expired }, "Marked expired intents on startup");
  }

  // Get remaining active intents
  const active = repo.getActiveIntents();
  let resumed = 0;

  for (const intent of active) {
    try {
      logger.info(
        { intentId: intent.id, wallet: intent.walletAddress, cycle: intent.cycle },
        "Resuming intent",
      );
      await startFn(intent.id);
      resumed++;

      if (staggerMs > 0 && resumed < active.length) {
        await sleep(staggerMs);
      }
    } catch (err) {
      logger.error({ intentId: intent.id, err }, "Failed to resume intent");
    }
  }

  return { expired, resumed };
}
```

Note: The test uses a mock `startFn` — the real one will be `workerPool.start`. The `logger` import may need to be the pino logger already in the project, or we can use console for now and fix in integration.

**Step 4: Run tests**

Run: `pnpm --filter @veil/agent test -- src/__tests__/startup.test.ts`
Expected: PASS (may need to adjust the logger import)

**Step 5: Wire into server startup**

In `packages/agent/src/server.ts`, add to the `startup()` function:

```typescript
// After server starts listening:
const repo = new IntentRepository(getDb());
await resumeActiveIntents(repo, (intentId) => workerPool.start(intentId));
```

**Step 6: Commit**

```bash
git add packages/agent/src/startup.ts packages/agent/src/__tests__/startup.test.ts packages/agent/src/server.ts
git commit -m "feat(agent): add startup resumption for active intents with staggered start"
```

---

### Task 2.4: Phase 2 verification

**Step 1: Full test suite**

Run: `turbo run build && turbo run test:unit`
Expected: All pass

**Step 2: Manual API verification**

Start server and test new endpoints with curl:
```bash
# Auth flow
curl 'http://localhost:3147/api/auth/nonce?wallet=0x1234'
# Should return { nonce: "..." }

# Old endpoints still work
curl http://localhost:3147/api/state
# Should return default state
```

**Step 3: Commit**

```bash
git commit -m "chore: phase 2 complete — new API endpoints"
```

---

## Phase 3: Frontend Wallet Integration

Phase 3 adds wagmi wallet connection, MetaMask delegation signing, and the new multi-intent UI.

---

### Task 3.1: Add wallet dependencies to dashboard

**Files:**
- Modify: `apps/dashboard/package.json`

**Step 1: Install dependencies**

Run:
```bash
pnpm --filter @veil/dashboard add wagmi viem @tanstack/react-query @metamask/smart-accounts-kit@0.4.0-beta.1
```

**Step 2: Verify build**

Run: `pnpm --filter @veil/dashboard build`
Expected: PASS (may need Next.js config adjustments for MetaMask SDK)

**Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add wagmi, viem, tanstack-query, metamask SDK"
```

---

### Task 3.2: Add wagmi config and providers

**Files:**
- Create: `apps/dashboard/lib/wagmi.ts`
- Modify: `apps/dashboard/app/layout.tsx`
- Create: `apps/dashboard/components/providers.tsx`

**Step 1: Create wagmi config**

Create `apps/dashboard/lib/wagmi.ts`:

```typescript
import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
  },
});
```

**Step 2: Create providers wrapper**

Create `apps/dashboard/components/providers.tsx`:

```typescript
"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

**Step 3: Wrap layout with providers**

Modify `apps/dashboard/app/layout.tsx` to wrap `{children}` with `<Providers>`:

```typescript
import { Providers } from "@/components/providers";

// In the return:
<body className={...}>
  <Providers>
    {children}
  </Providers>
</body>
```

**Step 4: Verify build**

Run: `pnpm --filter @veil/dashboard build`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/dashboard/lib/wagmi.ts apps/dashboard/components/providers.tsx apps/dashboard/app/layout.tsx
git commit -m "feat(dashboard): add wagmi config and providers"
```

---

### Task 3.3: Create ConnectWallet component

**Files:**
- Create: `apps/dashboard/components/connect-wallet.tsx`
- Modify: `apps/dashboard/app/page.tsx` (add to header area)

**Step 1: Create the component**

Create `apps/dashboard/components/connect-wallet.tsx`. This should:
- Use `useAccount`, `useConnect`, `useDisconnect` from wagmi
- Show "Connect Wallet" button when disconnected
- Show truncated address + disconnect option when connected
- Match the dark finance design system (zinc-900 bg, emerald accent, monospace address)

**Step 2: Add to page header**

Integrate into the tabs/header area of `apps/dashboard/app/page.tsx`.

**Step 3: Verify in browser**

Run: `pnpm run dev:dashboard`
Check that the connect button appears and MetaMask popup works.

**Step 4: Commit**

```bash
git commit -m "feat(dashboard): add ConnectWallet component"
```

---

### Task 3.4: Add auth hook

**Files:**
- Create: `apps/dashboard/hooks/use-auth.ts`
- Modify: `apps/dashboard/lib/api.ts` (add auth API calls)

**Step 1: Add auth API functions**

Add to `apps/dashboard/lib/api.ts`:

```typescript
export async function fetchNonce(wallet: string): Promise<string> {
  const res = await fetch(`/api/auth/nonce?wallet=${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch nonce");
  const data = await res.json();
  return data.nonce;
}

export async function verifySignature(
  wallet: string,
  nonce: string,
  signature: string,
): Promise<string> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, nonce, signature }),
  });
  if (!res.ok) throw new Error("Auth verification failed");
  const data = await res.json();
  return data.token;
}
```

**Step 2: Create the auth hook**

Create `apps/dashboard/hooks/use-auth.ts`:

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { fetchNonce, verifySignature } from "@/lib/api";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const authenticate = useCallback(async () => {
    if (!address) return;
    setAuthenticating(true);
    try {
      const nonce = await fetchNonce(address);
      const signature = await signMessageAsync({ message: nonce });
      const authToken = await verifySignature(address, nonce, signature);
      setToken(authToken);
    } catch (err) {
      console.error("Auth failed:", err);
      setToken(null);
    } finally {
      setAuthenticating(false);
    }
  }, [address, signMessageAsync]);

  // Clear token on disconnect
  useEffect(() => {
    if (!isConnected) setToken(null);
  }, [isConnected]);

  return {
    token,
    isAuthenticated: token !== null,
    authenticating,
    authenticate,
    walletAddress: address,
  };
}
```

**Step 3: Commit**

```bash
git commit -m "feat(dashboard): add auth hook with nonce signing"
```

---

### Task 3.5: Add delegation signing hook

**Files:**
- Create: `apps/dashboard/hooks/use-delegation.ts`
- Create: `apps/dashboard/lib/delegation.ts`

This is the core frontend delegation flow — builds the delegation object, signs via ERC-7715 (demo) and createDelegation (real).

**Step 1: Create delegation builder for browser**

Create `apps/dashboard/lib/delegation.ts`:

This module should:
- Import `computeMaxValueWei`, `computeExpiryTimestamp`, `computeMaxCalls` from `@veil/common`
- Build the `functionCall` scope delegation using MetaMask SDK's `createDelegation`
- Build caveat terms using `encodePacked` from viem
- Export a function that takes `ParsedIntent` + wallet client and returns signed delegation

**Step 2: Create the delegation signing hook**

Create `apps/dashboard/hooks/use-delegation.ts`:

This hook should:
- Accept a `ParsedIntent` and wallet client
- Step 1: Call `requestExecutionPermissions` (ERC-7715, demo — wrapped in try/catch, non-fatal if it fails)
- Step 2: Call `createDelegation` + `signDelegation` (real delegation)
- Return both the permissionsContext (if available) and the signed delegation
- Track loading/error state

**Step 3: Commit**

```bash
git commit -m "feat(dashboard): add delegation signing hook with ERC-7715 demo + real functionCall delegation"
```

---

### Task 3.6: Rework Configure tab for new flow

**Files:**
- Modify: `apps/dashboard/components/configure.tsx`
- Modify: `apps/dashboard/app/page.tsx`

The Configure tab needs to change from:
- Enter intent → Deploy (single step)

To:
- Enter intent → Preview (parse via Venice) → Review Audit → Sign Delegation → Submit

**Step 1: Update Configure component**

Modify `apps/dashboard/components/configure.tsx`:
- Add "Preview" button that calls `POST /api/parse-intent`
- Show parsed intent preview (allocation, budget, duration) below textarea
- "Deploy Agent" button now requires wallet connection + triggers delegation signing flow
- Multi-step loading states: "Parsing...", "Review delegation...", "Signing (1/2)...", "Signing (2/2)...", "Submitting..."

**Step 2: Update page.tsx for new data flow**

Modify `apps/dashboard/app/page.tsx`:
- Auth state passed down from providers
- Deploy flow now includes delegation signing step
- Audit data generated client-side from delegation object

**Step 3: Verify in browser**

Run dev server, test the full flow with MetaMask.

**Step 4: Commit**

```bash
git commit -m "feat(dashboard): rework Configure tab for wallet-connected delegation flow"
```

---

### Task 3.7: Rework Monitor tab for multi-intent

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx`
- Create: `apps/dashboard/hooks/use-intents.ts`
- Create: `apps/dashboard/hooks/use-intent-state.ts`
- Modify: `apps/dashboard/lib/api.ts`

**Step 1: Add new API functions**

Add to `apps/dashboard/lib/api.ts`:

```typescript
export async function fetchIntents(wallet: string, token: string) { ... }
export async function fetchIntentState(intentId: string, token: string) { ... }
export async function deleteIntent(intentId: string, token: string) { ... }
export async function downloadIntentLogs(intentId: string, token: string) { ... }
```

**Step 2: Create useIntents hook**

Create `apps/dashboard/hooks/use-intents.ts`:
- Polls `GET /api/intents?wallet=` for the connected wallet
- Returns list of intent summaries

**Step 3: Create useIntentState hook**

Create `apps/dashboard/hooks/use-intent-state.ts`:
- Polls `GET /api/intents/:id` for a selected intent
- Same 5s interval, visibility-aware pattern as existing `useAgentState`

**Step 4: Rework Monitor component**

Modify `apps/dashboard/components/monitor.tsx`:
- If wallet not connected: show "Connect wallet to view your agents"
- If connected: show intent list (from useIntents)
- Click an intent: show full monitor view (from useIntentState)
- Add "Download Logs" button → triggers JSONL download
- Add "Stop Agent" button → confirmation modal → DELETE intent
- Keep existing stats/allocation/feed/transactions UI, just fed from intent-scoped data

**Step 5: Commit**

```bash
git commit -m "feat(dashboard): rework Monitor tab for multi-intent wallet-scoped view"
```

---

### Task 3.8: Add Next.js API proxy routes for new endpoints

**Files:**
- Create: `apps/dashboard/app/api/auth/nonce/route.ts`
- Create: `apps/dashboard/app/api/auth/verify/route.ts`
- Create: `apps/dashboard/app/api/parse-intent/route.ts`
- Create: `apps/dashboard/app/api/intents/route.ts`
- Create: `apps/dashboard/app/api/intents/[id]/route.ts`
- Create: `apps/dashboard/app/api/intents/[id]/logs/route.ts`

These proxy routes follow the same pattern as the existing `app/api/deploy/route.ts` and `app/api/state/route.ts` — forward to `AGENT_API_URL` at port 3147.

**Step 1: Create each route file**

Follow the existing proxy pattern. Each route:
- Reads `AGENT_API_URL` from env
- Forwards request body/headers (including Authorization)
- Returns response with same status code

**Step 2: Verify build**

Run: `pnpm --filter @veil/dashboard build`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat(dashboard): add Next.js API proxy routes for auth, intents, and parse-intent"
```

---

### Task 3.9: Update Playwright e2e tests

**Files:**
- Modify: `apps/dashboard/tests/configure.spec.ts`
- Modify: `apps/dashboard/tests/monitor.spec.ts`
- Create: `apps/dashboard/tests/wallet.spec.ts`

**Step 1: Add wallet connection tests**

Create `apps/dashboard/tests/wallet.spec.ts`:
- Test connect wallet button appears
- Test wallet connection flow (investigate Synpress or direct private key signing for real on-chain tests)
- Test disconnect

**Step 2: Update configure tests**

Update `apps/dashboard/tests/configure.spec.ts`:
- Test preview flow (parse intent without wallet)
- Test deploy flow requires wallet connection
- Test delegation signing steps

**Step 3: Update monitor tests**

Update `apps/dashboard/tests/monitor.spec.ts`:
- Test multi-intent list view
- Test intent selection
- Test stop agent button
- Test download logs button

**Step 4: Run e2e tests**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "test(dashboard): update e2e tests for wallet connection and multi-intent flow"
```

---

### Task 3.10: Phase 3 verification

**Step 1: Full test suite**

Run: `turbo run build && turbo run test:unit`
Expected: All pass

**Step 2: Full e2e tests**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: All pass

**Step 3: Manual browser testing**

- Connect MetaMask wallet
- Enter intent, preview
- Sign delegation (ERC-7715 + real)
- Monitor intent
- Stop intent
- Disconnect wallet

**Step 4: Commit**

```bash
git commit -m "chore: phase 3 complete — frontend wallet integration"
```

---

## Phase 4: Cleanup

Phase 4 removes deprecated code and updates infrastructure.

---

### Task 4.1: Refactor agent-loop to use AgentWorker interface

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/src/agent-worker.ts`

**Step 1: Implement AgentWorker**

The `AgentWorker` class wraps the existing `runCycle` logic from `agent-loop.ts`:
- Each worker has its own `AgentState` instance
- Each worker uses an `IntentLogger` for per-intent logging
- Each worker writes cycle state to SQLite via `IntentRepository`
- The `start()` method runs the main loop
- The `stop()` method sets a flag to exit the loop gracefully
- The `getState()` method returns the current state

**Step 2: Remove singleton state**

Remove `_currentState` and `_currentConfig` module-level variables from `agent-loop.ts`. The WorkerPool now manages all state.

**Step 3: Update tests**

Ensure existing unit tests still pass with the refactored loop.

**Step 4: Commit**

```bash
git commit -m "refactor(agent): replace singleton agent loop with AgentWorker instances"
```

---

### Task 4.2: Remove deprecated endpoints

**Files:**
- Modify: `packages/agent/src/server.ts`

**Step 1: Remove /api/deploy handler**

Remove `handleDeploy()` and its route. The new flow is `POST /api/parse-intent` + `POST /api/intents`.

**Step 2: Update /api/state to proxy to intents**

Keep `GET /api/state` but have it return the most recently created intent's state (for backwards compat with any bookmarked URLs). Add a deprecation header.

**Step 3: Update tests**

Remove tests that depend on `/api/deploy`.

**Step 4: Commit**

```bash
git commit -m "refactor(agent): remove deprecated /api/deploy endpoint"
```

---

### Task 4.3: Remove server-side delegation compilation

**Files:**
- Modify: `packages/agent/src/delegation/compiler.ts`

**Step 1: Remove compileIntent function**

The `compileIntent()` function (which calls Venice LLM to parse intents) is now replaced by `POST /api/parse-intent`. The `createDelegationFromIntent()` function is now handled browser-side.

Keep the following in the agent package (still needed for redemption):
- `createDelegatorSmartAccount()` — may be needed for deploying smart accounts
- All redeemer code

Move to common (already done in Task 1.4):
- `detectAdversarialIntent()`
- `generateAuditReport()`

**Step 2: Update imports**

Fix any imports in `agent-loop.ts` that referenced removed functions.

**Step 3: Verify build**

Run: `turbo run build`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "refactor(agent): remove server-side delegation compilation (now browser-side)"
```

---

### Task 4.4: Update VPS deploy script

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Update deploy script**

Add:
- Create `data/` directory on VPS if not exists
- Copy SQLite database backup (optional — db auto-creates on startup)
- Ensure `data/logs/` directory exists
- Update systemd service to set working directory correctly for SQLite relative paths

**Step 2: Test deployment**

Run: `./scripts/deploy.sh deploy`
Expected: VPS restarts with new code, resumes active intents from SQLite

**Step 3: Commit**

```bash
git commit -m "chore: update VPS deploy script for SQLite persistence"
```

---

### Task 4.5: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (if it exists)

**Step 1: Update CLAUDE.md**

- Add SQLite/drizzle to tech stack
- Add new API endpoints documentation
- Update project structure (new files/directories)
- Add wagmi to dashboard dependencies
- Document the delegation flow (browser-side signing)
- Document the worker pool architecture
- Update the "Sponsor Integrations" table

**Step 2: Commit**

```bash
git commit -m "docs: update CLAUDE.md for intent persistence and multi-wallet system"
```

---

### Task 4.6: Final verification

**Step 1: Full test suite**

Run:
```bash
turbo run build
turbo run test:unit
turbo run lint
pnpm --filter @veil/dashboard test:e2e
```
Expected: All pass

**Step 2: E2e flow test**

1. Start server: `pnpm run serve`
2. Start dashboard: `pnpm run dev:dashboard`
3. Connect MetaMask wallet
4. Create intent → sign delegation → verify agent starts
5. Kill server process (Ctrl+C)
6. Restart server: `pnpm run serve`
7. Verify intent auto-resumes from SQLite
8. Check Monitor tab shows resumed intent with continued cycle count

**Step 3: Deploy to VPS**

Run: `./scripts/deploy.sh deploy`
Verify: Agent server accessible at `http://195.201.8.147:3147`

**Step 4: Final commit**

```bash
git commit -m "chore: phase 4 complete — cleanup and verification"
```
