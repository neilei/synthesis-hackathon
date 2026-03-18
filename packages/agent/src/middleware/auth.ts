import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifyAuthToken } from "../auth.js";

export type AuthEnv = {
  Variables: {
    wallet: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  // Check Authorization header first, then cookie fallback (for SSE EventSource)
  let token: string | undefined;

  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else {
    token = getCookie(c, "veil_token");
  }

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const wallet = verifyAuthToken(token);
  if (!wallet) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("wallet", wallet);
  await next();
});
