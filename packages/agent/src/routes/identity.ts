/**
 * Public identity.json endpoint for ERC-8004 on-chain agent identity.
 *
 * Serves at GET /api/intents/:id/identity.json — no auth required because the
 * on-chain agentURI references this URL and must be publicly resolvable.
 *
 * Returns the ERC-8004 registration-v1 JSON format expected by scanners like
 * 8004scan.io. Required fields: type, name, description, image.
 *
 * @see https://eips.ethereum.org/EIPS/eip-8004
 * @see https://best-practices.8004scan.io/docs/implementation/agent-metadata-parsing
 * @module @maw/agent/routes/identity
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { IntentRepository } from "../db/repository.js";
import { env, CONTRACTS } from "../config.js";

export interface IdentityRouteDeps {
  repo: IntentRepository;
}

export function createIdentityRoutes(deps: IdentityRouteDeps) {
  const app = new Hono();

  app.get("/:id/identity.json", (c) => {
    const intentId = c.req.param("id");
    if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
      return c.json({ error: "Invalid intent ID" }, 400);
    }

    const intent = deps.repo.getIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }

    const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);
    const agentId = intent.agentId ? Number(intent.agentId) : null;

    const parsedIntent = intent.parsedIntent
      ? JSON.parse(intent.parsedIntent)
      : null;

    const allocSummary = parsedIntent?.targetAllocation
      ? Object.entries(parsedIntent.targetAllocation)
          .map(([token, pct]) => `${Math.round((pct as number) * 100)}% ${token}`)
          .join(" / ")
      : "";

    // ERC-8004 registration-v1 format
    const identity = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Maw DeFi Rebalancer",
      description: `Autonomous DeFi agent that privately reasons about portfolio rebalancing via Venice AI and executes trades on Uniswap within ERC-7715 delegation constraints. Strategy: ${allocSummary || "custom"}. Budget: $${parsedIntent?.dailyBudgetUsd ?? 0}/day.`,
      image: existsSync(join("data", "images", `${intentId}.webp`))
        ? `https://api.maw.finance/api/intents/${intentId}/avatar.webp`
        : "https://api.maw.finance/maw-agent.svg",
      active: intent.status === "active",
      protocol: "custom",
      x402Support: false,
      services: [
        {
          name: "web",
          endpoint: `https://api.maw.finance/api/intents/${intentId}/identity.json`,
        },
      ],
      registrations: agentId !== null
        ? [
            {
              agentId,
              agentRegistry: `eip155:84532:${CONTRACTS.IDENTITY_BASE_SEPOLIA}`,
            },
          ]
        : [],
      supportedTrust: ["reputation"],
      // Extended metadata (not part of ERC-8004 spec, but useful for consumers)
      maw: {
        intent: {
          id: intent.id,
          status: intent.status,
          createdAt: intent.createdAt,
          expiresAt: intent.expiresAt,
          walletAddress: intent.walletAddress,
          delegationManager: intent.delegationManager,
          targetAllocation: parsedIntent?.targetAllocation ?? null,
          dailyBudgetUsd: parsedIntent?.dailyBudgetUsd ?? null,
          timeWindowDays: parsedIntent?.timeWindowDays ?? null,
        },
        execution: {
          chain: "sepolia",
          chainId: 11155111,
          cycle: intent.cycle,
          tradesExecuted: intent.tradesExecuted,
          totalSpentUsd: intent.totalSpentUsd,
        },
        identity: {
          chain: "base-sepolia",
          chainId: 84532,
          registry: CONTRACTS.IDENTITY_BASE_SEPOLIA,
          agentId,
          owner: agentAccount.address,
        },
        reputation: {
          registry: CONTRACTS.REPUTATION_BASE_SEPOLIA,
        },
        validation: {
          registry: CONTRACTS.VALIDATION_BASE_SEPOLIA,
        },
      },
    };

    c.header("Content-Type", "application/json");
    c.header("Cache-Control", "public, max-age=60");
    return c.json(identity);
  });

  return app;
}
