/**
 * HTTP server (port 3147) exposing POST /api/deploy and GET /api/state endpoints.
 * Serves the Next.js dashboard static build as a SPA fallback.
 *
 * @module @veil/agent/server
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, readFile, existsSync } from "fs";
import { join, extname } from "path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { env } from "./config.js";
import { compileIntent } from "./delegation/compiler.js";
import { getAgentState, getAgentConfig, runAgentLoop } from "./agent-loop.js";
import { registerAgent } from "./identity/erc8004.js";
import { DEFAULT_AGENT_PORT, API_PATHS, type AgentLogEntry, type AgentStateResponse, type DeployResponse } from "@veil/common";
import { logger } from "./logging/logger.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : DEFAULT_AGENT_PORT;
const DASHBOARD_DIST = join(process.cwd(), "apps", "dashboard", "out");
const LOG_PATH = join(process.cwd(), "agent_log.jsonl");

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
// Read agent_log.jsonl feed
// ---------------------------------------------------------------------------

function readLogFeed(): AgentLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const raw = readFileSync(LOG_PATH, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentLogEntry);
  } catch {
    return [];
  }
}

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleDeploy(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req);
  const intentText = body.intent as string;
  if (!intentText) {
    sendJson(res, { error: "Missing intent" }, 400);
    return;
  }

  // Check if agent is already running
  const existing = getAgentState();
  if (existing?.running) {
    sendJson(res, { error: "Agent already running" }, 409);
    return;
  }

  try {
    logger.info(`[server] Parsing intent: "${intentText}"`);
    const parsed = await compileIntent(intentText);

    const delegatorKey = env.DELEGATOR_PRIVATE_KEY ?? generatePrivateKey();

    // Start agent loop in background (don't await — it runs indefinitely)
    runAgentLoop({
      intent: parsed,
      delegatorKey,
      agentKey: env.AGENT_PRIVATE_KEY,
      chainId: 11155111,
      intervalMs: 60_000,
    }).catch((err) => {
      logger.error({ err }, "[server] Agent loop crashed");
    });

    // Wait briefly for delegation + audit to be generated
    await new Promise((r) => setTimeout(r, 3000));

    const state = getAgentState();
    const deployResponse: DeployResponse = {
      parsed,
      audit: state?.audit
        ? {
            allows: state.audit.allows,
            prevents: state.audit.prevents,
            worstCase: state.audit.worstCase,
            warnings: state.audit.warnings,
          }
        : null,
    };
    sendJson(res, deployResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[server] Deploy failed: %s", msg);
    sendJson(res, { error: msg }, 500);
  }
}

function handleState(_req: IncomingMessage, res: ServerResponse) {
  const state = getAgentState();
  const config = getAgentConfig();

  if (!state || !config) {
    const defaultState: AgentStateResponse = {
      cycle: 0,
      running: false,
      ethPrice: 0,
      drift: 0,
      trades: 0,
      totalSpent: 0,
      budgetTier: "normal",
      allocation: {},
      target: {},
      totalValue: 0,
      feed: readLogFeed(),
      transactions: [],
      audit: null,
    };
    sendJson(res, defaultState);
    return;
  }

  const response: AgentStateResponse = {
    cycle: state.cycle,
    running: state.running,
    ethPrice: state.ethPrice,
    drift: state.drift,
    trades: state.tradesExecuted,
    totalSpent: state.totalSpentUsd,
    budgetTier: state.budgetTier,
    allocation: state.allocation,
    target: config.intent.targetAllocation,
    totalValue: state.totalValue,
    feed: readLogFeed(),
    transactions: state.transactions,
    audit: state.audit
      ? {
          allows: state.audit.allows,
          prevents: state.audit.prevents,
          worstCase: state.audit.worstCase,
          warnings: state.audit.warnings,
        }
      : null,
  };
  sendJson(res, response);
}

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

  // Try serving static assets from Next.js dashboard build
  if (url.startsWith("/_next/") || url === "/favicon.ico") {
    const filePath = join(DASHBOARD_DIST, url);
    if (serveStaticFile(filePath, res)) return;
  }

  // Serve dashboard index.html (SPA fallback)
  const dashIndex = join(DASHBOARD_DIST, "index.html");
  if (existsSync(dashIndex)) {
    serveStaticFile(dashIndex, res);
  } else {
    // Dashboard not built yet — serve minimal status page
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html>
<html><head><title>Veil API</title></head>
<body style="font-family:monospace;background:#0a0c0f;color:#c9d1d9;padding:2rem">
<h1 style="color:#00ff9d">VEIL</h1>
<p>Agent API is running. Dashboard not built yet.</p>
<p>API endpoints:</p>
<ul>
<li><a href="/api/state" style="color:#00ff9d">/api/state</a> — agent status</li>
<li>POST /api/deploy — deploy agent with intent</li>
</ul>
<p style="color:#6e7681">Build the dashboard: <code>pnpm --filter @veil/dashboard build</code></p>
</body></html>`);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url === API_PATHS.deploy && method === "POST") {
      await handleDeploy(req, res);
    } else if (url === API_PATHS.state && method === "GET") {
      handleState(req, res);
    } else {
      // Serve React SPA (or static assets / vanilla fallback)
      handleDashboard(req, res);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[server] ${method} ${url} error: ${msg}`);
    sendJson(res, { error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

  logger.info("=".repeat(60));
  logger.info("  VEIL — Dashboard Server");
  logger.info("=".repeat(60));
  logger.info(`  Agent address:  ${agentAccount.address}`);
  logger.info(`  Dashboard:      http://localhost:${PORT}`);
  logger.info(`  API:            http://localhost:${PORT}/api/state`);
  logger.info("=".repeat(60));

  // Register agent identity on Base Sepolia (non-blocking)
  registerAgent(
    `https://github.com/neilei/veil`,
    "base-sepolia",
  )
    .then(({ txHash, agentId }) => {
      logger.info(`[erc8004] Agent registered on Base Sepolia`);
      logger.info(`[erc8004] TX: ${txHash}`);
      if (agentId) logger.info(`[erc8004] Agent ID: ${agentId}`);
    })
    .catch((err) => {
      // Non-fatal — may already be registered or Base Sepolia may be down
      logger.info(
        `[erc8004] Registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  server.listen(PORT, () => {
    logger.info(`[server] Listening on http://localhost:${PORT}`);
    logger.info(
      `[server] Open dashboard or POST /api/deploy to start agent`,
    );
  });
}

startup();
