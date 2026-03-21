import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { IntentRepository } from "../repository.js";

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
    permissions TEXT,
    delegation_manager TEXT,
    dependencies TEXT,
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

function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(CREATE_TABLES_SQL);
  return { db, sqlite };
}

const NOW = Math.floor(Date.now() / 1000);
const FUTURE = NOW + 7 * 86400;

const SAMPLE_INTENT = {
  id: "test-intent-1",
  walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
  intentText: "60/40 ETH/USDC, $200/day, 7 days",
  parsedIntent: JSON.stringify({
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxPerTradeUsd: 200,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  }),
  status: "active" as const,
  createdAt: NOW,
  expiresAt: FUTURE,
  permissions: JSON.stringify([{ type: "native-token-periodic", context: "0xdeadbeef", token: "ETH" }]),
  delegationManager: "0x0000000000000000000000000000000000000001",
  dependencies: JSON.stringify([]),
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
      expect(result.walletAddress).toBe(SAMPLE_INTENT.walletAddress);
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
      expect(found!.intentText).toBe(SAMPLE_INTENT.intentText);
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

    it("does not return intents from other wallets", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "other-wallet-intent",
        walletAddress: "0xother",
      });
      const results = repo.getIntentsByWallet(SAMPLE_INTENT.walletAddress);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("test-intent-1");
    });
  });

  describe("getActiveIntents", () => {
    it("returns only active non-expired intents", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "expired",
        expiresAt: NOW - 100,
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

    it("returns empty array when no active intents", () => {
      expect(repo.getActiveIntents()).toEqual([]);
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
      const lastCycleAt = NOW + 60;
      repo.updateIntentCycleState("test-intent-1", {
        cycle: 5,
        tradesExecuted: 2,
        totalSpentUsd: 150.5,
        lastCycleAt,
      });
      const found = repo.getIntent("test-intent-1");
      expect(found!.cycle).toBe(5);
      expect(found!.tradesExecuted).toBe(2);
      expect(found!.totalSpentUsd).toBeCloseTo(150.5);
      expect(found!.lastCycleAt).toBe(lastCycleAt);
    });
  });

  describe("updateIntentAgentId", () => {
    it("updates the agent id", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.updateIntentAgentId("test-intent-1", "12345");
      const found = repo.getIntent("test-intent-1");
      expect(found!.agentId).toBe("12345");
    });
  });

  describe("markExpiredIntents", () => {
    it("marks past-expiry active intents as expired", () => {
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "should-expire",
        expiresAt: NOW - 100,
      });
      const count = repo.markExpiredIntents();
      expect(count).toBe(1);
      const found = repo.getIntent("should-expire");
      expect(found!.status).toBe("expired");
    });

    it("does not affect cancelled or completed intents", () => {
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "already-cancelled",
        status: "cancelled",
        expiresAt: NOW - 100,
      });
      const count = repo.markExpiredIntents();
      expect(count).toBe(0);
    });

    it("does not affect future intents", () => {
      repo.createIntent(SAMPLE_INTENT);
      const count = repo.markExpiredIntents();
      expect(count).toBe(0);
      expect(repo.getIntent("test-intent-1")!.status).toBe("active");
    });

    it("marks intent expiring at exactly now as expired", () => {
      repo.createIntent({
        ...SAMPLE_INTENT,
        id: "exact-boundary",
        expiresAt: NOW,
      });
      const count = repo.markExpiredIntents();
      expect(count).toBe(1);
      expect(repo.getIntent("exact-boundary")!.status).toBe("expired");
    });
  });

  describe("swaps", () => {
    it("inserts and retrieves swaps for an intent", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.insertSwap({
        intentId: "test-intent-1",
        txHash: "0xabc123",
        sellToken: "ETH",
        buyToken: "USDC",
        sellAmount: "0.1",
        status: "confirmed",
        timestamp: new Date().toISOString(),
      });
      const result = repo.getSwapsByIntent("test-intent-1");
      expect(result).toHaveLength(1);
      expect(result[0].txHash).toBe("0xabc123");
      expect(result[0].sellToken).toBe("ETH");
    });

    it("returns empty array for intent with no swaps", () => {
      repo.createIntent(SAMPLE_INTENT);
      expect(repo.getSwapsByIntent("test-intent-1")).toEqual([]);
    });

    it("rejects swap with invalid intent id (FK constraint)", () => {
      expect(() =>
        repo.insertSwap({
          intentId: "nonexistent",
          txHash: "0xbad",
          sellToken: "ETH",
          buyToken: "USDC",
          sellAmount: "0.1",
          status: "confirmed",
          timestamp: new Date().toISOString(),
        }),
      ).toThrow();
    });

    it("only returns swaps for the requested intent", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({ ...SAMPLE_INTENT, id: "other" });
      repo.insertSwap({
        intentId: "test-intent-1",
        txHash: "0x111",
        sellToken: "ETH",
        buyToken: "USDC",
        sellAmount: "0.1",
        status: "confirmed",
        timestamp: new Date().toISOString(),
      });
      repo.insertSwap({
        intentId: "other",
        txHash: "0x222",
        sellToken: "USDC",
        buyToken: "ETH",
        sellAmount: "100",
        status: "confirmed",
        timestamp: new Date().toISOString(),
      });
      expect(repo.getSwapsByIntent("test-intent-1")).toHaveLength(1);
      expect(repo.getSwapsByIntent("other")).toHaveLength(1);
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

    it("returns null for non-existent wallet", () => {
      expect(repo.getNonce("0xnonexistent")).toBeNull();
    });
  });

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

  describe("getMaxLogSequence", () => {
    it("returns -1 when no logs exist for intent", () => {
      repo.createIntent(SAMPLE_INTENT);
      expect(repo.getMaxLogSequence("test-intent-1")).toBe(-1);
    });

    it("returns -1 for non-existent intent", () => {
      expect(repo.getMaxLogSequence("nonexistent")).toBe(-1);
    });

    it("returns the highest sequence number", () => {
      repo.createIntent(SAMPLE_INTENT);
      for (let i = 0; i < 5; i++) {
        repo.insertLog({
          intentId: "test-intent-1",
          timestamp: `2026-03-18T12:0${i}:00Z`,
          sequence: i,
          action: `action_${i}`,
        });
      }
      expect(repo.getMaxLogSequence("test-intent-1")).toBe(4);
    });

    it("is scoped to the requested intent", () => {
      repo.createIntent(SAMPLE_INTENT);
      repo.createIntent({ ...SAMPLE_INTENT, id: "other" });
      repo.insertLog({
        intentId: "test-intent-1",
        timestamp: "2026-03-18T12:00:00Z",
        sequence: 10,
        action: "a",
      });
      repo.insertLog({
        intentId: "other",
        timestamp: "2026-03-18T12:00:00Z",
        sequence: 99,
        action: "b",
      });
      expect(repo.getMaxLogSequence("test-intent-1")).toBe(10);
      expect(repo.getMaxLogSequence("other")).toBe(99);
    });
  });
});
