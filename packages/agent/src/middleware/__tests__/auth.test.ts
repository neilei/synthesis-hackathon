import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireAuth, type AuthEnv } from "../auth.js";

// Mock the auth module
vi.mock("../../auth.js", () => ({
  verifyAuthToken: vi.fn(),
}));

import { verifyAuthToken } from "../../auth.js";

const mockVerify = vi.mocked(verifyAuthToken);

describe("requireAuth middleware", () => {
  let app: Hono<AuthEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono<AuthEnv>();
    app.use("/*", requireAuth);
    app.get("/test", (c) => c.json({ wallet: c.var.wallet }));
  });

  it("returns 401 when no Authorization header", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when token is invalid", async () => {
    mockVerify.mockReturnValue(null);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
  });

  it("sets wallet on context when token is valid", async () => {
    mockVerify.mockReturnValue("0xabc123");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer good-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallet).toBe("0xabc123");
  });

  it("does not call verifyAuthToken when header is missing", async () => {
    await app.request("/test");
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
