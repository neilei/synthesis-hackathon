# Identity JSON Endpoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 401s on `/api/intents/:id/identity.json` by adding a public endpoint that serves ERC-8004 `#registration-v1` JSON documents.

**Architecture:** Add a single public route in `server.ts` before the `requireAuth` middleware (same pattern as the existing `/api/evidence/:intentId/:hash` route). Looks up the intent in the DB, constructs the registration JSON from `parsedIntent`, returns it with cache headers. Clear stale VPS data, deploy, verify.

**Tech Stack:** Hono, SQLite (drizzle-orm), vitest

---

### Task 1: Write failing tests for identity.json endpoint

**Files:**
- Modify: `packages/agent/src/__tests__/server.test.ts`

**Step 1: Add test block for identity.json**

Add a new `describe("Identity JSON route")` block at the end of the test file (before the closing — after the "Evidence route" describe block at line 353):

```typescript
describe("Identity JSON route", () => {
  it("GET /api/intents/:id/identity.json returns registration JSON without auth", async () => {
    // Configure mock repo to return an intent
    const { IntentRepository } = await import("../db/repository.js");
    const mockRepo = new IntentRepository({} as never);
    (mockRepo.getIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "test-intent-123",
      walletAddress: "0x1234",
      intentText: "60/40 ETH/USDC, $100/day, 7 days",
      parsedIntent: JSON.stringify({
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 100,
        timeWindowDays: 7,
        maxTradesPerDay: 5,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
      }),
      status: "active",
      createdAt: 1000000,
      expiresAt: 2000000,
      signedDelegation: "{}",
      delegatorSmartAccount: "0xabc",
      cycle: 0,
      tradesExecuted: 0,
      totalSpentUsd: 0,
      lastCycleAt: null,
      agentId: null,
      permissionsContext: null,
      delegationManager: null,
    });

    const res = await app.request("/api/intents/test-intent-123/identity.json");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(body.name).toBe("Maw Rebalancer — test-int");
    expect(body.description).toContain("60% ETH");
    expect(body.description).toContain("40% USDC");
    expect(body.description).toContain("$100/day");
    expect(body.description).toContain("7 days");
    expect(body.active).toBe(true);
    expect(body.services).toHaveLength(1);
    expect(body.services[0].name).toBe("maw-api");
    expect(body.supportedTrust).toEqual(["reputation"]);
    expect(res.headers.get("cache-control")).toContain("public");
  });

  it("GET /api/intents/:id/identity.json returns 404 for missing intent", async () => {
    const { IntentRepository } = await import("../db/repository.js");
    const mockRepo = new IntentRepository({} as never);
    (mockRepo.getIntent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const res = await app.request("/api/intents/nonexistent/identity.json");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  it("GET /api/intents/:id/identity.json sets active=false for completed intent", async () => {
    const { IntentRepository } = await import("../db/repository.js");
    const mockRepo = new IntentRepository({} as never);
    (mockRepo.getIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "done-intent",
      walletAddress: "0x1234",
      intentText: "test",
      parsedIntent: JSON.stringify({
        targetAllocation: { ETH: 0.5, USDC: 0.5 },
        dailyBudgetUsd: 50,
        timeWindowDays: 3,
        maxTradesPerDay: 5,
        maxSlippage: 0.005,
        driftThreshold: 0.05,
      }),
      status: "completed",
      createdAt: 1000000,
      expiresAt: 2000000,
      signedDelegation: "{}",
      delegatorSmartAccount: "0xabc",
      cycle: 0,
      tradesExecuted: 0,
      totalSpentUsd: 0,
      lastCycleAt: null,
      agentId: null,
      permissionsContext: null,
      delegationManager: null,
    });

    const res = await app.request("/api/intents/done-intent/identity.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/agent && pnpm vitest run src/__tests__/server.test.ts`
Expected: FAIL — 3 tests fail because the route doesn't exist yet (requests hit auth middleware → 401, or SPA fallback → 200 HTML)

---

### Task 2: Implement the identity.json route

**Files:**
- Modify: `packages/agent/src/server.ts` (insert between line 93 and line 95)

**Step 1: Add the public route**

Insert this block after the evidence route (line 93) and before the `// Intent CRUD routes (auth required)` comment (line 95):

```typescript
// Per-intent ERC-8004 identity document (no auth — public, resolved by on-chain agentURI)
app.get("/api/intents/:id/identity.json", (c) => {
  const id = c.req.param("id");
  const intent = repo.getIntent(id);
  if (!intent) {
    return c.json({ error: "Intent not found" }, 404);
  }

  const parsed = JSON.parse(intent.parsedIntent);
  const allocDesc = Object.entries(parsed.targetAllocation ?? {})
    .map(([token, pct]) => `${Math.round(Number(pct) * 100)}% ${token}`)
    .join("/");

  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Maw Rebalancer — ${id.slice(0, 8)}`,
    description: `${allocDesc}, $${parsed.dailyBudgetUsd}/day, ${parsed.timeWindowDays} days`,
    services: [
      { name: "maw-api", endpoint: "https://api.maw.finance", version: "0.1.0" },
    ],
    active: intent.status === "active",
    supportedTrust: ["reputation"],
  });
});
```

Also add `/api/intents/:id/identity.json` to the HTML endpoint listing in the SPA fallback (around line 150):

```html
<li>GET /api/intents/:id/identity.json — ERC-8004 agent identity (public)</li>
```

**Step 2: Run tests to verify they pass**

Run: `cd packages/agent && pnpm vitest run src/__tests__/server.test.ts`
Expected: PASS — all 3 new identity.json tests pass, all existing tests still pass

**Step 3: Run full test suite and lint**

Run: `pnpm run lint && pnpm run test:unit`
Expected: All pass, no lint errors

**Step 4: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/__tests__/server.test.ts
git commit -m "feat: add public /api/intents/:id/identity.json endpoint for ERC-8004

Serves ERC-8004 #registration-v1 JSON documents at the agentURI registered
on-chain. Mounted before requireAuth middleware so indexers (Horizen Labs
ai-agent-registry) can resolve agent identity without authentication.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Clear VPS database and deploy

**Step 1: Clear stale intents on VPS**

```bash
ssh bawler@195.201.8.147 "sudo systemctl stop maw-agent"
ssh bawler@195.201.8.147 "cd /home/bawler/maw && rm -f data/maw.db data/maw.db-wal data/maw.db-shm"
```

The DB will be recreated on next startup via the `getDb()` auto-migration.

**Step 2: Deploy**

```bash
./scripts/deploy.sh deploy
```

**Step 3: Verify endpoint works**

```bash
curl -s https://api.maw.finance/api/intents/nonexistent/identity.json | python3 -m json.tool
```

Expected: `{"error": "Intent not found"}` with 404 status (not 401).

**Step 4: Check haproxy logs for next indexer request**

```bash
ssh bawler@195.201.8.147 "sudo journalctl -u haproxy -f --no-pager 2>/dev/null | grep identity.json"
```

Expected: Within ~2.5 minutes, see requests returning 404 (not 401). Once a new intent is created, requests for that intent ID will return 200 with the registration JSON.
