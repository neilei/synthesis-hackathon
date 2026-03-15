/**
 * JSONL event logger. Appends structured AgentLogEntry records to agent_log.jsonl.
 * Read by the server for the dashboard activity feed.
 *
 * @module @veil/agent/logging/agent-log
 */
import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Agent log entry
// ---------------------------------------------------------------------------

export interface AgentLogEntry {
  timestamp: string;
  sequence: number;
  action: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// JSONL writer
// ---------------------------------------------------------------------------

let sequence = 0;
const LOG_PATH = join(process.cwd(), "agent_log.jsonl");

export function resetLogSequence(): void {
  sequence = 0;
}

export function logAction(
  action: string,
  opts?: {
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

export function logStart(): void {
  logAction("agent_start", {
    parameters: { pid: process.pid, cwd: process.cwd() },
  });
}

export function logStop(reason: string): void {
  logAction("agent_stop", { parameters: { reason } });
}
