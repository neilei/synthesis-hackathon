/**
 * HTTP server (port 3147) exposing wallet-scoped intent API.
 * Serves the Next.js dashboard static build as a SPA fallback.
 *
 * @module @veil/agent/server
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "path";
import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

import { env } from "./config.js";
import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";
import { logger } from "./logging/logger.js";
import { IntentRepository } from "./db/repository.js";
import { getDb } from "./db/connection.js";
import { WorkerPool } from "./worker-pool.js";
import { DefaultAgentWorker } from "./agent-worker.js";
import { resumeActiveIntents } from "./startup.js";

import { requireAuth } from "./middleware/auth.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createParseRoutes } from "./routes/parse.js";
import { createIntentRoutes } from "./routes/intents.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : DEFAULT_AGENT_PORT;
const DASHBOARD_DIST = join("apps", "dashboard", "out");

// Singleton instances — initialized at startup
let repo: IntentRepository;
const workerPool = new WorkerPool({ maxConcurrency: 5 });

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

export const app = new Hono();

// Global error handler — returns JSON errors and logs via pino
app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err, method: c.req.method, url: c.req.url }, "Request handler error");
  return c.json({ error: msg }, 500);
});

// CORS
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// Lazy deps — repo is initialized in startup(), but routes only access it at
// request time, so a getter is safe here.
const lazyDeps = {
  get repo() {
    return repo;
  },
};

// Auth routes (no auth middleware required) — mount at /api/auth (covers /nonce and /verify)
const authBase = API_PATHS.authNonce.replace(/\/nonce$/, "");
app.route(authBase, createAuthRoutes(lazyDeps));

// Parse intent (no auth required — used before wallet connected)
app.route(API_PATHS.parseIntent, createParseRoutes());

// Evidence documents (no auth — public, content-addressed, immutable)
app.get("/api/evidence/:intentId/:hash", (c) => {
  const { intentId, hash } = c.req.param();
  if (!/^[a-zA-Z0-9-]+$/.test(intentId) || !/^0x[a-f0-9]+$/.test(hash)) {
    return c.json({ error: "Invalid parameters" }, 400);
  }
  const filePath = join("data", "evidence", intentId, `${hash}.json`);
  if (!existsSync(filePath)) {
    return c.json({ error: "Evidence not found" }, 404);
  }
  const content = readFileSync(filePath, "utf-8");
  c.header("Content-Type", "application/json");
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(content);
});

// Intent CRUD routes (auth required)
// Both patterns needed: /* matches sub-paths, bare path matches exact /api/intents
app.use(`${API_PATHS.intents}/*`, requireAuth);
app.use(API_PATHS.intents, requireAuth);
app.route(
  API_PATHS.intents,
  createIntentRoutes({
    get repo() {
      return repo;
    },
    workerPool,
  }),
);

// ---------------------------------------------------------------------------
// Dashboard static files + SPA fallback
// ---------------------------------------------------------------------------

app.use(
  "/_next/*",
  serveStatic({ root: DASHBOARD_DIST }),
);
app.use(
  "/favicon.ico",
  serveStatic({ root: DASHBOARD_DIST }),
);

// SPA fallback — serve index.html for all non-API routes.
// Read once at mount time to avoid blocking readFileSync on every request.
const indexPath = join(DASHBOARD_DIST, "index.html");
const cachedIndexHtml = existsSync(indexPath)
  ? readFileSync(indexPath, "utf-8")
  : null;

app.get("*", (c) => {
  if (cachedIndexHtml) {
    return c.html(cachedIndexHtml);
  }

  return c.html(`<!doctype html>
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
<li>GET /api/evidence/:intentId/:hash — retrieve evidence document</li>
</ul>
<p style="color:#6e7681">Build the dashboard: <code>pnpm --filter @veil/dashboard build</code></p>
</body></html>`);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  // Initialize database (DB_PATH env var allows e2e tests to use isolated DBs)
  const dbPath = process.env.DB_PATH || "data/veil.db";
  repo = new IntentRepository(getDb(dbPath));

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

  serve({ fetch: app.fetch, port: PORT }, () => {
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
}

startup();
