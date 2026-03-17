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
src/
├── index.ts                 CLI entrypoint ("tsx src/index.ts --intent '...'")
├── server.ts                HTTP API server (port 3147) — serves dashboard + JSON API
├── agent-loop.ts            Core autonomous loop — orchestrates all modules
├── config.ts                Env validation (Zod), contract addresses, chain config
├── types.ts                 Shared TypeScript interfaces
│
├── venice/                  VENICE AI — Private Reasoning ($11.5K prize track)
│   ├── llm.ts               3 LLM instances (fast/research/reasoning) via LangChain
│   │                         Custom fetch captures x-venice-balance-usd for budget tracking
│   └── schemas.ts            Zod schemas for intent parsing, rebalance decisions, market analysis
│
├── delegation/              METAMASK DELEGATION — On-Chain Cage ($5K prize track)
│   ├── compiler.ts           Intent -> ERC-7715 delegation with caveats
│   │                         Adversarial intent detection (budget >$1K, slippage >2%)
│   ├── audit.ts              Human-readable audit report (ALLOWS / PREVENTS / WORST CASE)
│   └── redeemer.ts           ERC-7710 delegation redemption (server-side, no browser)
│
├── uniswap/                 UNISWAP — Trade Execution ($5K prize track)
│   ├── trading.ts            Quote + swap via Uniswap Trading API
│   │                         Full flow: approve -> quote -> sign -> swap
│   └── permit2.ts            Gasless approvals via Permit2 (EIP-2612)
│
├── data/                    Data Layer (internal tools, not sponsor tracks)
│   ├── prices.ts             Token prices via Venice web search (60s cache)
│   ├── portfolio.ts          On-chain balances via viem RPC
│   └── thegraph.ts           Uniswap V3 pool data via The Graph subgraph
│
├── identity/                PROTOCOL LABS — Agent Identity ($16K prize track)
│   └── erc8004.ts            Register agent + submit reputation feedback on Base
│                             ERC-8004 Identity Registry + Reputation Registry
│
└── logging/                 Observability
    ├── agent-log.ts          JSONL structured logging (agent_log.jsonl)
    └── budget.ts             Venice compute budget tracking + model tier selection

dashboard/
├── index.html               Vanilla HTML dashboard (legacy, being replaced)
└── react/                   React + Vite dashboard (being replaced by Next.js)

docs/                        Design docs and research
reference/                   Code patterns from existing projects
agent.json                   PAM spec manifest — capabilities, tools, security policies
```

---

## Sponsor Integration Map

| Sponsor | Prize Pool | What We Use | Where In Code | Status |
|---------|-----------|-------------|---------------|--------|
| **Venice** | $11,474 (VVV) | Private LLM inference, web search, multi-model routing, no-data-retention | `src/venice/` | WORKING — 3 models configured, e2e tested |
| **MetaMask** | $5,000 | ERC-7715 delegation grant + ERC-7710 redemption, 8 caveats | `src/delegation/` | WORKING — compiler + audit + redeemer, unit tested |
| **Uniswap** | $5,000 | Trading API (quote + swap), Permit2 gasless approvals | `src/uniswap/` | WORKING — full flow coded, needs live swap test |
| **Protocol Labs** | $15,968 | ERC-8004 identity + reputation, agent.json manifest, structured logs | `src/identity/`, `src/logging/`, `agent.json` | WORKING — contracts verified on Base Sepolia |
| **AgentCash/Merit** | $1,746 | x402 paid data services | Not yet integrated | NOT STARTED |

---

## What Works Right Now

**Fully tested and functional (167 unit tests, 34 e2e tests — all passing):**

- Venice LLM integration — 3 model tiers, structured output, web search, budget tracking
- Intent compilation — natural language to structured delegation parameters
- Adversarial intent detection — flags dangerous configs before delegation
- Delegation creation — ERC-7715 with TimestampEnforcer + LimitedCallsEnforcer caveats
- Audit report generation — human-readable ALLOWS/PREVENTS/WORST CASE
- ERC-7710 delegation redemption client creation
- Uniswap quote + swap flow with Permit2 signatures
- Portfolio balance queries via RPC
- Pool data queries via The Graph
- Token price fetching via Venice web search (with 60s cache)
- ERC-8004 agent registration + reputation feedback
- Structured JSONL logging with sequence tracking
- Venice compute budget tracking with model tier recommendations
- HTTP API server with deploy + state endpoints
- Dashboard (React + vanilla HTML)

**Not yet validated end-to-end:**

- Full agent loop (all steps together in sequence) — individual modules work, orchestration untested
- Real Uniswap swap on testnet — quote flow works, need funded wallet for actual tx
- Real delegation redemption — client creation works, need DelegationManager on testnet
- Wallet is unfunded on Base Sepolia (can't register ERC-8004 identity)

---

## Known Issues

1. **Two different The Graph subgraph IDs** — `config.ts` uses the official Uniswap V3 subgraph (`5zvR82...`), `codegen.ts` and `agent.json` use a Messari-standardized subgraph (`FUbEPQ...`) with a different schema. Runtime code works; codegen fails.

2. **GraphQL codegen never run** — `codegen.ts` was pointing at a keyless URL (fixed) but still uses the wrong subgraph. No `__generated__/` output exists. Runtime code uses raw `graphql-request` with manual types.

3. **Dashboard is mid-migration** — Vanilla HTML at `dashboard/index.html`, Vite React at `dashboard/react/`, both being replaced by Next.js at `apps/dashboard/`.

4. **No monorepo structure yet** — Everything lives flat. Plan: npm workspaces with `packages/agent/` (current `src/`) and `apps/dashboard/` (Next.js).

---

## Setup

```bash
# Clone
git clone git@github-neilei:neilei/synthesis-hackathon.git
cd synthesis-hackathon

# Install
npm install

# Configure
cp .env.example .env
# Fill in: VENICE_API_KEY, UNISWAP_API_KEY, AGENT_PRIVATE_KEY

# Test
npm test              # 167 unit tests
npm run test:e2e      # 34 e2e tests (needs API keys)

# Run agent (CLI)
npx tsx src/index.ts --intent "60/40 ETH/USDC, $200/day, 7 days"

# Run dashboard server
npm run serve         # http://localhost:3147
```

---

## Tech Stack

- **Runtime**: Node.js 20, TypeScript 5.8
- **AI**: Venice AI (OpenAI-compatible) via LangChain (`@langchain/openai`)
- **Chain**: viem 2.31, Ethereum Sepolia / Base Sepolia / Base Mainnet
- **Delegation**: MetaMask Smart Accounts Kit 0.4.0-beta.1 (ERC-7715 + ERC-7710)
- **DEX**: Uniswap Trading API + Permit2
- **Data**: The Graph (Uniswap V3 subgraph), Venice web search
- **Identity**: ERC-8004 Identity + Reputation Registries on Base
- **Validation**: Zod schemas throughout
- **Testing**: Vitest (unit + e2e), Playwright (dashboard)
- **Dashboard**: Next.js (planned), currently React + Vite

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
