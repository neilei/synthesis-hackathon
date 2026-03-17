/**
 * E2E tests for the HTTP server against a live agent instance.
 *
 * @module @veil/agent/server.e2e.test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

/**
 * E2E tests for the server HTTP endpoints.
 * Spawns the actual server as a subprocess, hits real HTTP endpoints.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3148;
const BASE = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;

// Isolated temp DB so parallel e2e test suites don't conflict
const tmpDir = mkdtempSync(join(tmpdir(), "veil-server-e2e-"));
const DB_PATH = join(tmpDir, "test.db");

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/auth/nonce?wallet=0x1234`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("Server E2E", () => {
  beforeAll(async () => {
    // Spawn server on a different port to avoid conflicts
    // Use __dirname to resolve path relative to this test file, not cwd
    serverProcess = spawn(
      "npx",
      ["tsx", join(__dirname, "../server.ts")],
      {
        env: { ...process.env, PORT: String(PORT), DB_PATH },
        stdio: "pipe",
      },
    );

    // Capture stderr for debugging if server fails to start
    let stderr = "";
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer();
    } catch {
      serverProcess.kill();
      throw new Error(`Server failed to start. stderr: ${stderr}`);
    }
  }, 40000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("GET /api/auth/nonce returns nonce for wallet", async () => {
    const res = await fetch(`${BASE}/api/auth/nonce?wallet=0x1234`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(0);
  });

  it("GET /api/auth/nonce returns 400 without wallet", async () => {
    const res = await fetch(`${BASE}/api/auth/nonce`);
    expect(res.status).toBe(400);
  });

  it("GET /api/intents returns 401 without auth", async () => {
    const res = await fetch(`${BASE}/api/intents?wallet=0x1234`);
    expect(res.status).toBe(401);
  });

  it("POST /api/parse-intent returns 400 for missing intent", async () => {
    const res = await fetch(`${BASE}/api/parse-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing intent");
  });

  it("GET /api/auth/nonce includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/auth/nonce?wallet=0x1234`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await fetch(`${BASE}/api/parse-intent`, { method: "OPTIONS" });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("GET / serves the dashboard HTML", async () => {
    const res = await fetch(`${BASE}/`);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");

    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("GET /_next/static/ directory path falls through to SPA (not 500)", async () => {
    const res = await fetch(`${BASE}/_next/static/`);

    // Directory paths should fall through to SPA fallback, not 500
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("GET /nonexistent serves SPA fallback (not JSON 404)", async () => {
    const res = await fetch(`${BASE}/nonexistent`);

    // SPA fallback serves HTML, not a JSON error
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });
});
