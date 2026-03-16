import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerPool } from "../worker-pool.js";
import type { AgentWorker } from "../agent-worker.js";

function createMockWorker(intentId: string): AgentWorker {
  return {
    intentId,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
    getState: vi.fn().mockReturnValue(null),
  };
}

describe("WorkerPool", () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool({ maxConcurrency: 2 });
  });

  it("starts with no active workers", () => {
    expect(pool.activeCount()).toBe(0);
    expect(pool.queuedCount()).toBe(0);
  });

  it("reports status correctly", () => {
    expect(pool.getStatus("nonexistent")).toBe("stopped");
  });

  it("shuts down cleanly when empty", async () => {
    await pool.shutdown();
    expect(pool.activeCount()).toBe(0);
  });

  it("starts a worker when under concurrency limit", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    expect(pool.activeCount()).toBe(1);
    expect(pool.getStatus("intent-1")).toBe("running");
  });

  it("queues workers when at concurrency limit", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    await pool.start("intent-2");
    await pool.start("intent-3");
    expect(pool.activeCount()).toBe(2);
    expect(pool.queuedCount()).toBe(1);
    expect(pool.getStatus("intent-3")).toBe("queued");
  });

  it("does not duplicate a running worker", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    await pool.start("intent-1");
    expect(pool.activeCount()).toBe(1);
  });

  it("does not duplicate a queued worker", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    await pool.start("intent-2");
    await pool.start("intent-3");
    await pool.start("intent-3");
    expect(pool.queuedCount()).toBe(1);
  });

  it("stops a running worker", async () => {
    const workers = new Map<string, AgentWorker>();
    pool.setWorkerFactory((id) => {
      const w = createMockWorker(id);
      workers.set(id, w);
      return w;
    });
    await pool.start("intent-1");
    await pool.stop("intent-1");
    expect(pool.activeCount()).toBe(0);
    expect(workers.get("intent-1")!.stop).toHaveBeenCalled();
  });

  it("removes a queued worker without calling stop", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    await pool.start("intent-2");
    await pool.start("intent-3");
    await pool.stop("intent-3");
    expect(pool.queuedCount()).toBe(0);
  });

  it("drains queue when a worker is stopped", async () => {
    pool.setWorkerFactory((id) => createMockWorker(id));
    await pool.start("intent-1");
    await pool.start("intent-2");
    await pool.start("intent-3");
    expect(pool.getStatus("intent-3")).toBe("queued");

    await pool.stop("intent-1");
    expect(pool.activeCount()).toBe(2);
    expect(pool.getStatus("intent-3")).toBe("running");
    expect(pool.queuedCount()).toBe(0);
  });

  it("shuts down all workers", async () => {
    const workers = new Map<string, AgentWorker>();
    pool.setWorkerFactory((id) => {
      const w = createMockWorker(id);
      workers.set(id, w);
      return w;
    });
    await pool.start("intent-1");
    await pool.start("intent-2");
    await pool.shutdown();
    expect(pool.activeCount()).toBe(0);
    expect(workers.get("intent-1")!.stop).toHaveBeenCalled();
    expect(workers.get("intent-2")!.stop).toHaveBeenCalled();
  });

  it("throws if no worker factory is set", async () => {
    await expect(pool.start("intent-1")).rejects.toThrow("no worker factory");
  });
});
