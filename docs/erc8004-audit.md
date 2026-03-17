# ERC-8004 Reputation System — Audit & Issues

**Date:** 2026-03-16
**Status:** All issues addressed in redesign — see `docs/plans/2026-03-17-erc8004-redesign-design.md`

---

## Overview

The ERC-8004 integration provides on-chain agent identity (NFT registration) and reputation feedback on Base Sepolia. It has two operational flows:

1. **Identity Registration** — Mint an ERC-721 NFT on the IdentityRegistry to get an `agentId`
2. **Reputation Feedback** — Write feedback entries on the ReputationRegistry after successful swaps

### File Map

| File | Role |
|------|------|
| `packages/agent/src/identity/erc8004.ts` | Core functions: `registerAgent`, `giveFeedback`, `getReputationSummary` |
| `packages/common/src/erc8004-abi.ts` | Shared human-readable ABI fragments for both registries |
| `packages/agent/src/config.ts:66-76` | Contract addresses (Base Sepolia + Base Mainnet) |
| `packages/agent/src/agent-loop.ts:148-166` | Registration call at agent loop startup |
| `packages/agent/src/agent-loop.ts:707-722` | Feedback call after each successful swap |
| `packages/agent/src/server.ts:321-330` | Registration call at server startup |
| `apps/dashboard/components/monitor.tsx:344` | Cosmetic "Identity via ERC-8004" badge |
| `packages/common/src/schemas.ts:77-94` | `AgentStateResponse` schema (no agentId field) |
| `docs/erc8004-tech.md` | ERC-8004 spec reference |

### Contract Addresses

```
Base Sepolia (canonical, same on all EVM chains):
  IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
  ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713

Base Mainnet (Base-specific deployment):
  IdentityRegistry:   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
  ReputationRegistry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
```

---

## How It Currently Works

### Registration Flow

1. Server starts (`server.ts:303`) → calls `registerAgent("https://github.com/neilei/veil", "base-sepolia")` at line 324
2. User deploys agent via `/api/deploy` → `runAgentLoop()` starts → calls `registerAgent()` **again** at `agent-loop.ts:151`
3. Each call mints a **new** NFT (new `agentId` = new tokenId)
4. Agent loop stores `agentId` in `state.agentId`; server startup discards it

### Feedback Flow

1. Swap executes successfully (`agent-loop.ts:702`)
2. If `state.agentId` is set, calls `giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")` at line 709
3. Fire-and-forget: `.then()` logs success, `.catch()` logs warning
4. Uses the same `AGENT_PRIVATE_KEY` wallet that owns the NFT

### Dashboard

- `monitor.tsx:344` renders `<SponsorBadge text="Identity via ERC-8004" />` — purely cosmetic
- No agentId display, no reputation data, no link to on-chain identity

---

## Issues Found

### HIGH: Self-feedback reverts on-chain (#3)

**Location:** `agent-loop.ts:709`

The agent calls `giveFeedback(state.agentId, ...)` using the same `AGENT_PRIVATE_KEY` wallet that minted the NFT (and therefore owns it). The ERC-8004 spec explicitly states:

> "Agent owner/operators CANNOT submit feedback for own agent" (erc8004-tech.md:135)

The contract will **revert** every time. The error is silently caught by `.catch()` at line 717-718 and logged as a warning. **The entire reputation feedback system is non-functional.**

**Evidence:** Both `registerAgent()` and `giveFeedback()` use `privateKeyToAccount(env.AGENT_PRIVATE_KEY)` — see `erc8004.ts:53`. The registering wallet becomes the NFT owner, and the same wallet then tries to give itself feedback.

**Fix direction:** Feedback should be given by a different entity (e.g., the delegator/user wallet, or a separate "client" address). Or the agent should give feedback to a *different* agent. The semantics need to be rethought — who is the "client" rating the "agent" in this system?

---

### HIGH: New identity minted on every restart (#2)

**Location:** `agent-loop.ts:151`, `server.ts:324`

`registerAgent()` always calls `register(agentURI)` which mints a new NFT. There's no:
- Check for existing registration
- Stored/persisted `agentId` across restarts
- Lookup by owner address to find previous registration

Every server restart or agent deploy creates orphaned identity NFTs on Base Sepolia.

