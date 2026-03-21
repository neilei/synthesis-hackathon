import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import type { AgentLogEntry } from "@maw/common";
import { AgentLogEntrySchema } from "@maw/common";
import type { IntentRepository } from "../db/repository.js";

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
  private sequence: number;
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
    // Resume from the highest existing sequence so restarts don't collide.
    this.sequence = repo ? repo.getMaxLogSequence(intentId) + 1 : 0;
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
