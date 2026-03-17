import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthRoutes } from "../auth.js";
import type { IntentRepository } from "../../db/repository.js";

// Mock viem
vi.mock("viem", () => ({
  recoverMessageAddress: vi.fn(),
}));
import { recoverMessageAddress } from "viem";
const mockRecover = vi.mocked(recoverMessageAddress);

// Mock auth module
vi.mock("../../auth.js", () => ({
  generateNonce: vi.fn().mockReturnValue("mock-nonce-abc"),
  createAuthToken: vi.fn().mockReturnValue("mock-token-xyz"),
  verifyAuthToken: vi.fn(),
  NONCE_TTL_SECONDS: 300,
}));

function createMockRepo(): IntentRepository {
  return {
    upsertNonce: vi.fn(),
    getNonce: vi.fn(),
    deleteNonce: vi.fn(),
    createIntent: vi.fn(),
    getIntent: vi.fn(),
    getIntentsByWallet: vi.fn(),
    getActiveIntents: vi.fn(),
    updateIntentStatus: vi.fn(),
    updateIntentCycleState: vi.fn(),
    updateIntentAgentId: vi.fn(),
    markExpiredIntents: vi.fn(),
    insertSwap: vi.fn(),
    getSwapsByIntent: vi.fn(),
  } as unknown as IntentRepository;
}

describe("auth routes", () => {
  let repo: IntentRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockRepo();
  });

  describe("GET /nonce", () => {
    it("returns nonce for a wallet", async () => {
      const app = createAuthRoutes({ repo });
      const res = await app.request("/nonce?wallet=0x1234");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nonce).toBe("mock-nonce-abc");
      expect(vi.mocked(repo.upsertNonce)).toHaveBeenCalledWith(
        "0x1234",
        "mock-nonce-abc",
      );
    });

    it("returns 400 when wallet is missing", async () => {
      const app = createAuthRoutes({ repo });
      const res = await app.request("/nonce");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Missing wallet query parameter");
    });
  });

  describe("POST /verify", () => {
    it("returns token on valid signature", async () => {
      const now = Math.floor(Date.now() / 1000);
      vi.mocked(repo.getNonce).mockReturnValue({
        walletAddress: "0xabcd",
        nonce: "stored-nonce",
        createdAt: now,
      });
      mockRecover.mockResolvedValue("0xABCD" as `0x${string}`);

      const app = createAuthRoutes({ repo });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: "0xABCD",
          signature: "0xdeadbeef",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBe("mock-token-xyz");
    });

    it("returns 400 when wallet or signature is missing", async () => {
      const app = createAuthRoutes({ repo });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: "0x1234" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 when no nonce found", async () => {
      vi.mocked(repo.getNonce).mockReturnValue(null);
      const app = createAuthRoutes({ repo });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: "0x1234",
          signature: "0xdeadbeef",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when nonce is expired", async () => {
      vi.mocked(repo.getNonce).mockReturnValue({
        walletAddress: "0x1234",
        nonce: "old-nonce",
        createdAt: Math.floor(Date.now() / 1000) - 400, // expired (> 300s)
      });
      const app = createAuthRoutes({ repo });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: "0x1234",
          signature: "0xdeadbeef",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when signature does not match wallet", async () => {
      const now = Math.floor(Date.now() / 1000);
      vi.mocked(repo.getNonce).mockReturnValue({
        walletAddress: "0x1234",
        nonce: "some-nonce",
        createdAt: now,
      });
      mockRecover.mockResolvedValue("0xDIFFERENT" as `0x${string}`);

      const app = createAuthRoutes({ repo });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: "0x1234",
          signature: "0xdeadbeef",
        }),
      });
      expect(res.status).toBe(401);
    });
  });
});
