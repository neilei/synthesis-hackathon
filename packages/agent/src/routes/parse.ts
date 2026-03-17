import { Hono } from "hono";
import { compileIntent } from "../delegation/compiler.js";
import { generateAuditReport } from "@veil/common";
import { logger } from "../logging/logger.js";

export function createParseRoutes() {
  const app = new Hono();

  // POST /  (mounted at /api/parse-intent)
  app.post("/", async (c) => {
    const body = await c.req.json();
    const intentText =
      typeof body.intent === "string" ? body.intent.trim() : null;
    if (!intentText) {
      return c.json({ error: "Missing intent text" }, 400);
    }

    try {
      const parsed = await compileIntent(intentText);
      const audit = generateAuditReport(parsed);
      return c.json({ parsed, audit });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Parse intent failed");
      return c.json({ error: msg }, 500);
    }
  });

  return app;
}
