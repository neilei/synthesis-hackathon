import type { AgentState } from "./agent-loop.js";

export interface AgentWorker {
  intentId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getState(): AgentState | null;
}
