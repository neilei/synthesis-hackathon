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
  parsedIntent: text("parsed_intent").notNull(), // JSON blob of ParsedIntent
  status: text("status", {
    enum: ["active", "paused", "completed", "expired", "cancelled"],
  }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),

  // ERC-7715 demo narrative
  permissionsContext: text("permissions_context"),
  delegationManager: text("delegation_manager"),

  // Real delegation (functionCall scope for Uniswap)
  signedDelegation: text("signed_delegation").notNull(), // JSON-serialized Delegation
  delegatorSmartAccount: text("delegator_smart_account").notNull(),

  // Execution state (updated each cycle)
  cycle: integer("cycle").notNull().default(0),
  tradesExecuted: integer("trades_executed").notNull().default(0),
  totalSpentUsd: real("total_spent_usd").notNull().default(0),
  lastCycleAt: integer("last_cycle_at", { mode: "number" }),

  // ERC-8004 identity
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
