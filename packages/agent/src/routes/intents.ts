import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { existsSync, createReadStream } from "node:fs";
import { nanoid } from "nanoid";
import {
  ParsedIntentSchema,
  computeExpiryTimestamp,
  generateAuditReport,
} from "@maw/common";
import type { IntentRepository } from "../db/repository.js";
import type { WorkerPool } from "../worker-pool.js";
import { IntentLogger, onLogEntry } from "../logging/intent-log.js";
import { logger } from "../logging/logger.js";
import type { AuthEnv } from "../middleware/auth.js";

export interface IntentRouteDeps {
  repo: IntentRepository;
  workerPool: WorkerPool;
}

export function createIntentRoutes(deps: IntentRouteDeps) {
  const app = new Hono<AuthEnv>();

  // POST / — create intent
  app.post("/", async (c) => {
    const wallet = c.var.wallet;
    const body = await c.req.json();

    const intentText =
      typeof body.intentText === "string" ? body.intentText.trim() : null;
    const parsedIntentRaw = body.parsedIntent;
    const permissions =
      typeof body.permissions === "string" ? body.permissions : null;
    const delegationManager =
      typeof body.delegationManager === "string"
        ? body.delegationManager
        : null;
    const dependencies =
      typeof body.dependencies === "string" ? body.dependencies : null;

    if (!intentText || !parsedIntentRaw || !permissions || !delegationManager) {
      return c.json(
        {
          error:
            "Missing required fields: intentText, parsedIntent, permissions, delegationManager",
        },
        400,
      );
    }

    const parsedResult = ParsedIntentSchema.safeParse(parsedIntentRaw);
    if (!parsedResult.success) {
      return c.json(
        {
          error: `Invalid parsedIntent: ${parsedResult.error.issues[0]?.message ?? "validation failed"}`,
        },
        400,
      );
    }

    const parsed = parsedResult.data;
    const intentId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = computeExpiryTimestamp(parsed.timeWindowDays);

    const intent = deps.repo.createIntent({
      id: intentId,
      walletAddress: wallet,
      intentText,
      parsedIntent: JSON.stringify(parsed),
      status: "active",
      createdAt: now,
      expiresAt,
      permissions,
      delegationManager,
      dependencies,
    });

    try {
      await deps.workerPool.start(intentId);
    } catch (err) {
      logger.error(
        { err, intentId },
        "Failed to start worker for new intent",
      );
    }

    const audit = generateAuditReport(parsed);
    return c.json({ intent, audit }, 201);
  });

  // GET / — list intents
  app.get("/", (c) => {
    const wallet = c.var.wallet;
    const queryWallet = c.req.query("wallet")?.toLowerCase();
    if (queryWallet && queryWallet !== wallet) {
      return c.json({ error: "Wallet mismatch" }, 403);
    }

    const intents = deps.repo.getIntentsByWallet(wallet);
    const enriched = intents.map((intent) => ({
      ...intent,
      workerStatus: deps.workerPool.getStatus(intent.id),
      queuePosition: deps.workerPool.getQueuePosition(intent.id),
    }));
    return c.json(enriched);
  });

  // GET /:id — get intent detail
  app.get("/:id", (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const afterSeq = Number(c.req.query("after") ?? -1);
    const limit = Number(c.req.query("limit") ?? 500);

    const workerStatus = deps.workerPool.getStatus(intentId);
    const queuePosition = deps.workerPool.getQueuePosition(intentId);
    const rawLiveState = deps.workerPool.getState(intentId);
    // BigInts (e.g. agentId) can't be JSON-serialized — convert to strings
    const liveState = rawLiveState
      ? JSON.parse(JSON.stringify(rawLiveState, (_k, v) => typeof v === "bigint" ? v.toString() : v))
      : null;
    const rawLogs = deps.repo.getIntentLogs(intentId, {
      afterSequence: isNaN(afterSeq) ? -1 : afterSeq,
      limit: isNaN(limit) || limit < 1 ? 500 : Math.min(limit, 10_000),
    });

    // Parse JSON blob columns so the frontend receives objects, not strings
    const logs = rawLogs.map((log) => ({
      ...log,
      result: log.result ? JSON.parse(log.result) : undefined,
      parameters: log.parameters ? JSON.parse(log.parameters) : undefined,
    }));

    return c.json({ ...intent, workerStatus, queuePosition, liveState, logs });
  });

  // DELETE /:id — cancel intent
  app.delete("/:id", async (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await deps.workerPool.stop(intentId);
    deps.repo.updateIntentStatus(intentId, "cancelled");
    return c.json({ status: "cancelled" });
  });

  // GET /:id/events — SSE stream of live log entries
  app.get("/:id/events", async (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return streamSSE(c, async (stream) => {
      const unsub = onLogEntry((id, entry) => {
        if (id !== intentId) return;
        stream.writeSSE({
          data: JSON.stringify(entry),
          event: "log",
          id: String(entry.sequence),
        });
      });

      stream.onAbort(() => {
        unsub();
      });

      // Keep connection alive with heartbeat every 30s
      while (true) {
        await stream.sleep(30_000);
        await stream.writeSSE({ data: "", event: "heartbeat", id: "" });
      }
    });
  });

  // GET /:id/logs — download intent logs as ndjson
  app.get("/:id/logs", (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const intentLogger = new IntentLogger(intentId);
    const filePath = intentLogger.getFilePath();

    c.header("Content-Type", "application/x-ndjson");
    c.header(
      "Content-Disposition",
      `attachment; filename="${intentId}.jsonl"`,
    );

    if (!existsSync(filePath)) {
      return c.body("");
    }

    return stream(c, async (s) => {
      const nodeStream = createReadStream(filePath);
      for await (const chunk of nodeStream) {
        await s.write(chunk);
      }
    });
  });

  return app;
}
