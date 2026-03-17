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
