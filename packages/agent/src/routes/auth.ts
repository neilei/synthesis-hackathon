import { Hono } from "hono";
import { recoverMessageAddress } from "viem";
import type { IntentRepository } from "../db/repository.js";
import {
  generateNonce,
  createAuthToken,
  NONCE_TTL_SECONDS,
} from "../auth.js";

export interface AuthRouteDeps {
  repo: IntentRepository;
}

export function createAuthRoutes(deps: AuthRouteDeps) {
  const app = new Hono();

  // GET /nonce?wallet=0x...
  app.get("/nonce", (c) => {
    const wallet = c.req.query("wallet");
    if (!wallet) {
      return c.json({ error: "Missing wallet query parameter" }, 400);
    }

    const nonce = generateNonce();
    deps.repo.upsertNonce(wallet.toLowerCase(), nonce);
    return c.json({ nonce });
  });

  // POST /verify  { wallet, signature }
  app.post("/verify", async (c) => {
    const body = await c.req.json();
    const wallet = typeof body.wallet === "string" ? body.wallet : null;
    const signature =
      typeof body.signature === "string" ? body.signature : null;

    if (!wallet || !signature) {
      return c.json({ error: "Missing wallet or signature" }, 400);
    }

    const walletLower = wallet.toLowerCase();
    const nonceRecord = deps.repo.getNonce(walletLower);
    if (!nonceRecord) {
      return c.json(
        { error: "No nonce found — request /api/auth/nonce first" },
        401,
      );
    }

    // Check nonce expiry
    const now = Math.floor(Date.now() / 1000);
    if (now - nonceRecord.createdAt > NONCE_TTL_SECONDS) {
      deps.repo.deleteNonce(walletLower);
      return c.json({ error: "Nonce expired" }, 401);
    }

    // Verify signature
    try {
      const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonceRecord.nonce}`;
      const recovered = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      });

      if (recovered.toLowerCase() !== walletLower) {
        return c.json(
          { error: "Signature does not match wallet" },
          401,
        );
      }
    } catch {
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Clean up nonce and issue token
    deps.repo.deleteNonce(walletLower);
    const token = createAuthToken(walletLower);
    return c.json({ token });
  });

  return app;
}
