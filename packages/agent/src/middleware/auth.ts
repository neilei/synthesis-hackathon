import { createMiddleware } from "hono/factory";
import { verifyAuthToken } from "../auth.js";

export type AuthEnv = {
  Variables: {
    wallet: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  const wallet = verifyAuthToken(token);
  if (!wallet) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("wallet", wallet);
  await next();
});
