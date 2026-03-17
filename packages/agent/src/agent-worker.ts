/**
 * AgentWorker interface and DefaultAgentWorker implementation.
 *
 * DefaultAgentWorker wraps the existing agent-loop cycle logic, scoped to a
 * specific intent loaded from the database. Each worker has its own state,
 * per-intent logger, and writes cycle state back to SQLite.
 *
 * @module @veil/agent/agent-worker
 */
import type { AgentState, AgentConfig } from "./agent-loop/index.js";
import { runAgentLoop } from "./agent-loop/index.js";
import { IntentLogger } from "./logging/intent-log.js";
import type { IntentRepository } from "./db/repository.js";
import { env } from "./config.js";
import { logger } from "./logging/logger.js";

export interface AgentWorker {
  intentId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getState(): AgentState | null;
}

export interface DefaultAgentWorkerDeps {
  repo: IntentRepository;
}

/**
 * Concrete worker that loads an intent from the DB and runs the agent loop.
 * The existing runAgentLoop handles the delegation creation, cycle execution,
 * and all trading logic. The worker manages lifecycle and persists state.
 */
export class DefaultAgentWorker implements AgentWorker {
  private running = false;
  private state: AgentState | null = null;
  private intentLogger: IntentLogger;
  private abortController: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    public readonly intentId: string,
    private deps: DefaultAgentWorkerDeps,
  ) {
    this.intentLogger = new IntentLogger(intentId);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const intent = this.deps.repo.getIntent(this.intentId);
    if (!intent) {
      logger.error({ intentId: this.intentId }, "Intent not found in DB");
      return;
    }

    if (intent.status !== "active") {
      logger.warn(
        { intentId: this.intentId, status: intent.status },
        "Intent is not active, skipping start",
      );
      return;
    }

    this.running = true;
    this.abortController = new AbortController();

    this.intentLogger.log("worker_start", {
      result: { intentId: this.intentId, wallet: intent.walletAddress },
    });

    // Parse the stored intent
    let parsed;
    try {
      parsed = JSON.parse(intent.parsedIntent);
    } catch {
      logger.error({ intentId: this.intentId }, "Failed to parse stored intent");
      this.running = false;
      return;
    }

    const config: AgentConfig = {
      intent: parsed,
      // Fallback to empty hex — delegation creation will fail gracefully if key is missing
      delegatorKey: env.DELEGATOR_PRIVATE_KEY ?? ("0x" as `0x${string}`),
      agentKey: env.AGENT_PRIVATE_KEY,
      chainId: 11155111,
      intervalMs: 60_000,
      signal: this.abortController.signal,
      intentLogger: this.intentLogger,
      intentId: this.intentId,
      existingAgentId: intent.agentId ? BigInt(intent.agentId) : undefined,
      onAgentIdRegistered: (agentId: string) => {
        this.deps.repo.updateIntentAgentId(this.intentId, agentId);
      },
      onCycleComplete: (loopState) => {
        // Capture the live state from the running loop
        this.state = loopState;
        this.persistState(loopState);
      },
    };

    // Run the agent loop in the background
    this.loopPromise = runAgentLoop(config)
      .then(() => {
        this.intentLogger.log("worker_stop", {
          result: { reason: "loop_completed" },
        });
        this.deps.repo.updateIntentStatus(this.intentId, "completed");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, intentId: this.intentId }, "Agent worker crashed");
        this.intentLogger.log("worker_error", { error: msg });
      })
      .finally(() => {
        this.running = false;
      });
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    // Signal the running loop to stop via AbortController
    this.abortController?.abort();

    this.intentLogger.log("worker_stop", {
      result: { reason: "stop_requested" },
    });

    // Wait for the loop to actually finish (up to 10s)
    if (this.loopPromise) {
      await Promise.race([
        this.loopPromise,
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }

    this.running = false;
    this.deps.repo.updateIntentStatus(this.intentId, "cancelled");
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): AgentState | null {
    return this.state;
  }

  private persistState(loopState: AgentState): void {
    try {
      this.deps.repo.updateIntentCycleState(this.intentId, {
        cycle: loopState.cycle,
        tradesExecuted: loopState.tradesExecuted,
        totalSpentUsd: loopState.totalSpentUsd,
        lastCycleAt: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      logger.error(
        { err, intentId: this.intentId },
        "Failed to persist worker state",
      );
    }
  }
}
