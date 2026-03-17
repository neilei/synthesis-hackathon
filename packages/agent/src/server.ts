/**
 * HTTP server (port 3147) exposing wallet-scoped intent API.
 * Serves the Next.js dashboard static build as a SPA fallback.
 *
 * @module @veil/agent/server
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile, existsSync, createReadStream } from "fs";
import { join, extname } from "path";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { nanoid } from "nanoid";

import { env } from "./config.js";
import { compileIntent } from "./delegation/compiler.js";
import { registerAgent } from "./identity/erc8004.js";
import {
  DEFAULT_AGENT_PORT,
  API_PATHS,
  ParsedIntentSchema,
  computeExpiryTimestamp,
  generateAuditReport,
} from "@veil/common";
import { logger } from "./logging/logger.js";
import { withRetry } from "./utils/retry.js";
import { IntentRepository } from "./db/repository.js";
import { getDb } from "./db/connection.js";
import { WorkerPool } from "./worker-pool.js";
import { IntentLogger } from "./logging/intent-log.js";
import { DefaultAgentWorker } from "./agent-worker.js";
import {
  generateNonce,
  createAuthToken,
  verifyAuthToken,
  NONCE_TTL_SECONDS,
} from "./auth.js";
import { resumeActiveIntents } from "./startup.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : DEFAULT_AGENT_PORT;
const DASHBOARD_DIST = join(process.cwd(), "apps", "dashboard", "out");

// Singleton instances — initialized at startup
let repo: IntentRepository;
const workerPool = new WorkerPool({ maxConcurrency: 5 });

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// ---------------------------------------------------------------------------
// JSON body parser
// ---------------------------------------------------------------------------

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// CORS + JSON helpers
// ---------------------------------------------------------------------------

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, message: string, status = 400) {
  sendJson(res, { error: message }, status);
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function extractWallet(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return verifyAuthToken(token);
}

// ---------------------------------------------------------------------------
// URL parsing helpers
// ---------------------------------------------------------------------------

function parseUrl(raw: string): { pathname: string; search: URLSearchParams } {
  const qIdx = raw.indexOf("?");
  if (qIdx === -1) return { pathname: raw, search: new URLSearchParams() };
  return {
    pathname: raw.slice(0, qIdx),
    search: new URLSearchParams(raw.slice(qIdx + 1)),
  };
}

/** Match /api/intents/:id or /api/intents/:id/logs */
function matchIntentRoute(
  pathname: string,
): { intentId: string; sub?: "logs" } | null {
  const prefix = "/api/intents/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (!rest) return null;

  if (rest.endsWith("/logs")) {
    const intentId = rest.slice(0, -5);
    if (intentId) return { intentId, sub: "logs" };
    return null;
  }

  // No sub-path — just the id (no slashes)
  if (!rest.includes("/")) return { intentId: rest };
  return null;
}

// ---------------------------------------------------------------------------
// API route handlers
// ---------------------------------------------------------------------------

function handleAuthNonce(
  req: IncomingMessage,
  res: ServerResponse,
  search: URLSearchParams,
) {
  const wallet = search.get("wallet");
  if (!wallet) {
    sendError(res, "Missing wallet query parameter");
    return;
  }

  const nonce = generateNonce();
  repo.upsertNonce(wallet.toLowerCase(), nonce);

  sendJson(res, { nonce });
}

