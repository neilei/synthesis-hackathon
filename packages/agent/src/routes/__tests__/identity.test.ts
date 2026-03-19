import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createIdentityRoutes } from "../identity.js";
import type { IntentRepository } from "../../db/repository.js";

vi.mock("../../config.js", () => ({
  env: {
    AGENT_PRIVATE_KEY:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  CONTRACTS: {
    IDENTITY_BASE_SEPOLIA: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    REPUTATION_BASE_SEPOLIA: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    VALIDATION_BASE_SEPOLIA: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
}));

function createMockRepo(intent: unknown): IntentRepository {
  return {
    getIntent: vi.fn().mockReturnValue(intent),
  } as unknown as IntentRepository;
}

const SAMPLE_INTENT = {
  id: "test-intent-123",
  walletAddress: "0xWALLET",
  intentText: "60/40 ETH/USDC",
  parsedIntent: JSON.stringify({
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
  }),
  status: "active" as const,
  createdAt: 1700000000,
  expiresAt: 1700604800,
  signedDelegation: "0xdel",
  delegatorSmartAccount: "0xSA",
  cycle: 5,
  tradesExecuted: 3,
  totalSpentUsd: 150.5,
  agentId: "2191",
};

describe("identity.json route", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  it("returns ERC-8004 registration-v1 format", async () => {
    const repo = createMockRepo(SAMPLE_INTENT);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/test-intent-123/identity.json");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe(
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    );
    expect(body.name).toBe("Veil DeFi Rebalancer");
    expect(body.description).toContain("60% ETH / 40% USDC");
    expect(body.description).toContain("$200/day");
    expect(body.image).toBe("https://veil.moe/veil-agent.svg");
    expect(body.active).toBe(true);
    expect(body.supportedTrust).toEqual(["reputation"]);
  });

  it("includes registrations with agentId", async () => {
    const repo = createMockRepo(SAMPLE_INTENT);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/test-intent-123/identity.json");
    const body = await res.json();

    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0].agentId).toBe(2191);
    expect(body.registrations[0].agentRegistry).toContain("eip155:84532:");
  });

  it("includes veil-specific metadata", async () => {
    const repo = createMockRepo(SAMPLE_INTENT);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/test-intent-123/identity.json");
    const body = await res.json();

    expect(body.veil.intent.id).toBe("test-intent-123");
    expect(body.veil.intent.targetAllocation).toEqual({ ETH: 0.6, USDC: 0.4 });
    expect(body.veil.execution.cycle).toBe(5);
    expect(body.veil.identity.agentId).toBe(2191);
    expect(body.veil.identity.registry).toBe(
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    );
  });

  it("returns 404 for unknown intent", async () => {
    const repo = createMockRepo(null);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/nonexistent/identity.json");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid intent ID with special characters", async () => {
    const repo = createMockRepo(null);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request(
      "/api/intents/bad%20id%3B%20drop/identity.json",
    );
    expect(res.status).toBe(400);
  });

  it("handles intent with no agentId", async () => {
    const intentNoAgent = { ...SAMPLE_INTENT, agentId: null };
    const repo = createMockRepo(intentNoAgent);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/test-intent-123/identity.json");
    const body = await res.json();

    expect(body.veil.identity.agentId).toBeNull();
    expect(body.registrations).toEqual([]);
  });

  it("marks inactive intents as not active", async () => {
    const expired = { ...SAMPLE_INTENT, status: "expired" as const };
    const repo = createMockRepo(expired);
    app.route("/api/intents", createIdentityRoutes({ repo }));

    const res = await app.request("/api/intents/test-intent-123/identity.json");
    const body = await res.json();

    expect(body.active).toBe(false);
  });
});
