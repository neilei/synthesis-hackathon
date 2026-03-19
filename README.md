# Veil — Intent-Compiled Private DeFi Agent

An autonomous agent that compiles natural language portfolio rules into on-chain delegation constraints, privately reasons about when to rebalance via Venice AI, and executes trades on Uniswap — with every decision auditable but no strategy ever leaked.

**Synthesis Hackathon 2026** | Built by [neilei](https://github.com/neilei) + Claude Opus Agent

---

## What Is Veil?

DeFi users who want autonomous portfolio management face a dilemma: either trust an agent with full wallet access, or micromanage every trade. Veil resolves this by compiling a natural language intent — like *"60/40 ETH/USDC, $200/day, 7 days"* — into a scoped on-chain delegation that the agent **cannot violate**, even if compromised.

The agent reasons privately about *when* to trade (using Venice AI with no data retention), but its *ability* to trade is constrained by immutable on-chain caveats: budget caps, time windows, trade frequency limits, target contracts, and function selectors. Every swap is logged, every decision is scored by an independent LLM judge, and every score is recorded on-chain in an ERC-8004 reputation registry with content-addressed evidence.

The result: a fully autonomous trading agent where the human approves constraints once, the agent operates independently within those constraints, and the entire execution history is verifiable on-chain.

---

## How It Works

### Intent Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant Venice as Venice AI<br/>(Private LLM)
    participant Agent as Agent Loop
    participant MetaMask as MetaMask<br/>Delegation SDK
    participant Uniswap as Uniswap<br/>Trading API
    participant Chain as Ethereum<br/>Sepolia

    User->>Dashboard: "60/40 ETH/USDC, $200/day, 7 days"
    Dashboard->>Venice: Parse intent (structured output)
    Venice-->>Dashboard: { targetAllocation, budget, slippage, ... }
    Dashboard->>Agent: POST /api/intents

    Note over Agent,MetaMask: Delegation Compilation
    Agent->>MetaMask: Create ERC-7715 delegation
    Note right of MetaMask: Caveats enforced on-chain:<br/>- ValueLteEnforcer (budget)<br/>- TimestampEnforcer (expiry)<br/>- LimitedCallsEnforcer (trade cap)<br/>- FunctionCall scope (Uniswap only)
    MetaMask-->>Agent: Signed delegation

    Agent->>Agent: Generate audit report<br/>(ALLOWS / PREVENTS / WORST CASE)

    loop Every 60 seconds
        Agent->>Chain: Read portfolio balances (viem RPC)
        Agent->>Venice: Web search for ETH price
        Agent->>Agent: Calculate allocation drift

        alt Drift exceeds threshold
            Agent->>Venice: "Should I rebalance?" (private reasoning)
            Venice-->>Agent: { shouldRebalance, reasoning, targetSwap }

            alt Rebalance approved
                Agent->>Uniswap: Get quote (Trading API)
                Uniswap-->>Agent: Quote + Permit2 data
                Agent->>MetaMask: Redeem delegation (ERC-7710)
                MetaMask->>Chain: Execute swap via DelegationManager
                Chain-->>Agent: Transaction receipt
            end
        end
    end
```

### Post-Swap Evaluation

After every successful swap, an independent judge pipeline evaluates the agent's performance and records the results on-chain:

```mermaid
sequenceDiagram
    participant Agent as Agent Wallet
    participant Evidence as Evidence Store
    participant Judge as Venice LLM Judge
    participant JudgeWallet as Judge Wallet
    participant ValReg as Validation<br/>Registry
    participant RepReg as Reputation<br/>Registry

    Note over Agent,RepReg: ERC-8004 Three-Registry Pipeline

    Agent->>Evidence: Build swap evidence document<br/>(intent, before/after state, execution details)
    Evidence-->>Agent: Content-addressed hash + URL

    Agent->>ValReg: validationRequest(agentId, judgeAddr, evidenceURI, hash)

    Agent->>Judge: Evaluate evidence across 3 dimensions
    Note right of Judge: decision-quality (was the trade warranted?)<br/>execution-quality (gas, slippage, delegation use)<br/>goal-progress (did drift improve?)

    Judge-->>Agent: Calibrated scores (0-100) + reasoning

    loop For each dimension
        JudgeWallet->>Evidence: Store response document
        JudgeWallet->>ValReg: validationResponse(requestHash, score, responseURI)
    end

    JudgeWallet->>Evidence: Store composite feedback document
    JudgeWallet->>RepReg: giveFeedback(agentId, compositeScore, feedbackURI, feedbackHash)
```

The separation of agent wallet (requests validation) and judge wallet (submits scores) ensures the agent cannot rate itself. Evidence documents are content-addressed with keccak256 — the on-chain hash must match the hosted JSON, making tampering detectable.

---

## Architecture

```
packages/common/             Shared types, Zod schemas, constants, utilities (@veil/common)
packages/agent/              Backend — autonomous agent + HTTP API server
  src/
  ├── index.ts               CLI entrypoint
  ├── server.ts              HTTP API server (port 3147) — serves dashboard + JSON API
  ├── agent-loop/            Core autonomous loop — orchestrates all modules
  │   ├── index.ts           Loop orchestrator, drift calculation, cycle runner
  │   ├── market-data.ts     Market data gathering (prices, balances, pools)
  │   └── swap.ts            Swap execution with delegation redemption
  ├── agent-worker.ts        Per-intent worker (AbortController lifecycle, DB persistence)
  ├── worker-pool.ts         Concurrent worker management (max 5 intents)
  ├── config.ts              Env validation (Zod), contract addresses, chain config
  ├── auth.ts                Nonce-signing wallet authentication (HMAC tokens)
  ├── db/                    SQLite persistence (drizzle-orm + better-sqlite3)
  │   ├── schema.ts          intents, swaps, auth_nonces tables
  │   └── repository.ts      Data access layer
  ├── venice/                VENICE AI — Private Reasoning
  │   ├── llm.ts             3 LLM tiers (fast/research/reasoning) via LangChain
  │   └── schemas.ts         Zod schemas for structured output
  ├── delegation/            METAMASK DELEGATION — On-Chain Cage
  │   ├── compiler.ts        Intent → ERC-7715 delegation with caveats
  │   ├── audit.ts           Human-readable audit report
  │   └── redeemer.ts        ERC-7710 delegation redemption (server-side)
  ├── uniswap/               UNISWAP — Trade Execution
  │   ├── trading.ts         Quote + swap via Uniswap Trading API
  │   └── permit2.ts         Gasless approvals via Permit2 (EIP-712)
  ├── data/                  Market data layer
  │   ├── prices.ts          Token prices via Venice web search (60s cache)
  │   ├── portfolio.ts       On-chain balances via viem RPC
  │   └── thegraph.ts        Uniswap V3 pool data via The Graph subgraph
  ├── identity/              PROTOCOL LABS — Agent Identity + Reputation
  │   ├── erc8004.ts         ERC-8004 three-registry functions (Identity, Reputation, Validation)
  │   ├── judge.ts           Venice LLM judge — evaluates swap quality
  │   ├── validation.ts      Validation Registry — per-swap evidence chain
  │   ├── evidence.ts        Content-addressed JSON with keccak256 hashing
  │   └── dimensions.ts      Extensible scoring dimensions (configurable weights)
  └── logging/               Observability
      ├── agent-log.ts       Global JSONL structured logging
      ├── intent-log.ts      Per-intent JSONL logs (downloadable via API)
      └── budget.ts          Venice compute budget tracking + model tier selection
apps/dashboard/              Next.js 16 dashboard (Configure, Audit, Monitor)
docs/                        Design docs, plans, research
agent.json                   PAM spec manifest — capabilities, tools, security policies
```

---

## Sponsor Integrations

Veil's design is built around the cross-integration of four sponsor technologies. A single intent flows through all four in sequence: Venice parses it, MetaMask constrains it, Uniswap executes it, and Protocol Labs records it.

### Venice AI — "Private Agents, Trusted Actions" ($11.5K)

Venice provides the agent's intelligence layer with a critical guarantee: **no data retention**. Every LLM call is stateless — no session aggregation, no cross-request correlation, no training on queries.

This matters because DeFi agent reasoning is uniquely sensitive. Over a 7-day trading window, the agent makes thousands of LLM calls. Each individually is benign; together they paint a complete picture of a trader's risk tolerance, reaction patterns, and portfolio value. Venice ensures these reasoning traces exist only in the agent's local logs.

**How Veil uses Venice:**

| Capability | Integration | Details |
|---|---|---|
| **Multi-model routing** | 3 LLM tiers via single API | `qwen3-4b` (fast checks), `gemini-3-flash-preview` (web search + reasoning) — auto-downgrades when Venice balance is low |
| **Web search + scraping** | Real-time ETH price | `enable_web_search: "on"` + `enable_web_scraping: true` with citations from CoinDesk/CoinGecko |
| **Structured output** | Intent parsing, rebalance decisions, judge scoring | `.withStructuredOutput(zodSchema)` with `safeParse()` post-validation on every call |
| **Privacy guarantees** | No-retention inference | `include_venice_system_prompt: false`, `enable_e2ee: true`, prompt caching per tier |
| **Budget tracking** | Compute cost awareness | Custom fetch wrapper captures `x-venice-balance-usd` header; agent switches to cheaper models automatically |
| **LLM-as-judge** | Swap quality evaluation | Venice reasoning model scores each swap across 3 dimensions for ERC-8004 reputation |

### MetaMask — "Best Use of Delegations" ($5K)

MetaMask's delegation framework gives Veil its core safety property: **the agent operates inside an on-chain cage it cannot escape**. The human defines constraints once, and the DelegationManager smart contract enforces them on every transaction.

**How the delegation pipeline works:**

1. **Intent compilation** — Venice LLM parses "60/40 ETH/USDC, $200/day, 7 days" into structured parameters (target allocation, budget, slippage, time window)
2. **Smart account creation** — `toMetaMaskSmartAccount()` creates a Hybrid implementation smart account as the delegator. This account holds the trading assets.
3. **Delegation signing** — `createDelegation()` with a `functionCall` scope constraining: target address (Uniswap router only), function selector (`execute()` only), and `valueLte` (max ETH per call). Additional caveats: `TimestampEnforcer` (delegation expiry), `LimitedCallsEnforcer` (trade count cap).
4. **Audit report** — Before execution begins, the system generates a human-readable report: what the agent is ALLOWED to do, what it's PREVENTED from doing, the WORST CASE scenario, and any WARNINGS.
5. **Delegation redemption** — On each trade, the agent calls `redeemDelegations()` on the DelegationManager, which verifies all caveats before executing the swap from the smart account. If any caveat fails (e.g., budget exceeded), the transaction reverts on-chain.

**On-chain enforcement proof:** The `ValueLteEnforcer` has been observed actively blocking unauthorized swaps (`value-too-high` reverts on Sepolia), proving the constraints are real and not just decorative.

### Uniswap — "Agentic Finance" ($5K)

Uniswap is Veil's execution layer. The agent uses the Trading API for optimal routing and Permit2 for gasless token approvals.

**Integration points:**

| Component | What It Does | Code |
|---|---|---|
| **Trading API (quote)** | Fetches optimal swap routes with configurable slippage | `getQuote()` in [uniswap/trading.ts](packages/agent/src/uniswap/trading.ts) |
| **Trading API (swap)** | Creates executable swap transactions, supports `disableSimulation` for smart account swappers | `createSwap()` in [uniswap/trading.ts](packages/agent/src/uniswap/trading.ts) |
| **Permit2** | EIP-712 typed data signing for gasless ERC-20 approvals | `signPermit2Data()` in [uniswap/permit2.ts](packages/agent/src/uniswap/permit2.ts) |
| **Approval check** | Queries whether Permit2 allowance exists before each swap | `checkApproval()` in [uniswap/trading.ts](packages/agent/src/uniswap/trading.ts) |
| **The Graph** | Fetches top 3 WETH/USDC Uniswap V3 pools by TVL — fed into LLM reasoning prompt with liquidity guidance | `getPoolData()` in [data/thegraph.ts](packages/agent/src/data/thegraph.ts) |

The agent uses The Graph pool data to make liquidity-aware decisions. When the reasoning LLM considers a rebalance, it sees TVL, 24h volume, and fee tiers for the top 3 pools, with explicit guidance about when swap size relative to pool TVL suggests splitting across cycles.

### Protocol Labs — "Let the Agent Cook" + "Agents With Receipts" ($16K)

Protocol Labs' ERC-8004 gives Veil a verifiable on-chain identity and a reputation system where every swap is independently scored.

**Three-registry architecture on Base Sepolia:**

| Registry | Purpose | Wallet |
|---|---|---|
| **[Identity Registry](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)** | Per-intent NFT registration. Each intent gets its own `agentId`, persisted in SQLite across restarts. | Agent wallet |
| **[Validation Registry](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272)** | Per-swap evidence chain. Agent submits a `validationRequest` with content-addressed evidence; judge wallet responds with scores per dimension. | Agent wallet (request), Judge wallet (responses) |
| **[Reputation Registry](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)** | Composite swap quality score. `giveFeedback` with a weighted 0-10 score, linked to a content-addressed feedback document. | Judge wallet |

**Scoring dimensions** (extensible per intent type):

- **Decision quality** — Was the rebalance warranted? Was the trade size appropriate given drift and budget?
- **Execution quality** — Gas efficiency, slippage, delegation usage (preferred over direct tx)
- **Goal progress** — Did the swap move the portfolio closer to the target allocation?

Evidence documents are content-addressed JSON hosted at `https://api.veil.moe/api/evidence/{intentId}/{hash}`. The on-chain keccak256 hash must match the hosted content, making post-hoc tampering detectable.

**Additional Protocol Labs integrations:**

- **[agent.json](agent.json)** — PAM spec manifest declaring capabilities, tools, security policies, and observability config
- **Per-intent JSONL logs** — Each intent gets `data/logs/{intentId}.jsonl`, downloadable via `GET /api/intents/:id/logs`

---

## Live Demo

- **Dashboard**: [https://veil.moe](https://veil.moe)
- **API**: [https://api.veil.moe](https://api.veil.moe)

---

## Setup

```bash
# Clone
git clone https://github.com/neilei/synthesis-hackathon.git
cd synthesis-hackathon

# Install (pnpm workspaces)
pnpm install

# Configure
cp .env.example .env
# Fill in: VENICE_API_KEY, UNISWAP_API_KEY, AGENT_PRIVATE_KEY, DELEGATOR_PRIVATE_KEY

# Test
pnpm test             # unit tests (agent + common + dashboard)
pnpm run test:e2e     # e2e tests (needs API keys)

# Run API server + dashboard
pnpm run serve        # http://localhost:3147

# Run agent (CLI mode)
pnpm run dev -- --intent "60/40 ETH/USDC, \$200/day, 7 days"

# Dashboard dev server (hot reload)
pnpm run dev:dashboard
```

---

## Tech Stack

- **Runtime**: Node.js 22, TypeScript 5.9, pnpm workspaces + turborepo
- **AI**: Venice AI (OpenAI-compatible) via LangChain (`@langchain/openai`)
- **Chain**: viem 2.47, Ethereum Sepolia / Base Sepolia / Base Mainnet
- **Delegation**: MetaMask Smart Accounts Kit (ERC-7715 + ERC-7710)
- **DEX**: Uniswap Trading API + Permit2 (EIP-712)
- **Data**: The Graph (Uniswap V3 subgraph), Venice web search + scraping
- **Identity**: ERC-8004 Identity + Reputation + Validation Registries on Base
- **Persistence**: SQLite (drizzle-orm + better-sqlite3, WAL mode)
- **Validation**: Zod schemas throughout (`@veil/common`)
- **Testing**: Vitest (unit + e2e), Playwright (dashboard e2e)
- **Dashboard**: Next.js 16, wagmi v2, tailwindcss

---

## Verification Guide

A structured map of every sponsor integration claim, where to find the implementation, how to verify it, and the on-chain contracts involved. Designed for systematic verification.

**Test coverage:** 486 passing tests across 67 test files (40 unit + 12 Playwright e2e + 15 integration). Run `pnpm test` (unit) or `pnpm run test:e2e` (integration, requires API keys). All test paths are listed in the sponsor tables below.

### On-Chain Contracts

| Contract | Chain | Address | Explorer |
|----------|-------|---------|----------|
| ERC-8004 Identity Registry | Base Sepolia | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [basescan](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ERC-8004 Reputation Registry | Base Sepolia | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | [basescan](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| ERC-8004 Validation Registry | Base Sepolia | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | [basescan](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) |
| MetaMask DelegationManager | Eth Sepolia | `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` | [etherscan](https://sepolia.etherscan.io/address/0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3) |
| Uniswap Universal Router | Eth Sepolia | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | [etherscan](https://sepolia.etherscan.io/address/0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b) |
| Permit2 | Eth Sepolia | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | [etherscan](https://sepolia.etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |

Agent wallet: [`0xf13021F02E23a8113C1bD826575a1682F6Fac927`](https://sepolia.etherscan.io/address/0xf13021F02E23a8113C1bD826575a1682F6Fac927) — check transaction history for swap and delegation activity.

### Sponsor Verification Map

Each row links a sponsor prize claim to the implementation file, the test that proves it works, and what to look for.

**Venice ($11.5K) — "Private Agents, Trusted Actions"**

| Claim | Implementation | Test | What to verify |
|-------|---------------|------|----------------|
| Private cognition over sensitive DeFi data (no data retention) | [venice/llm.ts](packages/agent/src/venice/llm.ts) | [llm.test.ts](packages/agent/src/venice/__tests__/llm.test.ts) | `include_venice_system_prompt: false`, `enable_e2ee: true` in `baseVeniceParams`; portfolio strategy never leaves the agent |
| Trustworthy outputs for public on-chain systems | [venice/schemas.ts](packages/agent/src/venice/schemas.ts) | [schemas.test.ts](packages/agent/src/venice/__tests__/schemas.test.ts) | `IntentParseSchema`, `RebalanceDecisionSchema`; `.withStructuredOutput()` + `safeParse()` — validated outputs drive on-chain delegation and swap execution |
| Multi-model routing via `venice_parameters` | [venice/llm.ts](packages/agent/src/venice/llm.ts) | [llm.test.ts](packages/agent/src/venice/__tests__/llm.test.ts), [llm.e2e.test.ts](packages/agent/src/venice/__tests__/llm.e2e.test.ts) | 3 tiers: `qwen3-4b` (fast), `gemini-3-flash-preview` (web search + reasoning) — auto-downgrades when balance is low |
| Web search with citations + web scraping | [data/prices.ts](packages/agent/src/data/prices.ts) | [prices.test.ts](packages/agent/src/data/__tests__/prices.test.ts), [prices.e2e.test.ts](packages/agent/src/data/__tests__/prices.e2e.test.ts) | `enable_web_search: "on"`, `enable_web_scraping: true`, `enable_web_citations: true`; real ETH price from CoinDesk/CoinGecko |
| Compute budget awareness | [logging/budget.ts](packages/agent/src/logging/budget.ts) | [budget.test.ts](packages/agent/src/logging/__tests__/budget.test.ts) | Custom fetch wrapper captures `x-venice-balance-usd` header; auto-switches to cheaper model tier |
| Novel use: LLM-as-judge for on-chain reputation | [identity/judge.ts](packages/agent/src/identity/judge.ts) | [judge.test.ts](packages/agent/src/identity/__tests__/judge.test.ts) | Venice reasoning model evaluates each swap across 3 dimensions, scores feed into [Reputation Registry](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |

**MetaMask ($5K) — "Best Use of Delegations"**

| Claim | Implementation | Test | What to verify |
|-------|---------------|------|----------------|
| Intent-based delegations as core pattern (NL → ERC-7715) | [delegation/compiler.ts](packages/agent/src/delegation/compiler.ts) | [compiler.test.ts](packages/agent/src/delegation/__tests__/compiler.test.ts), [compiler.e2e.test.ts](packages/agent/src/delegation/__tests__/compiler.e2e.test.ts) | `compileIntent()` parses NL via Venice → `createDelegationFromIntent()` generates scoped ERC-7715 delegation — intent-to-delegation is the entire product |
| Creative caveat usage (3 enforcer types) | [delegation/compiler.ts](packages/agent/src/delegation/compiler.ts) | [compiler.e2e.test.ts](packages/agent/src/delegation/__tests__/compiler.e2e.test.ts) | `ValueLteEnforcer` (budget cap), `TimestampEnforcer` (time expiry), `LimitedCallsEnforcer` (trade count) + `functionCall` scope ([Uniswap router](https://sepolia.etherscan.io/address/0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b) + `execute()` selector only) |
| Scoped permissions for AI agent trading | [delegation/redeemer.ts](packages/agent/src/delegation/redeemer.ts) | [redeemer.test.ts](packages/agent/src/delegation/__tests__/redeemer.test.ts), [redeemer.e2e.test.ts](packages/agent/src/delegation/__tests__/redeemer.e2e.test.ts) | `toMetaMaskSmartAccount()` creates delegator, `deployDelegatorIfNeeded()` deploys on-chain, smart account holds assets — agent can only execute within scope |
| ERC-7710 permission redemption (server-side, no browser) | [delegation/redeemer.ts](packages/agent/src/delegation/redeemer.ts) | [redeemer.test.ts](packages/agent/src/delegation/__tests__/redeemer.test.ts) | `redeemDelegation()` encodes and sends to [DelegationManager](https://sepolia.etherscan.io/address/0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3) — autonomous execution without repeated user signatures |
| Novel: human-readable audit report before execution | [delegation/audit.ts](packages/agent/src/delegation/audit.ts) | [audit.test.ts](packages/agent/src/delegation/__tests__/audit.test.ts), [audit.e2e.test.ts](packages/agent/src/delegation/__tests__/audit.e2e.test.ts) | ALLOWS / PREVENTS / WORST CASE / WARNINGS — user sees exactly what agent can and cannot do before approving |
| Safety: adversarial intent detection | [delegation/compiler.ts](packages/agent/src/delegation/compiler.ts) | [compiler.test.ts](packages/agent/src/delegation/__tests__/compiler.test.ts) | `detectAdversarialIntent()` flags dangerous configs (budget > $1K, slippage > 2%, window > 30d) before delegation creation |

**Uniswap ($5K) — "Agentic Finance (Best Uniswap API Integration)"**

| Claim | Implementation | Test | What to verify |
|-------|---------------|------|----------------|
| Real Dev Platform API key + real TxIDs on Sepolia | [uniswap/trading.ts](packages/agent/src/uniswap/trading.ts) | [trading.test.ts](packages/agent/src/uniswap/__tests__/trading.test.ts), [trading.e2e.test.ts](packages/agent/src/uniswap/__tests__/trading.e2e.test.ts) | `getQuote()`, `createSwap()` with authenticated Uniswap Trading API; real swaps visible in [agent wallet history](https://sepolia.etherscan.io/address/0xf13021F02E23a8113C1bD826575a1682F6Fac927) |
| Deeper stack: Permit2 (EIP-712 typed data signing) | [uniswap/permit2.ts](packages/agent/src/uniswap/permit2.ts) | [permit2.test.ts](packages/agent/src/uniswap/__tests__/permit2.test.ts), [permit2.e2e.test.ts](packages/agent/src/uniswap/__tests__/permit2.e2e.test.ts) | `signPermit2Data()` signs PermitSingle against [Permit2 contract](https://sepolia.etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3); full flow: approval check → quote → signature → swap |
| Deeper stack: The Graph subgraph integration | [data/thegraph.ts](packages/agent/src/data/thegraph.ts) | [thegraph.test.ts](packages/agent/src/data/__tests__/thegraph.test.ts), [thegraph.e2e.test.ts](packages/agent/src/data/__tests__/thegraph.e2e.test.ts) | `getPoolData()` queries Uniswap V3 subgraph (top 3 WETH/USDC pools by TVL); pool data fed into LLM reasoning at [market-data.ts](packages/agent/src/agent-loop/market-data.ts) |
| Agentic finance: autonomous delegation-routed swaps | [agent-loop/swap.ts](packages/agent/src/agent-loop/swap.ts) | [agent-loop.test.ts](packages/agent/src/__tests__/agent-loop.test.ts) | `canUseDelegation` branch: quotes with smart account, `disableSimulation: true`, redeems via [DelegationManager](https://sepolia.etherscan.io/address/0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3) — fully autonomous |

**Protocol Labs ($16K) — "Let the Agent Cook" + "Agents With Receipts"**

*Bounty 1 checklist: autonomous execution, self-correction, ERC-8004 identity, agent.json, structured logs, real tool use, safety guardrails, compute budget awareness.*
*Bounty 2 checklist: real on-chain txns with identity/reputation/validation registries, autonomous architecture, agent identity + operator model, on-chain verifiability, agent.json + agent_log.json.*

| Claim | Implementation | Test | What to verify |
|-------|---------------|------|----------------|
| Autonomous execution with self-correction loop | [agent-loop/index.ts](packages/agent/src/agent-loop/index.ts) | [agent-loop.test.ts](packages/agent/src/__tests__/agent-loop.test.ts) | `runAgentLoop()` runs 60s cycles: gather data → calculate drift → reason → execute → log → repeat. Delegation fallback on failure = self-correction |
| ERC-8004 identity linked to operator wallet | [identity/erc8004.ts](packages/agent/src/identity/erc8004.ts) | [erc8004.test.ts](packages/agent/src/identity/__tests__/erc8004.test.ts), [erc8004.e2e.test.ts](packages/agent/src/identity/__tests__/erc8004.e2e.test.ts) | `registerAgent()` mints per-intent NFT on [Identity Registry](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e); `agentId` persisted in SQLite |
| Real on-chain txns: identity/reputation/validation registries | [identity/erc8004.ts](packages/agent/src/identity/erc8004.ts) | [erc8004.test.ts](packages/agent/src/identity/__tests__/erc8004.test.ts) | `registerAgent()` → [Identity](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e), `giveFeedback()` → [Reputation](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713), `submitValidationRequest/Response()` → [Validation](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) |
| On-chain verifiability (block explorer) | [identity/evidence.ts](packages/agent/src/identity/evidence.ts) | [evidence.test.ts](packages/agent/src/identity/__tests__/evidence.test.ts) | Content-addressed JSON at `https://api.veil.moe/api/evidence/{intentId}/{hash}`; keccak256 hash on-chain matches hosted document |
| Agent capability manifest (`agent.json`) | [agent.json](agent.json) | — | 3 profiles (core/exec/gov), 6 tools, 3 capabilities, security policies — valid JSON Agents PAM spec |
| Structured execution logs (`agent_log.json`) | [logging/agent-log.ts](packages/agent/src/logging/agent-log.ts) | [agent-log.test.ts](packages/agent/src/logging/__tests__/agent-log.test.ts) | JSONL with decisions, tool calls, cycle results, errors; per-intent logs at `data/logs/{intentId}.jsonl` |
| Real tool use (Venice, Uniswap, The Graph, viem) | [agent-loop/](packages/agent/src/agent-loop/) | [agent-loop.test.ts](packages/agent/src/__tests__/agent-loop.test.ts) | Each cycle calls: Venice web search (prices), viem RPC (balances), The Graph (pools), Venice reasoning (decisions), Uniswap Trading API (quotes/swaps) |
| Safety guardrails before irreversible actions | [agent-loop/swap.ts](packages/agent/src/agent-loop/swap.ts) | [agent-loop.test.ts](packages/agent/src/__tests__/agent-loop.test.ts) | Budget guard, trade limit guard, adversarial intent detection, on-chain delegation caveat enforcement — all checked before every swap |
| Compute budget awareness | [logging/budget.ts](packages/agent/src/logging/budget.ts) | [budget.test.ts](packages/agent/src/logging/__tests__/budget.test.ts) | Venice balance tracked via `x-venice-balance-usd` header; auto-downgrades model tier when budget is low |
| Venice LLM judge + 3-dimension validation | [identity/judge.ts](packages/agent/src/identity/judge.ts) | [judge.test.ts](packages/agent/src/identity/__tests__/judge.test.ts) | `evaluateSwap()` orchestrates: evidence → [Validation Registry](https://sepolia.basescan.org/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) request → LLM scoring → 3x validation responses → [Reputation Registry](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) feedback |
| Per-intent downloadable logs | [logging/intent-log.ts](packages/agent/src/logging/intent-log.ts) | [intent-log.test.ts](packages/agent/src/logging/__tests__/intent-log.test.ts) | `IntentLogger` class; downloadable via `GET /api/intents/:id/logs` |

### API Endpoints (Live)

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET https://api.veil.moe/api/auth/nonce?wallet=0x...` | Get signing nonce | None |
| `POST https://api.veil.moe/api/auth/verify` | Verify wallet signature, get bearer token | None |
| `POST https://api.veil.moe/api/intents` | Create new intent | Bearer token |
| `GET https://api.veil.moe/api/intents` | List intents for wallet | Bearer token |
| `GET https://api.veil.moe/api/intents/:id` | Get intent detail + live agent state | Bearer token |
| `GET https://api.veil.moe/api/intents/:id/logs` | Download per-intent JSONL log | Bearer token |
| `GET https://api.veil.moe/api/evidence/:intentId/:hash` | Content-addressed evidence document | None (public, immutable) |

---

## Hackathon Themes

- **Agents that keep secrets** — Venice no-data-retention inference means strategy never leaves the agent
- **Agents that pay** — Scoped delegation with budget/time/trade caveats, Uniswap execution
- **Agents that trust** — ERC-8004 on-chain identity + LLM-judged reputation feedback after every swap

---

## License

MIT