async function handleAuthVerify(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req);
  const wallet = typeof body.wallet === "string" ? body.wallet : null;
  const signature = typeof body.signature === "string" ? body.signature : null;

  if (!wallet || !signature) {
    sendError(res, "Missing wallet or signature");
    return;
  }

  const walletLower = wallet.toLowerCase();
  const nonceRecord = repo.getNonce(walletLower);
  if (!nonceRecord) {
    sendError(res, "No nonce found — request /api/auth/nonce first", 401);
    return;
  }

  // Check nonce expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - nonceRecord.createdAt > NONCE_TTL_SECONDS) {
    repo.deleteNonce(walletLower);
    sendError(res, "Nonce expired", 401);
    return;
  }

  // Verify signature
  try {
    const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonceRecord.nonce}`;
    // Safe cast: signature is validated as a string above; viem expects hex-prefixed type
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });

    if (recovered.toLowerCase() !== walletLower) {
      sendError(res, "Signature does not match wallet", 401);
      return;
    }
  } catch {
    sendError(res, "Invalid signature", 401);
    return;
  }

  // Clean up nonce and issue token
  repo.deleteNonce(walletLower);
  const token = createAuthToken(walletLower);
  sendJson(res, { token });
}

async function handleParseIntent(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req);
  const intentText =
    typeof body.intent === "string" ? body.intent.trim() : null;
  if (!intentText) {
    sendError(res, "Missing intent text");
    return;
  }

  try {
    const parsed = await compileIntent(intentText);
    const audit = generateAuditReport(parsed);
    sendJson(res, { parsed, audit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Parse intent failed");
    sendError(res, msg, 500);
  }
}

async function handleCreateIntent(req: IncomingMessage, res: ServerResponse) {
  const wallet = extractWallet(req);
  if (!wallet) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  const body = await parseBody(req);

  // Validate required fields
  const intentText =
    typeof body.intentText === "string" ? body.intentText.trim() : null;
  const parsedIntentRaw = body.parsedIntent;
  const signedDelegation =
    typeof body.signedDelegation === "string" ? body.signedDelegation : null;
  const delegatorSmartAccount =
    typeof body.delegatorSmartAccount === "string"
      ? body.delegatorSmartAccount
      : null;

  if (!intentText || !parsedIntentRaw || !signedDelegation || !delegatorSmartAccount) {
    sendError(
      res,
      "Missing required fields: intentText, parsedIntent, signedDelegation, delegatorSmartAccount",
    );
    return;
  }

  // Validate parsedIntent shape
  const parsedResult = ParsedIntentSchema.safeParse(parsedIntentRaw);
  if (!parsedResult.success) {
    sendError(
      res,
      `Invalid parsedIntent: ${parsedResult.error.issues[0]?.message ?? "validation failed"}`,
    );
    return;
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

  // Start worker
  try {
    await workerPool.start(intentId);
  } catch (err) {
    logger.error({ err, intentId }, "Failed to start worker for new intent");
  }

  const audit = generateAuditReport(parsed);
  sendJson(res, { intent, audit }, 201);
}

function handleListIntents(
  req: IncomingMessage,
  res: ServerResponse,
  search: URLSearchParams,
) {
  const wallet = extractWallet(req);
  if (!wallet) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  // Optionally filter by wallet query param, but must match auth wallet
  const queryWallet = search.get("wallet")?.toLowerCase();
  if (queryWallet && queryWallet !== wallet) {
    sendError(res, "Wallet mismatch", 403);
    return;
  }

  const intents = repo.getIntentsByWallet(wallet);

  // Enrich with worker status
  const enriched = intents.map((intent) => ({
    ...intent,
    workerStatus: workerPool.getStatus(intent.id),
  }));

  sendJson(res, enriched);
}

function handleGetIntent(
  req: IncomingMessage,
  res: ServerResponse,
  intentId: string,
) {
  const wallet = extractWallet(req);
  if (!wallet) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  const intent = repo.getIntent(intentId);
  if (!intent) {
    sendError(res, "Intent not found", 404);
    return;
  }

  if (intent.walletAddress !== wallet) {
    sendError(res, "Forbidden", 403);
    return;
  }

  const workerStatus = workerPool.getStatus(intentId);
  const liveState = workerPool.getState(intentId);

  // Read per-intent logs
  const intentLogger = new IntentLogger(intentId);
  const logs = intentLogger.readAll();

  sendJson(res, {
    ...intent,
    workerStatus,
    liveState,
    logs,
  });
}

async function handleDeleteIntent(
  req: IncomingMessage,
  res: ServerResponse,
  intentId: string,
) {
  const wallet = extractWallet(req);
  if (!wallet) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  const intent = repo.getIntent(intentId);
  if (!intent) {
    sendError(res, "Intent not found", 404);
    return;
  }

  if (intent.walletAddress !== wallet) {
    sendError(res, "Forbidden", 403);
    return;
  }

  // Stop worker and update status
  await workerPool.stop(intentId);
  repo.updateIntentStatus(intentId, "cancelled");

  sendJson(res, { status: "cancelled" });
}

function handleIntentLogs(
  req: IncomingMessage,
  res: ServerResponse,
  intentId: string,
) {
  const wallet = extractWallet(req);
  if (!wallet) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  const intent = repo.getIntent(intentId);
  if (!intent) {
    sendError(res, "Intent not found", 404);
    return;
  }

  if (intent.walletAddress !== wallet) {
    sendError(res, "Forbidden", 403);
    return;
  }

  const intentLogger = new IntentLogger(intentId);
  const filePath = intentLogger.getFilePath();

  if (!existsSync(filePath)) {
    setCors(res);
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="${intentId}.jsonl"`,
    });
    res.end("");
    return;
  }

  setCors(res);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Content-Disposition": `attachment; filename="${intentId}.jsonl"`,
  });
  createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