**Fix direction:** Either:
- Persist the `agentId` to disk/env after first registration and skip re-registration
- Add a lookup function (e.g., query the contract's ERC-721 `balanceOf` + `tokenOfOwnerByIndex` to find existing NFTs)
- Or: register once, store the agentId in `.env` or a config file

---

### MEDIUM: Double registration per startup (#1)

**Location:** `server.ts:322-330` AND `agent-loop.ts:148-166`

Both paths call `registerAgent()` independently:
1. `startup()` in `server.ts` registers when the HTTP server starts
2. `runAgentLoop()` registers again when a user deploys via `/api/deploy`

The server's registration result is discarded (agentId not stored). The agent loop's registration creates yet another NFT.

**Fix direction:** Remove one of the two registration calls. The server startup registration serves no purpose since it doesn't store the agentId anywhere the agent loop can use.

---

### MEDIUM: Hardcoded rating of 5, no meaningful signal (#4)

**Location:** `agent-loop.ts:709`

```ts
giveFeedback(state.agentId, 5, "swap-execution", "defi", "base-sepolia")
```

Always rating `5` with static tags `"swap-execution"` / `"defi"`. No variation based on:
- Swap slippage (was it good or bad?)
- Gas cost efficiency
- Whether the rebalance actually improved drift
- Quote accuracy vs execution price

Even if self-feedback worked, the data would be meaningless — every swap gets a perfect score.

---

### MEDIUM: agentId not exposed in API response (#5)

**Location:** `packages/common/src/schemas.ts:77-92`, `server.ts:194-216`

`AgentStateResponse` schema has no `agentId` field. The `handleState()` function in `server.ts` builds the response without it. The dashboard cannot display or link to the agent's on-chain identity.

**Fix direction:** Add `agentId: z.string().nullable()` to `AgentStateResponseSchema` (as string, since bigint can't be JSON-serialized directly). Include it in the server's response builder.

---

### MEDIUM: Fragile log parsing for agentId (#7)

**Location:** `erc8004.ts:94-98`

```ts
for (const log of receipt.logs) {
  if (log.topics[1]) {
    agentId = BigInt(log.topics[1]);
    break;
  }
}
```

Grabs `topics[1]` from the **first log** that has any topics. Should instead:
- Match the `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` event signature
- Or match the ERC-721 `Transfer(address,address,uint256)` mint event (from=0x0) and grab `topics[3]`

The e2e test (`erc8004.e2e.test.ts:44-57`) does this correctly with `extractMintedAgentId()`, but the production code takes a shortcut.

---

### LOW: getReputationSummary exported but never called (#6)

**Location:** `erc8004.ts:148-171`

The function exists, is unit-tested, but nothing in the agent loop, server, or dashboard ever calls it. Reputation data is write-only.

---

### LOW: Dashboard badge is cosmetic only (#10)

**Location:** `monitor.tsx:344`

`<SponsorBadge text="Identity via ERC-8004" />` — no actual ERC-8004 data displayed. Could show:
- Agent ID and link to Base Sepolia block explorer
- Reputation score / feedback count
- Registration status

---

### LOW: Undocumented address split between canonical and Base-specific (#8)

**Location:** `config.ts:66-76`

The canonical addresses work on all chains including Base Sepolia. Base Mainnet has its own separate addresses. The `getChainConfig()` function in `erc8004.ts:37-49` maps correctly, but there's no comment explaining *why* Base Mainnet is different. Someone extending to other chains might use the wrong addresses.

---

## Suggested Fix Priority

1. **Fix self-feedback** — rethink who gives feedback to whom (High, blocks reputation from working at all)
2. **Fix double/repeated registration** — persist agentId, register only once (High, wastes gas + creates orphans)
3. **Remove server.ts registration** — only register in agent-loop.ts (Medium, quick fix)
4. **Expose agentId in API** — add to AgentStateResponse, display in dashboard (Medium)
5. **Fix log parsing** — match event signature properly (Medium, prevents silent bugs)
6. **Make feedback meaningful** — vary rating based on swap outcome metrics (Medium, improves demo quality)
7. **Wire up getReputationSummary** — display reputation data in dashboard (Low, nice to have)
