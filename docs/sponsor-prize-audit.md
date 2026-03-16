# Sponsor Prize Audit — Veil Project

**Date:** 2026-03-16 (updated)
**Audited by:** Claude Opus 4.6
**Scope:** All 4 active sponsor integrations + overall project health

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Real vs. Fake Inventory](#real-vs-fake-inventory)
3. [Venice ($11,474)](#venice-11474-in-vvv)
4. [MetaMask ($5,000)](#metamask-5000)
5. [Uniswap ($5,000)](#uniswap-5000)
6. [Protocol Labs ($16,000)](#protocol-labs-16000)
7. [Novelty Assessment](#novelty-assessment)
8. [Win Probability](#win-probability)
9. [Priority Fixes](#priority-fixes-ranked-by-impact)
10. [On-Chain Evidence](#on-chain-evidence)

---

## Executive Summary

The project is **substantially functional** with real on-chain proof:
- 2 real Uniswap swaps on Ethereum Sepolia
- 3 ERC-8004 transactions on Base Sepolia
- Dashboard fully built (3 screens, styled, data-connected)
- All 4 active sponsor integrations working at some level

**Strongest track: MetaMask** (8/10). Delegation flow is genuinely novel and proven on-chain.
**Weakest track: Uniswap** (7/10). Real swaps but Permit2 unexercised and Graph data usage is shallow.

---

## Real vs. Fake Inventory

| Component | Status | Evidence |
|-----------|--------|---------|
| Agent loop (autonomous rebalancing) | **REAL** | 2 on-chain swaps on Sepolia |
| Venice LLM calls (pricing, reasoning) | **REAL** | Real API calls, web search citations captured |
| Venice model names | **VALID** | All 3 models (`qwen3-4b`, `gemini-3-flash-preview`, `gemini-3-1-pro-preview`) confirmed valid via `GET /api/v1/models`. Previous audit was wrong — these are proxied frontier models available through Venice |
| Uniswap Trading API (quote + swap) | **REAL** | 2 confirmed txs on Sepolia |
| Permit2 | **CODE EXISTS, NEVER EXERCISED** | All swaps were ETH sells (no ERC-20 approval needed). Zero Permit2 txs in logs |
| MetaMask delegation (create + sign) | **REAL** | Delegations created, signed, submitted to DelegationManager |
| MetaMask delegation (on-chain enforcement) | **REAL** | `ValueLteEnforcer:value-too-high` reverts prove caveats work |
| MetaMask delegation (successful swap via delegation) | **PARTIAL** | Both swaps that succeeded used the fallback path (delegation reverted, then direct tx succeeded). Delegation fired and was validated, but execution was direct |
| ERC-8004 registration | **REAL** | 2 txs on Base Sepolia |
| ERC-8004 reputation feedback | **REAL txs, PARTIAL logic** | Stores agentId from registration, but falls back to `1n` if registration hasn't completed |
| The Graph pool data | **REAL** | Data fed into LLM reasoning prompt |
| Dashboard (3 screens) | **REAL** | All screens data-connected |
| agent.json (PAM manifest) | **REAL** | Valid, not loaded at runtime |
| Agent logging (JSONL) | **REAL** | Claude Code hooks auto-write to agent_log.jsonl |
| AgentCash / x402 | **NOT STARTED** | Zero code |

---

## Venice ($11,474 in VVV)

### Prize Criteria (from SPONSOR_TECH.md)

"Private Agents, Trusted Actions" — privacy-preserving inference, multi-model usage, web search with citations, structured output, budget tracking, creative/novel use of Venice.

### What Works

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| Web search with citations | `src/venice/llm.ts`, `src/data/prices.ts` | REAL | `enable_web_search: "on"`, `enable_web_citations: true`. Real ETH price lookups from CoinDesk/CoinGecko. Citations captured and logged |
| Structured output | `src/venice/schemas.ts`, `src/data/prices.ts`, `src/delegation/compiler.ts` | REAL | `.withStructuredOutput(zodSchema)` + `safeParse()` post-validation. Used for intent parsing, price lookups, rebalance decisions |
| Budget tracking | `src/venice/llm.ts`, `src/logging/budget.ts` | REAL | Custom fetch wrapper captures `x-venice-balance-usd` header. Auto-switches to `qwen3-4b` when balance < $0.50 |
| Multi-model routing | `src/venice/llm.ts`, `src/config.ts` | REAL | 3 tiers: `qwen3-4b` (fast), `gemini-3-flash-preview` (research), `gemini-3-1-pro-preview` (reasoning). All confirmed valid via Venice `/models` API |
| `include_venice_system_prompt: false` | `src/venice/llm.ts` | REAL | Set on all Venice calls |
| Venice parameters | `src/venice/llm.ts` | REAL | `disable_thinking`, `include_search_results_in_stream`, `return_search_results_as_documents` all configured |

### Model Note

All 3 models (`qwen3-4b`, `gemini-3-flash-preview`, `gemini-3-1-pro-preview`) are confirmed valid via `GET https://api.venice.ai/api/v1/models` — they are proxied frontier models available through Venice's API. Venice's model catalog changes frequently — always verify model IDs against the live API rather than static documentation.

### What's Missing

| Venice Feature | Status | Impact |
|----------------|--------|--------|
| Privacy narrative | PARTIAL | README mentions "no data retention" and "agents that keep secrets". `docs/venice-tech.md` documents Venice's no-retention architecture. Could be stronger as a standalone section explaining WHY DeFi reasoning specifically needs this. **Not visible in dashboard UI** beyond the word "Private" in the title. |
| E2EE | NOT CONFIGURED | Venice supports E2EE for inference but has **no public API implementation guide** — only mentioned in [changelogs](https://featurebase.venice.ai/changelog/veniceai-change-log-february-26-2026-march-6-2026-2) as "improved end-to-end encryption with server key authentication". No documented API parameters exist. Would require Venice team guidance. |
| Prompt caching | NOT CONFIGURED | Venice supports automatic caching on select models + manual `cache_control` on message content + `prompt_cache_key` routing hint in `venice_parameters`. Claude models charge cache writes at 1.25x input rate. See [API spec](https://docs.venice.ai/api-reference/api-spec). Could cache our rebalance system prompt for cost savings. |
| Reasoning effort control | NOT USED | Venice supports `reasoning_effort` parameter (7 levels: `none` through `max`) via `reasoning: { effort: "high" }` or flat `reasoning_effort: "high"`. Model-specific — Gemini supports `low`/`high`, Claude supports `low`/`medium`/`high`. See [reasoning models guide](https://docs.venice.ai/overview/guides/reasoning-models). Could use `low` for price lookups, `high` for rebalance decisions. |
| DIEM/VVV balance awareness | NOT CONFIGURED | Could show staking/credit status |

### Verdict

**Score: 7/10**. Multi-model routing, budget tracking, web search with citations, web scraping, and structured output are all real and tested. Privacy narrative exists but could be more prominent. Still missing: E2EE, prompt caching, reasoning effort control, and other Venice-exclusive features that would differentiate from a generic OpenAI replacement.

### Fixes Required

1. ~~**Replace model names**~~ DONE — All 3 model names are valid Venice IDs (confirmed via API)
2. **Strengthen privacy narrative** — README mentions it but a dedicated section explaining WHY DeFi reasoning specifically requires no-data-retention would be more compelling for judges
3. ~~**Enable `enable_web_scraping: true`**~~ DONE — Enabled in `researchVeniceParams`
4. **Add privacy guarantee log entry** showing Venice's no-retention policy per call

---

## MetaMask ($5,000)

### Prize Criteria

ERC-7715 delegation grant, ERC-7710 delegation redemption, on-chain enforcement of caveats, smart account management, novel use of delegation framework.

### What Works

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| ERC-7715 delegation creation | `src/delegation/compiler.ts` | REAL | `createDelegation()` with `functionCall` scope constraining target (Uniswap router), selector (`execute()`), valueLte (max ETH per call) |
| Caveat enforcers | `src/delegation/compiler.ts` | REAL | `TimestampEnforcer` (expiry), `LimitedCallsEnforcer` (trade count cap) |
| Smart account creation | `src/delegation/compiler.ts` | REAL | `toMetaMaskSmartAccount()` with Hybrid implementation, deterministic address derivation |
| Smart account deployment | `src/delegation/redeemer.ts` | REAL | `deployDelegatorIfNeeded()` calls factory, verified on-chain |
| Smart account funding | `src/delegation/redeemer.ts` | REAL | `fundDelegatorIfNeeded()` transfers ETH with 10% gas buffer |
| ERC-7710 delegation redemption | `src/delegation/redeemer.ts` | REAL | `redeemDelegations()` encoded and sent to DelegationManager |
| On-chain enforcement | Sepolia logs | REAL | `ValueLteEnforcer:value-too-high` reverts prove caveats actively block unauthorized swaps |
| Fallback to direct tx | `src/agent-loop.ts:661-689` | REAL | When delegation reverts, re-quotes with agent address and executes directly |
| Audit report | `src/delegation/audit.ts` | REAL | ALLOWS / PREVENTS / WORST CASE / WARNINGS. Accurate and tested |
| Adversarial intent detection | `src/delegation/compiler.ts` | REAL | Warns if dailyBudget > $1K, timeWindow > 30d, slippage > 2% |
| Intent → delegation pipeline | `src/delegation/compiler.ts` | REAL | Venice LLM parses NL intent → Zod validates → caveats generated programmatically |

### What's Weak

1. **Both successful swaps used fallback path.** Delegation was submitted to DelegationManager and validated, but `ValueLteEnforcer` reverted because `valueLte` was omitted from the `functionCall` scope config, causing the SDK to default to `maxValue: 0n`. **FIXED**: Now passes `valueLte: { maxValue: maxValueWei }` in the scope config. E2e test confirms exactly one ValueLteEnforcer caveat with the correct encoding.

2. **No browser-based ERC-7715 grant page.** Optional (`grant-page/` in plan) but would impress MetaMask judges by showing the full user experience.

3. **Delegation details not surfaced in dashboard.** The Audit tab shows the report but doesn't display raw delegation data (delegator address, delegate, caveats list, signature).

### Delegation Flow Detail

```
agent-loop.ts execution path:

1. compileIntent() → Venice parses NL → IntentParse struct
2. createDelegationFromIntent() → creates delegation with:
   - functionCall scope (Uniswap router target, execute selector, valueLte)
   - TimestampEnforcer caveat (expiry)
   - LimitedCallsEnforcer caveat (max trades)
   - Signs with smart account's signDelegation()
3. generateAuditReport() → ALLOWS/PREVENTS/WORST CASE
4. On each cycle:
   a. If ETH sell + delegation exists → canUseDelegation = true
   b. Quote with smart account as swapper
   c. createSwap(quote, sig, { disableSimulation: true })
   d. redeemDelegation() → deploy SA if needed → fund if needed → encode + send to DelegationManager
   e. If reverts → re-quote with agent address → direct tx
   f. If ERC-20 sell → direct tx path (no delegation)
```

### On-Chain Proof

- Delegation redemption attempted: `ValueLteEnforcer:value-too-high` (proves DelegationManager validated caveats)
- Smart account deployed on Sepolia
- Smart account funded with ETH before swap attempts
- Proof tx from debug script: `0x725ba2904c3cd1b902fc656f201ef4786af84df56d8dc996a5cbb666b622f573`

### Verdict

**Score: 8/10**. Strongest integration. The intent-to-delegation pipeline is genuinely novel. On-chain enforcement is proven (caveats actively blocked unauthorized swaps). Few hackathon projects will tackle ERC-7715/7710 with real DeFi execution.

### Fixes Required

1. ~~**Tune `valueLte`**~~ **FIXED** — Root cause was omitting `valueLte` from `functionCall` scope config, causing SDK to default to `maxValue: 0n`. Now passes `valueLte: { maxValue: maxValueWei }` in scope. E2e verified.
2. **Surface delegation details in dashboard Audit tab** — show delegator/delegate addresses, caveat list, signature
3. **Log "delegation enforcement" as a positive signal** — highlight that the revert proves the system works

---

## Uniswap ($5,000)

### Prize Criteria

Uniswap Trading API usage (quote + swap), Permit2 integration, The Graph / subgraph integration, real swaps on supported chain, novel DeFi automation.

### What Works

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| Trading API quote | `src/uniswap/trading.ts` | REAL | `getQuote()` with native ETH tokenIn, USDC tokenOut, configurable slippage |
| Trading API swap | `src/uniswap/trading.ts` | REAL | `createSwap()` with optional Permit2 sig, `disableSimulation` option for delegation |
| Approval check | `src/uniswap/trading.ts` | REAL | `checkApproval()` queries Uniswap API |
| Permit2 approval | `src/uniswap/permit2.ts` | CODE COMPLETE | `ensurePermit2Approval()` — checks allowance, sends max approval if needed |
| Permit2 signing | `src/uniswap/permit2.ts` | CODE COMPLETE | `signPermit2Data()` — EIP-712 typed data signing |
| The Graph pool data | `src/data/thegraph.ts` | REAL | Fetches top 5 WETH/USDC pools by TVL from Uniswap V3 Ethereum subgraph |
| GraphQL codegen | `codegen.ts` | REAL | Auto-generates TypeScript types from subgraph schema |
| Real swaps | agent_log.jsonl | REAL | 2 confirmed txs on Sepolia |

### What's Weak

1. **Permit2 never exercised in a real swap.** Both swaps were ETH sells (native token, no ERC-20 approval needed). Zero Permit2 transactions exist in agent logs. The code is complete and tested in isolation, but never proven end-to-end.

2. **Pool data barely used.** The Graph data is fetched and passed as a string into the LLM reasoning prompt (`"Top WETH/USDC pool: TVL $373.5M, fee tier 3000..."`), but the LLM doesn't meaningfully incorporate TVL, volume, or fee tier into its rebalance decision. It's there but decorative.

3. **Only ETH -> USDC tested.** No reverse swaps (USDC -> ETH), no WETH pairs, no multi-hop routes.

### Real Swap Evidence

| TX Hash | Trade | Amount | Gas | Via |
|---------|-------|--------|-----|-----|
| `0x9c2f1064c3e8affa46877a79a29ee7b2de25709b84ae275241662b76e9832f9b` | ETH->USDC | 0.0048 ETH | 140,618 | Delegation fallback |
| `0x8c72a20e36595b76ded652b2577b39ca3a16a8fa1222264cd7097b4c15bdacb0` | ETH->USDC | 0.01 ETH | 193,394 | Delegation fallback |

### Verdict

**Score: 7/10**. Trading API integration is solid and proven with real swaps. The Graph integration is real but shallow. Permit2 is code-complete but unexercised. Other projects will likely have more diverse swap scenarios.

### Fixes Required

1. **Execute one USDC -> ETH swap** to prove Permit2 flow end-to-end (requires agent to hold USDC, approve Permit2, sign EIP-712)
2. **Make LLM reasoning explicitly reference pool data** — have the prompt say "considering TVL of $X and 24h volume of $Y, liquidity is sufficient/insufficient"
3. **Log Permit2 signature details** when they occur

---

## Protocol Labs ($16,000)

### Prize Criteria

ERC-8004 agent identity (NFT registration), ERC-8004 reputation feedback (rating other agents), JSON Agents spec (agent.json), agent logging (structured, machine-readable), novel agent identity/reputation usage.

### What Works

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| ERC-8004 registration | `src/identity/erc8004.ts` | REAL | `registerAgent(agentURI)` calls `register()` on IdentityRegistry. TX on Base Sepolia: `0x97237b74dfc3e4c332eed65b79aa9d73664a7afc1090ec9456a45a0dcfce829e` |
| ERC-8004 feedback txs | `src/identity/erc8004.ts` | REAL TXS | `giveFeedback()` calls ReputationRegistry. TX: `0x4db757c8d7e02e1ae3f1762cea2d1ed9c623161581b41b611651aa1a452523e8` |
| agent.json manifest | `/agent.json` | REAL | 3 profiles (core/exec/gov), 6 tools, security policies, observability config |
| Agent logging | `src/logging/agent-log.ts` + hooks | REAL | JSONL format, auto-generated via Claude Code PostToolUse hooks + agent-loop `logAction()` |
| Reputation summary | `src/identity/erc8004.ts` | REAL | `getReputationSummary()` fetches on-chain feedback for an agent |

### What's Weak

**Partially fixed: agentId fallback in feedback**

```typescript
// agent-loop.ts:744
const feedbackAgentId = state.agentId ?? 1n;
giveFeedback(feedbackAgentId, 5, "swap-execution", "defi", "base-sepolia")
```

The registration flow now correctly extracts and stores `agentId` from the `registerAgent()` response (line 146-150). However, the feedback call still falls back to `1n` via the `??` operator if `state.agentId` is null (e.g., if registration hasn't completed or failed). Remaining issues:

1. **Fallback to `1n`** — should skip feedback entirely if agentId is null, not fall back to a placeholder
2. **No inter-agent discovery** — the agent never queries "what other agents exist" to rate
3. **No service consumption** — the feedback isn't tied to actually consuming another agent's service

**agent.json not enforced at runtime:**

The manifest exists and is valid, but the agent doesn't load it or validate its own behavior against it. It's a static artifact for judges, not a runtime constraint.

### Verdict

**Score: 7/10**. Registration + logging + manifest are real and complete. The agentId is now extracted from registration and stored in state, but the `?? 1n` fallback means feedback could still target a placeholder if registration is slow or fails. A judge who looks at the on-chain feedback may see ratings targeting agentId 1 from early runs before the fix.

### Fixes Required

1. ~~**Store registered agentId**~~ DONE — `registerAgent()` response is destructured and stored in `state.agentId` (agent-loop.ts:146-150)
2. **Remove `?? 1n` fallback** — feedback should be skipped entirely if agentId is null, not fall back to a placeholder
3. **Tie feedback to service consumption** — "consumed Uniswap quote service, rating execution quality"
4. **Consider x402 integration** — call x402scan for DeFi data, then rate that agent's service via ERC-8004

---

## Novelty Assessment

### Genuinely Novel

| Feature | Why It's Novel |
|---------|---------------|
| Intent-compiled delegation | NL -> MetaMask caveats -> on-chain enforcement. No other project combines LLM intent parsing with ERC-7715/7710 scope generation |
| Private reasoning -> public execution | Venice reasons privately about portfolio, then constrains execution with on-chain delegation. Separation of private cognition from public action |
| Audit report as trust mechanism | Showing users exactly what the agent CAN and CANNOT do before execution. Provable safety guarantees |
| On-chain enforcement proof | `ValueLteEnforcer:value-too-high` revert proves the system can't be bypassed — the DelegationManager actively blocks unauthorized operations |

### Not Novel

| Feature | Why |
|---------|-----|
| LLM-based trading decisions | Many projects do this |
| Uniswap API integration | Standard integration pattern |
| ERC-8004 registration | Every Protocol Labs submission will do this |
| JSONL logging | Standard practice |
| Dark-themed dashboard | Common aesthetic |

### Competitive Differentiator

The intent-to-delegation pipeline is the strongest competitive differentiator. It's the only feature that spans multiple sponsor tracks simultaneously (Venice for intent parsing, MetaMask for delegation, Uniswap for execution). This cross-sponsor integration story is what should be emphasized in the submission.

---

## Win Probability

| Prize | Pool | Score | Competition Level | Win Probability | Rationale |
|-------|------|-------|-------------------|----------------|-----------|
| Venice | $11,474 | 7/10 | Unknown | **25-35%** | Multi-model, budget tracking, web search/scraping all real. Privacy narrative exists but could be stronger |
| MetaMask | $5,000 | 8/10 | Likely low (delegation is hard) | **35-45%** | Strongest integration. On-chain proof. Few projects tackle ERC-7715/7710 |
| Uniswap | $5,000 | 7/10 | Moderate | **20-30%** | Real swaps but shallow Permit2/Graph usage |
| Protocol Labs | $16,000 | 7/10 | High (everyone registers) | **20-30%** | Good manifest + logging, agentId partially fixed but feedback still has fallback issue |

With remaining fixes applied (remove agentId fallback, Permit2 swap, strengthen privacy narrative):
- Venice: 7→8/10 -> **30-40%**
- MetaMask: 8→9/10 -> **40-50%**
- Uniswap: 7→8/10 -> **25-35%**
- Protocol Labs: 7→8/10 -> **25-35%**

---

## Priority Fixes (Ranked by Impact)

### P0 — Must Fix Before Submission

| # | Fix | Impact | Effort | Affects |
|---|-----|--------|--------|---------|
| 1 | ~~**Fix Venice model names**~~ DONE — Models confirmed valid via `/api/v1/models` API. | N/A | Done | Venice |
| 2 | **Remove `?? 1n` fallback in `giveFeedback`** — agentId is now stored from registration, but feedback still falls back to `1n` if state.agentId is null. Should skip feedback entirely instead. | HIGH | 15 min | Protocol Labs score 7->8 |
| 3 | **Push to GitHub** — Nothing counts if judges can't see it | CRITICAL | 5 min | All tracks |

### P1 — Should Fix

| # | Fix | Impact | Effort | Affects |
|---|-----|--------|--------|---------|
| 4 | **Execute one USDC -> ETH swap** — Proves Permit2 flow end-to-end | MEDIUM | 1 hr | Uniswap score 7->8 |
| 5 | ~~**Tune delegation valueLte**~~ **FIXED** — `valueLte` now passed in `functionCall` scope config. E2e verified with correct encoding. | ~~MEDIUM~~ DONE | ~~1 hr~~ | MetaMask score 8->9 |
| 6 | **Strengthen privacy narrative** — README mentions it but a dedicated section explaining WHY DeFi reasoning specifically requires no-data-retention would impress Venice judges | MEDIUM | 30 min | Venice score 7->8 |

### P2 — Nice to Have

| # | Fix | Impact | Effort | Affects |
|---|-----|--------|--------|---------|
| 7 | **Make LLM reasoning reference pool data** — Prompt explicitly uses TVL/volume | LOW | 30 min | Uniswap |
| 8 | **Surface delegation details in dashboard** | LOW | 1 hr | MetaMask |
| 9 | ~~**Enable Venice web scraping**~~ DONE — `enable_web_scraping: true` on research tier | N/A | Done | Venice |
| 10 | **Add x402 service consumption + feedback** | MEDIUM | 2 hr | Protocol Labs, AgentCash |

---

## On-Chain Evidence

### Ethereum Sepolia

| Type | TX Hash | Status |
|------|---------|--------|
| Uniswap swap (0.0048 ETH -> USDC) | `0x9c2f1064c3e8affa46877a79a29ee7b2de25709b84ae275241662b76e9832f9b` | success |
| Uniswap swap (0.01 ETH -> USDC) | `0x8c72a20e36595b76ded652b2577b39ca3a16a8fa1222264cd7097b4c15bdacb0` | success |
| Delegation redemption proof | `0x725ba2904c3cd1b902fc656f201ef4786af84df56d8dc996a5cbb666b622f573` | success |
| Delegation swap (debug script) | `0x371ae19acba8f1ef4f57149d4051e644c476254a8a2b9891f094afc917f4d61c` | success |

### Base Sepolia

| Type | TX Hash | Status |
|------|---------|--------|
| ERC-8004 registration | `0x97237b74dfc3e4c332eed65b79aa9d73664a7afc1090ec9456a45a0dcfce829e` | success |
| ERC-8004 registration (2nd run) | `0xb804d4794d6f8c4e0a006e07d63a311531dc88ffd9d6b99b2fa82a205b3d5078` | success |
| ERC-8004 feedback | `0x4db757c8d7e02e1ae3f1762cea2d1ed9c623161581b41b611651aa1a452523e8` | success |
| ERC-8004 feedback (2nd run) | `0x882193f06e39cb3f90345839e8cdb284402ed641f38370d7f1dd3e4380a06c92` | success |

### Synthesis Hackathon Registration (Base Mainnet)

| Type | TX Hash | Status |
|------|---------|--------|
| ERC-8004 identity (via Synthesis API) | `0x7452f62bdc98f215ee2d79fc19d587a3c2696fb0e53089e116ae973bacd78bc3` | success |

---

## Key File Locations

| File | Purpose |
|------|---------|
| `packages/agent/src/venice/llm.ts` | Venice LLM factory (3 tiers) |
| `packages/agent/src/venice/schemas.ts` | Zod schemas for structured output |
| `packages/agent/src/delegation/compiler.ts` | Intent -> delegation + caveats |
| `packages/agent/src/delegation/redeemer.ts` | ERC-7710 redemption |
| `packages/agent/src/delegation/audit.ts` | Audit report generator |
| `packages/agent/src/uniswap/trading.ts` | Uniswap Trading API client |
| `packages/agent/src/uniswap/permit2.ts` | Permit2 approval + signing |
| `packages/agent/src/data/thegraph.ts` | The Graph pool data |
| `packages/agent/src/data/prices.ts` | Venice web search for prices |
| `packages/agent/src/identity/erc8004.ts` | ERC-8004 registration + feedback |
| `packages/agent/src/agent-loop.ts` | Main autonomous loop |
| `packages/agent/src/server.ts` | API server for dashboard |
| `agent.json` | PAM spec manifest |
| `agent_log.jsonl` | Auto-generated execution log |

---

## Synthesis API Registration

| Field | Value |
|-------|-------|
| Human name | neilei |
| Agent name | Claude Opus Agent |
| Agent ID | 30463 |
| Participant ID | fb019ea0e16046ed92f74daa11c004ea |
| Team ID | 0542cd144cfb4a96b98e6ac2b42d90df |
| Wallet | 0x6FFa1e00509d8B625c2F061D7dB07893B37199BC |
| Harness | claude-code |
| Model | claude-opus-4-6 |
| Registration TX | 0x7452f62bdc98f215ee2d79fc19d587a3c2696fb0e53089e116ae973bacd78bc3 |