function serveStaticFile(filePath: string, res: ServerResponse): boolean {
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
  return true;
}

function handleDashboard(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";

  if (url.startsWith("/_next/") || url === "/favicon.ico") {
    const filePath = join(DASHBOARD_DIST, url);
    if (serveStaticFile(filePath, res)) return;
  }

  const dashIndex = join(DASHBOARD_DIST, "index.html");
  if (existsSync(dashIndex)) {
    serveStaticFile(dashIndex, res);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html>
<html><head><title>Veil API</title></head>
<body style="font-family:monospace;background:#0a0c0f;color:#c9d1d9;padding:2rem">
<h1 style="color:#00ff9d">VEIL</h1>
<p>Agent API is running. Dashboard not built yet.</p>
<p>API endpoints:</p>
<ul>
<li>GET /api/auth/nonce?wallet= — request auth nonce</li>
<li>POST /api/auth/verify — verify wallet signature</li>
<li>POST /api/parse-intent — parse intent text</li>
<li>POST /api/intents — create new intent</li>
<li>GET /api/intents?wallet= — list intents</li>
<li>GET /api/intents/:id — get intent detail</li>
<li>DELETE /api/intents/:id — cancel intent</li>
<li>GET /api/intents/:id/logs — download intent logs</li>
</ul>
<p style="color:#6e7681">Build the dashboard: <code>pnpm --filter @veil/dashboard build</code></p>
</body></html>`);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const rawUrl = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname, search } = parseUrl(rawUrl);

  try {
    // Auth routes
    if (pathname === API_PATHS.authNonce && method === "GET") {
      handleAuthNonce(req, res, search);
      return;
    }
    if (pathname === API_PATHS.authVerify && method === "POST") {
      await handleAuthVerify(req, res);
      return;
    }

    // Parse intent (no auth required — used before wallet connected)
    if (pathname === API_PATHS.parseIntent && method === "POST") {
      await handleParseIntent(req, res);
      return;
    }

    // Intent CRUD routes
    if (pathname === API_PATHS.intents && method === "POST") {
      await handleCreateIntent(req, res);
      return;
    }
    if (pathname === API_PATHS.intents && method === "GET") {
      handleListIntents(req, res, search);
      return;
    }

    // Intent sub-routes: /api/intents/:id and /api/intents/:id/logs
    const intentRoute = matchIntentRoute(pathname);
    if (intentRoute) {
      if (intentRoute.sub === "logs" && method === "GET") {
        handleIntentLogs(req, res, intentRoute.intentId);
        return;
      }
      if (!intentRoute.sub && method === "GET") {
        handleGetIntent(req, res, intentRoute.intentId);
        return;
      }
      if (!intentRoute.sub && method === "DELETE") {
        await handleDeleteIntent(req, res, intentRoute.intentId);
        return;
      }
    }

    // SPA fallback
    handleDashboard(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, method, url: rawUrl }, "Request handler error");
    sendError(res, msg, 500);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  // Initialize database
  repo = new IntentRepository(getDb());

  // Wire up worker factory so WorkerPool can create AgentWorker instances
  workerPool.setWorkerFactory(
    (intentId) => new DefaultAgentWorker(intentId, { repo }),
  );

  const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

  logger.info("=".repeat(60));
  logger.info("  VEIL — Dashboard Server");
  logger.info("=".repeat(60));
  logger.info(`  Agent address:  ${agentAccount.address}`);
  logger.info(`  Dashboard:      http://localhost:${PORT}`);
  logger.info(`  API:            http://localhost:${PORT}/api/intents`);
  logger.info("=".repeat(60));

  server.listen(PORT, () => {
    logger.info(`[server] Listening on http://localhost:${PORT}`);
  });

  // Resume active intents from database
  try {
    const result = await resumeActiveIntents(
      repo,
      (intentId) => workerPool.start(intentId),
    );
    if (result.expired > 0 || result.resumed > 0) {
      logger.info(
        { expired: result.expired, resumed: result.resumed },
        "Startup resumption complete",
      );
    }
  } catch (err) {
    logger.error({ err }, "Startup resumption failed");
  }

  // Register agent identity on Base Sepolia (non-blocking)
  try {
    const { txHash, agentId } = await withRetry(
      () => registerAgent(`https://github.com/neilei/veil`, "base-sepolia"),
      { label: "erc8004:register", maxRetries: 3 },
    );
    logger.info(
      { txHash, agentId: agentId?.toString() },
      "ERC-8004 agent registered",
    );
  } catch (err) {
    logger.error({ err }, "ERC-8004 registration failed after retries");
  }
}

startup();
