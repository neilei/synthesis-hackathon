/**
 * @file Shared Zod schemas for API request/response validation across the Veil monorepo.
 *
 * These schemas are the single source of truth for data shapes exchanged between
 * the agent backend and the dashboard frontend.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// ParsedIntent — the compiled user portfolio intent
// ---------------------------------------------------------------------------

export const ParsedIntentSchema = z.object({
  targetAllocation: z.record(z.string(), z.number()),
  dailyBudgetUsd: z.number(),
  timeWindowDays: z.number(),
  maxTradesPerDay: z.number(),
  maxSlippage: z.number(),
  driftThreshold: z.number(),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

// ---------------------------------------------------------------------------
// SwapRecord — a single swap transaction
// ---------------------------------------------------------------------------

export const SwapRecordSchema = z.object({
  txHash: z.string(),
  sellToken: z.string(),
  buyToken: z.string(),
  sellAmount: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

export type SwapRecord = z.infer<typeof SwapRecordSchema>;

// ---------------------------------------------------------------------------
// AuditReport — delegation safety audit (API subset)
// ---------------------------------------------------------------------------

export const AuditReportSchema = z.object({
  allows: z.array(z.string()),
  prevents: z.array(z.string()),
  worstCase: z.string(),
  warnings: z.array(z.string()),
});

export type AuditReport = z.infer<typeof AuditReportSchema>;

// ---------------------------------------------------------------------------
// AgentLogEntry — a single agent action log line
//
// Required: timestamp, sequence, action
// Optional: tool, parameters, result, duration_ms, error
// NOTE: No "success" field — intentionally omitted per agent logging spec.
// ---------------------------------------------------------------------------

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

export type AgentLogEntry = z.infer<typeof AgentLogEntrySchema>;


