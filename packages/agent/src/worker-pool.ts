import type { AgentWorker } from "./agent-worker.js";
import type { AgentState } from "./agent-loop/index.js";

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

  getQueuePosition(intentId: string): number | null {
    const idx = this.queue.indexOf(intentId);
    return idx === -1 ? null : idx + 1; // 1-based position
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

    worker.start()
      .then(() => {
        this.active.delete(intentId);
        this.drainQueue();
      })
      .catch(() => {
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
