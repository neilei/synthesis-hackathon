# Veil — Intent-Compiled Private DeFi Agent

An autonomous agent that compiles natural language portfolio rules into on-chain delegation constraints, privately reasons about when to rebalance via Venice AI, and executes trades on Uniswap — with every decision auditable but no strategy ever leaked.

**Synthesis Hackathon 2026** | Built by [neilei](https://github.com/neilei) + Claude Opus Agent

---

## How It Works

```
"60/40 ETH/USDC, $200/day, 7 days"
         |
         v
  [1] COMPILE INTENT ──────────> Venice AI parses natural language
         |                        + adversarial detection
         v
  [2] CREATE DELEGATION ───────> ERC-7715 permission grant
         |                        8 caveats: budget, time, slippage,
         |                        trade limits, allowed targets
         v
  [3] HUMAN APPROVES (once) ───> MetaMask Flask / dashboard
         |
         v
  [4] MONITOR LOOP ────────────> Venice web search for prices
         |                        The Graph for pool data
         |                        Portfolio balance via RPC
         v
  [5] PRIVATE REASONING ───────> Venice AI (no data retention)
         |                        "Should I rebalance? Why?"
         v
  [6] EXECUTE TRADE ───────────> Uniswap Trading API + Permit2
         |                        Redeemed via ERC-7710 delegation
         v
  [7] LOG EVERYTHING ──────────> agent_log.jsonl + ERC-8004 reputation
```

---

## Architecture

```
packages/common/             Shared types, Zod schemas, constants, utilities (@veil/common)
packages/agent/              Backend — autonomous agent + HTTP API server
  src/
  ├── index.ts               CLI entrypoint
  ├── server.ts              HTTP API server (port 3147) — serves dashboard + JSON API
  ├── agent-loop.ts          Core autonomous loop — orchestrates all modules
  ├── agent-worker.ts        Per-intent worker (AbortController lifecycle, DB persistence)
  ├── worker-pool.ts         Concurrent worker management (max 5 intents)
  ├── config.ts              Env validation (Zod), contract addresses, chain config
  ├── auth.ts                Nonce-signing wallet authentication (HMAC tokens)
  ├── db/                    SQLite persistence (drizzle-orm + better-sqlite3)
  │   ├── schema.ts          intents, swaps, auth_nonces tables
  │   └── repository.ts      Data access layer
  ├── venice/                VENICE AI — Private Reasoning ($11.5K prize track)
  │   ├── llm.ts             3 LLM tiers (fast/research/reasoning) via LangChain
  │   └── schemas.ts         Zod schemas for structured output
  ├── delegation/            METAMASK DELEGATION — On-Chain Cage ($5K prize track)
  │   ├── compiler.ts        Intent → ERC-7715 delegation with caveats
  │   ├── audit.ts           Human-readable audit report
  │   └── redeemer.ts        ERC-7710 delegation redemption (server-side)
  ├── uniswap/               UNISWAP — Trade Execution ($5K prize track)
  │   ├── trading.ts         Quote + swap via Uniswap Trading API
  │   └── permit2.ts         Gasless approvals via Permit2 (EIP-712)
  ├── data/                  Market data layer
  │   ├── prices.ts          Token prices via Venice web search (60s cache)
  │   ├── portfolio.ts       On-chain balances via viem RPC
  │   └── thegraph.ts        Uniswap V3 pool data via The Graph subgraph
  ├── identity/              PROTOCOL LABS — Agent Identity ($16K prize track)
  │   └── erc8004.ts         ERC-8004 registration + reputation feedback on Base
  └── logging/               Observability
      ├── agent-log.ts       Global JSONL structured logging
      ├── intent-log.ts      Per-intent JSONL logs (downloadable via API)
      └── budget.ts          Venice compute budget tracking + model tier selection
apps/dashboard/              Next.js 16 dashboard (Configure, Audit, Monitor)
docs/                        Design docs, plans, research
agent.json                   PAM spec manifest — capabilities, tools, security policies
```

---

## Sponsor Integration Map

| Sponsor | Prize Pool | What We Use | Where In Code | Status |
|---------|-----------|-------------|---------------|--------|
| **Venice** | $11,474 (VVV) | Private LLM inference, web search + scraping, multi-model routing, no-data-retention | `packages/agent/src/venice/` | WORKING — 3 models, privacy narrative, budget tracking |
| **MetaMask** | $5,000 | ERC-7715 delegation grant + ERC-7710 redemption, caveat enforcers | `packages/agent/src/delegation/` | WORKING — on-chain proof, delegation details in Audit tab |
| **Uniswap** | $5,000 | Trading API (quote + swap), Permit2 gasless approvals, The Graph pool data | `packages/agent/src/uniswap/` | WORKING — 2 successful swaps + Permit2 flow proven |
| **Protocol Labs** | $15,968 | ERC-8004 identity + reputation, agent.json manifest, per-intent logs | `packages/agent/src/identity/`, `agent.json` | WORKING — dynamic agentId, feedback after each swap |

---

## What Works Right Now

**Tested:** 239 agent unit tests, 34 Playwright e2e tests, dashboard lint passing.

- Venice LLM integration — 3 model tiers, structured output, web search + scraping, budget tracking
- Intent compilation — natural language → structured delegation parameters via Venice
- Adversarial intent detection — flags dangerous configs before delegation
- ERC-7715 delegation creation with ValueLteEnforcer + TimestampEnforcer + LimitedCallsEnforcer
- ERC-7710 delegation redemption (server-side, no browser needed)
- Audit report generation — ALLOWS / PREVENTS / WORST CASE / WARNINGS
- Uniswap quote + swap via Trading API — 2 successful on-chain swaps on Sepolia
- Permit2 EIP-712 signing flow — proven end-to-end (`scripts/swap-usdc-eth.ts`)
- Pool data from The Graph — top 3 pools fed into LLM reasoning with liquidity guidance
- Token prices via Venice web search (60s cache)
- ERC-8004 agent registration + dynamic reputation feedback on Base Sepolia
- Multi-wallet intent persistence (SQLite, WAL mode, intent CRUD API)
- Per-intent worker pool with AbortController lifecycle (max 5 concurrent)
- Wallet-scoped nonce-signing auth flow (HMAC bearer tokens)
- Per-intent JSONL logs (downloadable via API)
- Next.js dashboard with Configure → Audit → Monitor flow
- Live deployment at `http://195.201.8.147:3147`

**On-chain evidence:** 4 successful Sepolia txs, 4 Base Sepolia txs, 1 Base Mainnet registration. See `docs/sponsor-prize-audit.md` for full tx list.

---

## Setup

```bash
# Clone
git clone git@github.com:neilei/synthesis-hackathon.git
cd synthesis-hackathon

# Install (pnpm workspaces)
pnpm install

# Configure
cp .env.example .env
# Fill in: VENICE_API_KEY, UNISWAP_API_KEY, AGENT_PRIVATE_KEY

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
- **Identity**: ERC-8004 Identity + Reputation Registries on Base
- **Persistence**: SQLite (drizzle-orm + better-sqlite3, WAL mode)
- **Validation**: Zod schemas throughout (`@veil/common`)
- **Testing**: Vitest (unit + e2e), Playwright (dashboard e2e)
- **Dashboard**: Next.js 16, wagmi v2, tailwindcss

---

## Why Venice: Privacy-Preserving DeFi Reasoning

Traditional AI-powered trading systems leak your strategy. Every prompt you send to OpenAI, Anthropic, or Google contains your portfolio composition, target allocations, budget, and timing — data that, if aggregated, reveals alpha and enables front-running.

Veil uses Venice AI with **no-data-retention inference** (`include_venice_system_prompt: false`, no training on queries) because DeFi agent reasoning is uniquely sensitive:

1. **Portfolio intent is alpha.** "60/40 ETH/USDC with $200/day budget" reveals position sizing and rebalancing triggers. An inference provider that logs queries could trade ahead of or against these signals.

2. **Reasoning traces expose timing.** The agent's internal deliberation — "drift is 8%, waiting for better liquidity" vs "executing now before price moves further" — is a real-time signal of when trades will execute. Venice's no-retention guarantee means these reasoning traces exist only in the agent's local logs, never on a third-party server.

3. **Cumulative queries build a profile.** Over a 7-day trading window with 60-second cycles, the agent makes ~10,000 LLM calls. Each individually is benign; together they paint a complete picture of a trader's risk tolerance, reaction patterns, and portfolio value. Venice treats each call as stateless — no session aggregation, no cross-request correlation.

4. **Multi-model routing without multi-vendor risk.** Veil uses 3 model tiers (qwen3-4b for fast checks, gemini-3-flash-preview for market research with web search, gemini-3-1-pro-preview for rebalancing decisions) — all through Venice's single privacy-preserving API. Without Venice, achieving the same model diversity would require accounts with Google, Meta, and Qwen, each logging your DeFi strategy independently.

The result: every rebalancing decision is **auditable locally** (structured JSONL logs with full reasoning traces) but **private externally** (no inference provider retains your strategy data).

---

## Hackathon Themes

- **Agents that keep secrets** — Venice no-data-retention inference means strategy never leaves the agent
- **Agents that pay** — Scoped delegation with budget/time/trade caveats, Uniswap execution
- **Agents that trust** — ERC-8004 on-chain identity + reputation feedback after every swap

---

## License

MIT
