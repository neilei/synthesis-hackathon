# ERC-8004 Redesign — Full Three-Registry Integration

**Date:** 2026-03-17
**Status:** Design approved, ready for implementation planning

---

## Problem

The current ERC-8004 implementation is non-functional:
- Self-feedback reverts (agent rates itself, contract forbids it)
- New identity minted every restart (no persistence)
- Hardcoded rating of 5 with static tags (meaningless data)
- Only uses Identity + Reputation registries (Validation Registry untouched)
- Dashboard shows cosmetic badge only

## Solution

Implement all three ERC-8004 registries with meaningful, verifiable data:

| Registry | Contract (Base Sepolia) | Wallet | Purpose | When |
|----------|------------------------|--------|---------|------|
| Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Agent (`AGENT_PRIVATE_KEY`) | Per-intent NFT registration | Intent creation |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Judge (`JUDGE_PRIVATE_KEY`) | Composite swap quality score | After each swap |
| Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | Agent + Judge | Evidence chain with per-dimension scores | After each swap |

---

## Architecture

### Wallets

- **Agent wallet** (`AGENT_PRIVATE_KEY`): Registers identity, submits validation requests. Existing wallet.
- **Judge wallet** (`JUDGE_PRIVATE_KEY`): Submits validation responses + reputation feedback. New wallet, funded on Base Sepolia.

### Per-Swap Flow (5 on-chain txs)

```
Swap executes on Uniswap (Ethereum Sepolia)
    ↓
Agent collects evidence: drift before/after, slippage, gas,
reasoning trace, market context, delegation compliance
    ↓
Agent submits validationRequest (Base Sepolia, agent wallet)
  → requestURI = https://api.veil.moe/api/evidence/{intentId}/{hash}
  → requestHash = keccak256(evidence JSON)
    ↓
Venice LLM evaluates evidence (off-chain, gemini-3-flash-preview, temp=0)
  → 3 dimension scores + reasoning
    ↓
Judge wallet submits (Base Sepolia):
  1. validationResponse(requestHash, score, responseURI, responseHash, "decision-quality")
  2. validationResponse(requestHash, score, responseURI, responseHash, "execution-quality")
  3. validationResponse(requestHash, score, responseURI, responseHash, "goal-progress")
  4. giveFeedback(agentId, compositeScore, "swap-quality", "rebalance", ...)
    ↓
Log all results to intent JSONL
```

### Non-blocking Execution

The judge evaluation runs as an async task after swap completion. The agent loop continues without waiting. Log actions: `judge_started`, `judge_completed`, `judge_failed`.

---

## Identity Registry — Per-Intent Registration

- Each intent gets its own ERC-8004 NFT (agentId)
- `agentURI` points to `https://api.veil.moe/api/intents/{id}/identity.json`
- agentId persisted in DB (`intents.agentId` column already exists)
- On restart, worker loads existing agentId from DB — no re-registration
- Server-level registration removed entirely
- Log parsing fixed: match ERC-721 `Transfer(from=0x0)` event signature

### agentURI Document

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Veil Rebalancer — Intent {shortId}",
  "description": "60/40 ETH/USDC, $200/day, 7 days",
  "services": [
    { "name": "veil-api", "endpoint": "https://api.veil.moe", "version": "0.1.0" }
  ],
  "active": true,
  "supportedTrust": ["reputation"]
}
```

---

## Reputation Registry — Composite Score

After each swap, judge wallet submits one `giveFeedback` call:

| Parameter | Value |
|-----------|-------|
| `agentId` | Intent's NFT tokenId |
| `value` | Weighted composite (0-10 scale, 2 decimals) |
| `valueDecimals` | `2` |
| `tag1` | `"swap-quality"` |
| `tag2` | `"rebalance"` (intent type — extensible) |
| `feedbackURI` | `https://api.veil.moe/api/evidence/{intentId}/{hash}` |
| `feedbackHash` | `keccak256(feedback JSON)` |

Composite weighting: `decision-quality × 0.4 + execution-quality × 0.3 + goal-progress × 0.3`

---

## Validation Registry — Evidence Chain

### Step 1: Agent submits evidence (agent wallet)

`validationRequest(judgeAddress, agentId, requestURI, requestHash)`

Evidence document contains: intent parameters, before/after allocation, drift, swap execution details, agent reasoning, market context.

### Step 2: Venice LLM evaluates (off-chain)

One LLM call → three scores + reasoning strings.

Model: `gemini-3-flash-preview`, temperature 0, structured output via Zod schema.

### Step 3: Judge submits 3 responses (judge wallet)

`validationResponse(requestHash, score, responseURI, responseHash, tag)`

Three calls with tags: `decision-quality`, `execution-quality`, `goal-progress`.

