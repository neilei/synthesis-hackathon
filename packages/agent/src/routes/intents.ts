import { Hono } from "hono";
import { stream } from "hono/streaming";
import { existsSync, createReadStream } from "node:fs";
import { nanoid } from "nanoid";
import {
  ParsedIntentSchema,
  computeExpiryTimestamp,
  generateAuditReport,
} from "@veil/common";
import type { IntentRepository } from "../db/repository.js";
import type { WorkerPool } from "../worker-pool.js";
import { IntentLogger } from "../logging/intent-log.js";
import { logger } from "../logging/logger.js";
import type { AuthEnv } from "../middleware/auth.js";

export interface IntentRouteDeps {
  repo: IntentRepository;
  workerPool: WorkerPool;
}

export function createIntentRoutes({ repo, workerPool }: IntentRouteDeps) {
  const app = new Hono<AuthEnv>();

  // POST / — create intent
  app.post("/", async (c) => {
    const wallet = c.var.wallet;
    const body = await c.req.json();

    const intentText =
      typeof body.intentText === "string" ? body.intentText.trim() : null;
    const parsedIntentRaw = body.parsedIntent;
    const signedDelegation =
      typeof body.signedDelegation === "string"
        ? body.signedDelegation
        : null;
    const delegatorSmartAccount =
      typeof body.delegatorSmartAccount === "string"
        ? body.delegatorSmartAccount
        : null;

    if (
      !intentText ||
      !parsedIntentRaw ||
      !signedDelegation ||
      !delegatorSmartAccount
    ) {
      return c.json(
        {
          error:
            "Missing required fields: intentText, parsedIntent, signedDelegation, delegatorSmartAccount",
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

    const intent = repo.createIntent({
      id: intentId,
      walletAddress: wallet,
      intentText,
      parsedIntent: JSON.stringify(parsed),
      status: "active",
      createdAt: now,
      expiresAt,
      signedDelegation,
      delegatorSmartAccount,
      permissionsContext:
        typeof body.permissionsContext === "string"
          ? body.permissionsContext
          : null,
      delegationManager:
        typeof body.delegationManager === "string"
          ? body.delegationManager
          : null,
    });

    try {
      await workerPool.start(intentId);
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

    const intents = repo.getIntentsByWallet(wallet);
    const enriched = intents.map((intent) => ({
      ...intent,
      workerStatus: workerPool.getStatus(intent.id),
    }));
    return c.json(enriched);
  });

  // GET /:id — get intent detail
  app.get("/:id", (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const workerStatus = workerPool.getStatus(intentId);
    const liveState = workerPool.getState(intentId);
    const intentLogger = new IntentLogger(intentId);
    const logs = intentLogger.readAll();

    return c.json({ ...intent, workerStatus, liveState, logs });
  });

  // DELETE /:id — cancel intent
  app.delete("/:id", async (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }
    if (intent.walletAddress !== wallet) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await workerPool.stop(intentId);
    repo.updateIntentStatus(intentId, "cancelled");
    return c.json({ status: "cancelled" });
  });

  // GET /:id/logs — download intent logs as ndjson
  app.get("/:id/logs", (c) => {
    const wallet = c.var.wallet;
    const intentId = c.req.param("id");
    const intent = repo.getIntent(intentId);
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
