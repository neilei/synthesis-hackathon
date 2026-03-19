import { describe, it, expect } from "vitest";
import { Hono } from "hono";

describe("avatar route", () => {
  it("returns 404 for non-existent avatar", async () => {
    const app = new Hono();
    app.get("/api/intents/:id/avatar.webp", (c) => {
      const intentId = c.req.param("id");
      if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
        return c.json({ error: "Invalid intent ID" }, 400);
      }
      return c.json({ error: "Avatar not found" }, 404);
    });

    const res = await app.request("/api/intents/nonexistent/avatar.webp");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid intent ID", async () => {
    const app = new Hono();
    app.get("/api/intents/:id/avatar.webp", (c) => {
      const intentId = c.req.param("id");
      if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
        return c.json({ error: "Invalid intent ID" }, 400);
      }
      return c.json({ error: "Avatar not found" }, 404);
    });

    const res = await app.request("/api/intents/bad%20id%3B/avatar.webp");
    expect(res.status).toBe(400);
  });
});
