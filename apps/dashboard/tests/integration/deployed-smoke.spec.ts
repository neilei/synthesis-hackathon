/**
 * Smoke tests against the deployed VPS instance at 195.201.8.147:3147.
 * Run: INTEGRATION=1 DEPLOYED_URL=http://195.201.8.147:3147 pnpm --filter @veil/dashboard test:e2e --project integration
 *
 * These tests verify the deployed instance is serving correctly —
 * dashboard HTML, API endpoints, CORS headers, and SPA fallback.
 *
 * @module @veil/dashboard/tests/integration/deployed-smoke.spec
 */
import { test, expect } from "@playwright/test";

const DEPLOYED_URL =
  process.env.DEPLOYED_URL ?? "http://195.201.8.147:3147";

test.describe("Deployed VPS Smoke Tests", () => {
  test("dashboard serves HTML with Veil content", async ({ request }) => {
    const response = await request.get(DEPLOYED_URL);
    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/html");
    const html = await response.text();
    expect(html.toLowerCase()).toContain("<!doctype html");
    // Should contain either the built dashboard or the fallback API page
    expect(html.toLowerCase()).toContain("veil");
  });

  test("API nonce endpoint returns valid JSON", async ({ request }) => {
    const response = await request.get(
      `${DEPLOYED_URL}/api/auth/nonce?wallet=0xf13021F02E23a8113C1bD826575a1682F6Fac927`,
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(0);
  });

  test("API nonce endpoint returns 400 without wallet", async ({
    request,
  }) => {
    const response = await request.get(`${DEPLOYED_URL}/api/auth/nonce`);
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });

  test("API parse-intent returns 400 for empty body", async ({ request }) => {
    const response = await request.post(
      `${DEPLOYED_URL}/api/parse-intent`,
      { data: {} },
    );
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing intent");
  });

  test("API intents returns 401 without auth", async ({ request }) => {
    const response = await request.get(
      `${DEPLOYED_URL}/api/intents?wallet=0x1234`,
    );
    expect(response.status()).toBe(401);
  });

  test("CORS headers present on API responses", async ({ request }) => {
    const response = await request.get(
      `${DEPLOYED_URL}/api/auth/nonce?wallet=0x1234`,
    );
    const headers = response.headers();
    expect(headers["access-control-allow-origin"]).toBe("*");
  });

  test("OPTIONS preflight returns 204 with CORS", async ({ request }) => {
    const response = await request.fetch(
      `${DEPLOYED_URL}/api/parse-intent`,
      { method: "OPTIONS" },
    );
    expect(response.status()).toBe(204);
    const headers = response.headers();
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["access-control-allow-methods"]).toContain("POST");
  });

  test("static assets referenced in HTML are served", async ({ request }) => {
    // Fetch the dashboard HTML and extract a real asset URL
    const htmlResponse = await request.get(DEPLOYED_URL);
    const html = await htmlResponse.text();
    const cssMatch = html.match(/\/_next\/static\/[^"]+\.css/);
    const jsMatch = html.match(/\/_next\/static\/[^"]+\.js/);

    if (cssMatch) {
      const cssResponse = await request.get(`${DEPLOYED_URL}${cssMatch[0]}`);
      expect(cssResponse.status()).toBe(200);
      expect(cssResponse.headers()["content-type"]).toContain("text/css");
    }

    if (jsMatch) {
      const jsResponse = await request.get(`${DEPLOYED_URL}${jsMatch[0]}`);
      expect(jsResponse.status()).toBe(200);
      expect(jsResponse.headers()["content-type"]).toContain("application/javascript");
    }

    // At least one asset should exist in a built dashboard
    expect(cssMatch || jsMatch).toBeTruthy();
  });

  test("SPA fallback serves HTML for unknown routes", async ({ request }) => {
    const response = await request.get(`${DEPLOYED_URL}/nonexistent-route`);
    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/html");
  });

  test("API intent sub-routes return 401 without auth", async ({
    request,
  }) => {
    const response = await request.get(
      `${DEPLOYED_URL}/api/intents/fake-id`,
    );
    expect(response.status()).toBe(401);
  });

  test("API intent logs route returns 401 without auth", async ({
    request,
  }) => {
    const response = await request.get(
      `${DEPLOYED_URL}/api/intents/fake-id/logs`,
    );
    expect(response.status()).toBe(401);
  });
});
