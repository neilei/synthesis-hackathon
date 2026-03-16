/**
 * E2E tests for the HTTP server against a live agent instance.
 *
 * @module @veil/agent/server.e2e.test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * E2E tests for the server HTTP endpoints.
 * Spawns the actual server as a subprocess, hits real HTTP endpoints.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3148;
const BASE = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/state`);
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
        env: { ...process.env, PORT: String(PORT) },
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
  });

  it("GET /api/state returns valid JSON with expected fields", async () => {
    const res = await fetch(`${BASE}/api/state`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();

    // All expected fields must be present
    expect(typeof data.cycle).toBe("number");
    expect(typeof data.running).toBe("boolean");
    expect(typeof data.ethPrice).toBe("number");
    expect(typeof data.drift).toBe("number");
    expect(typeof data.trades).toBe("number");
    expect(typeof data.totalSpent).toBe("number");
    expect(typeof data.budgetTier).toBe("string");
    expect(typeof data.allocation).toBe("object");
    expect(typeof data.target).toBe("object");
    expect(typeof data.totalValue).toBe("number");
    expect(Array.isArray(data.feed)).toBe(true);
    expect(Array.isArray(data.transactions)).toBe(true);

    // Agent not running — default state
    expect(data.running).toBe(false);
    expect(data.cycle).toBe(0);
  });

  it("GET /api/state includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/state`);

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await fetch(`${BASE}/api/state`, { method: "OPTIONS" });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("POST /api/deploy with missing intent returns 400", async () => {
    const res = await fetch(`${BASE}/api/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing intent");
  });

  it("POST /api/deploy with invalid JSON returns 500", async () => {
    const res = await fetch(`${BASE}/api/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET / serves the dashboard HTML", async () => {
    const res = await fetch(`${BASE}/`);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");

    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("GET /nonexistent serves SPA fallback (not JSON 404)", async () => {
    const res = await fetch(`${BASE}/nonexistent`);

    // SPA fallback serves HTML, not a JSON error
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });
});
