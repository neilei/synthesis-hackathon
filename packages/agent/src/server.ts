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
import { registerAgent } from "./identity/erc8004.js";
import { DEFAULT_AGENT_PORT } from "@veil/common";
import { logger } from "./logging/logger.js";
import { withRetry } from "./utils/retry.js";
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
const DASHBOARD_DIST = join(process.cwd(), "apps", "dashboard", "out");

// Singleton instances — initialized at startup
let repo: IntentRepository;
let serverAgentId: bigint | undefined;
const workerPool = new WorkerPool({ maxConcurrency: 5 });

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

export const app = new Hono();

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

// Auth routes (no auth middleware required)
app.route("/api/auth", createAuthRoutes(lazyDeps));

// Parse intent (no auth required — used before wallet connected)
app.route("/api/parse-intent", createParseRoutes());

// Intent CRUD routes (auth required)
app.use("/api/intents/*", requireAuth);
app.use("/api/intents", requireAuth);
app.route(
  "/api/intents",
  createIntentRoutes({ ...lazyDeps, workerPool }),
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

// SPA fallback — serve index.html for all non-API routes
app.get("*", (c) => {
  const indexPath = join(DASHBOARD_DIST, "index.html");
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
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

  // Wire up worker factory
  workerPool.setWorkerFactory(
    (intentId) => new DefaultAgentWorker(intentId, { repo, serverAgentId }),
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

  // Register agent identity on Base Sepolia
  try {
    const { txHash, agentId } = await withRetry(
      () => registerAgent(`https://github.com/neilei/veil`, "base-sepolia"),
      { label: "erc8004:register", maxRetries: 3 },
    );
    if (agentId) {
      serverAgentId = agentId;
    }
    logger.info(
      { txHash, agentId: agentId?.toString() },
      "ERC-8004 agent registered — ID will be passed to all workers",
    );
  } catch (err) {
    logger.error(
      { err },
      "ERC-8004 registration failed after retries — workers will register individually",
    );
  }
}

startup();