Each response document contains: dimension, score, LLM reasoning, model used, timestamp.

### Queryability

- `getSummary(agentId, [judgeAddress], "decision-quality")` → average decision score
- `getSummary(agentId, [judgeAddress], "execution-quality")` → average execution score
- `getSummary(agentId, [judgeAddress], "goal-progress")` → average goal score
- `getAgentValidations(agentId)` → all request hashes (full audit trail)

---

## Evaluation Dimensions — Extensible System

Dimensions are configuration objects, not hardcoded logic:

```typescript
interface EvaluationDimension {
  tag: string;           // on-chain tag for validationResponse
  name: string;          // human-readable for prompt assembly
  criteria: string;      // scoring rubric paragraph
  weight: number;        // weight in composite reputation score
}
```

Universal dimensions (all intent types):
- `decision-quality` (weight 0.4)
- `execution-quality` (weight 0.3)
- `goal-progress` (weight 0.3)

Intent-specific dimensions added by extending the array. Adding a dimension = adding an object. No pipeline changes.

### Judge Prompt Design

Role: independent validator, skeptical auditor.

Calibration:
- 90-100: Exceptional
- 70-89: Good
- 50-69: Adequate
- 30-49: Questionable
- 0-29: Poor

Most routine swaps score 65-80. Dimensions defined by clear scope (why → how → outcome), not prescriptive scoring rules. LLM synthesizes context that a rule engine can't.

---

## Evidence Hosting

Content-addressed storage alongside existing JSONL logs:

```
data/
  logs/
    {intentId}.jsonl          # existing
  evidence/
    {intentId}/
      {hash}.json             # evidence & response documents
```

New public API route (no auth): `GET /api/evidence/:intentId/:hash`

On-chain URIs: `https://api.veil.moe/api/evidence/{intentId}/{hash}`

Documents written to disk before on-chain tx submission (URI live before tx confirms).

---

## Dashboard Integration

### Monitor Detail — New "Agent Reputation" Card

- Agent ID with block explorer link
- Reputation score (composite from Reputation Registry)
- Per-dimension averages from Validation Registry
- Feedback count

### Activity Feed — Enhanced Log Entries

- `judge_started` / `judge_completed` / `judge_failed`
- `validation_request` / `validation_response` with scores and explorer links
- Color-coded score badges (green 70+, amber 40-69, red <40)

### New Backend Route

`GET /api/intents/:id/reputation` — returns agentId, reputation summary, per-dimension validation summaries.

### Removed

Static "Identity via ERC-8004" sponsor badge replaced with real data.

---

## New Config & Environment

### Env Vars
- `JUDGE_PRIVATE_KEY` — separate wallet for feedback/validation

### Contract Addresses (config.ts)
- `VALIDATION_BASE_SEPOLIA: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272"`
- `VALIDATION_BASE_MAINNET: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58"`

### New ABI (packages/common)
- `VALIDATION_REGISTRY_ABI_HUMAN` — validationRequest, validationResponse, getValidationStatus, getSummary, getAgentValidations, getValidatorRequests

---

## New Files

- `packages/agent/src/identity/judge.ts` — judge evaluation service
- `packages/agent/src/identity/evidence.ts` — evidence document creation + storage
- `packages/agent/src/identity/dimensions.ts` — evaluation dimension definitions

## Modified Files

- `packages/agent/src/identity/erc8004.ts` — add validation functions, fix log parsing, add judge wallet
- `packages/agent/src/agent-loop/swap.ts` — replace fire-and-forget with judge trigger
- `packages/agent/src/agent-loop/index.ts` — remove redundant registration, load agentId from DB
- `packages/agent/src/server.ts` — remove server registration, add evidence route, add reputation endpoint
- `packages/agent/src/config.ts` — validation addresses, JUDGE_PRIVATE_KEY
- `packages/common/src/erc8004-abi.ts` — validation registry ABI
- `packages/common/src/schemas.ts` — reputation response schema
- `apps/dashboard/components/monitor.tsx` — reputation card
- `apps/dashboard/components/feed-entry.tsx` — enhanced judge/validation rendering
- `apps/dashboard/lib/api.ts` — fetchReputation()

---

## Issues Resolved

All 8 issues from `docs/erc8004-audit.md` are addressed:
1. Self-feedback reverts → judge wallet (different address)
2. New identity per restart → per-intent registration, DB persistence
3. Double registration → server registration removed
4. Hardcoded rating → Venice LLM evaluation
5. agentId not in API → new reputation endpoint + dashboard card
6. Fragile log parsing → proper event signature matching
7. getReputationSummary unused → called by reputation endpoint
8. Dashboard badge cosmetic → replaced with real reputation data
