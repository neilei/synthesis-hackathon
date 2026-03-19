import type { AgentLogEntry } from "@veil/common";
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
