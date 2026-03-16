# Intent Persistence & Multi-Wallet Agent System — Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

Agent state is a singleton in memory — lost on server restart. Only one intent can run at a time. The dashboard has no wallet connection. Users can't grant scoped permissions from their own wallet. Intents don't survive restarts.

## Solution

SQLite persistence layer, multi-agent worker pool with concurrency limits, browser-side wallet connection with MetaMask delegation signing, and a wallet-scoped REST API.

---

## 1. Data Layer

**Database:** SQLite file at `data/veil.db` (gitignored, auto-created on first start).
**ORM:** drizzle-orm + better-sqlite3. Type-safe queries, Zod-compatible.
**Migrations:** drizzle-kit, stored in `packages/agent/drizzle/`.

### Schema

```sql
nonces (
  wallet_address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL          -- expire after 5 min
)

intents (
  id TEXT PRIMARY KEY,                  -- nanoid
  wallet_address TEXT NOT NULL,
  intent_text TEXT NOT NULL,
  parsed_intent TEXT NOT NULL,          -- JSON blob of ParsedIntent
  status TEXT NOT NULL,                 -- 'active' | 'paused' | 'completed' | 'expired' | 'cancelled'
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,

  -- ERC-7715 (demo narrative only — see "Delegation Architecture" below)
  permissions_context TEXT,
  delegation_manager TEXT,

  -- Real delegation (functionCall scope for Uniswap)
  signed_delegation TEXT NOT NULL,      -- JSON-serialized Delegation
  delegator_smart_account TEXT NOT NULL,

  -- Execution state (updated each cycle)
  cycle INTEGER NOT NULL DEFAULT 0,
  trades_executed INTEGER NOT NULL DEFAULT 0,
  total_spent_usd REAL NOT NULL DEFAULT 0,
  last_cycle_at INTEGER,

  -- ERC-8004 identity
  agent_id TEXT                         -- bigint as string
)

swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL REFERENCES intents(id),
  tx_hash TEXT NOT NULL,
  sell_token TEXT NOT NULL,
  buy_token TEXT NOT NULL,
  sell_amount TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL
)
```

### Log Files

Per-intent JSONL files at `data/logs/{intentId}.jsonl`. Created when intent starts, appended during cycles. Old `agent_log.jsonl` left as-is (not migrated). Downloadable via API.

---

## 2. Server Architecture

### Worker Pool

`WorkerPool` manages concurrent agent loops:
- `maxConcurrency` configurable (default 3)
- `activeWorkers: Map<intentId, AgentWorker>` — currently executing
- `queue: intentId[]` — waiting for a slot
- Methods: `start(intentId)`, `stop(intentId)`, `getStatus(intentId)`, `getState(intentId)`, `shutdown()`

Each `AgentWorker`:
- Wraps existing `runCycle` logic, scoped to one intent
- Owns its own `AgentState` instance (no more singleton)
- Reads config from SQLite on start
- Writes execution state to SQLite after each cycle
- Writes logs to `data/logs/{intentId}.jsonl`
- On stop condition (budget/trade limit/expiry): updates intent status in SQLite, removes self from pool

### Startup Resumption

1. Server starts, opens SQLite
2. Query active intents where `expires_at > now()`
3. Mark any past-expiry intents as `'expired'`
4. Stagger `workerPool.start()` with 2-3 second delays for remaining active intents
5. Log each resumption: `{ action: "agent_resume" }`

### Graceful Shutdown

On SIGTERM/SIGINT: pool stops all workers, each flushes state to SQLite, process exits. Systemd restarts trigger resumption flow.

---

## 3. Delegation Architecture

### Why Not ERC-7715 for Uniswap

ERC-7715 `requestExecutionPermissions` only supports two permission types:
- `erc20-token-periodic` — periodic ERC-20 transfers
- `native-token-periodic` — periodic ETH transfers

`native-token-periodic` uses `NativeTokenTransferAmountEnforcer` which defaults `exactCalldata: 0x` — rejecting any transaction with calldata. Uniswap's `execute()` requires calldata. **ERC-7715 cannot be used for DeFi swaps.**

### Actual Delegation: `createDelegation` with `functionCall` scope

The only viable approach for Uniswap router calls:
- `functionCall` scope: targets = [Uniswap router], selectors = [`execute()`], `valueLte` = max ETH per call
- `TimestampEnforcer` caveat: expiry
- `LimitedCallsEnforcer` caveat: max total calls
- Signed by user's wallet via EIP-712 in the browser
- All SDK functions (`createDelegation`, `toMetaMaskSmartAccount`, `getSmartAccountsEnvironment`) are browser-compatible

### ERC-7715 for Demo Narrative

We also call `requestExecutionPermissions` with `native-token-periodic` to show the MetaMask permission UI for the hackathon demo / MetaMask prize narrative. This is clearly commented in code as "for demo only" — it doesn't enable the actual Uniswap execution path.

### Signing Flow

1. Frontend builds delegation with `createDelegation()` (pure function, runs in browser)
2. Frontend shows custom audit screen (allows/prevents/worst-case)
3. User clicks "Approve" -> ERC-7715 `requestExecutionPermissions` (nice MetaMask UI, demo)
4. Then `signDelegation()` triggers EIP-712 MetaMask popup (real delegation)
5. Signed delegation sent to backend for storage + redemption

### Agent EOA

Single shared `AGENT_PRIVATE_KEY` for all users. All delegations grant to the same agent address. On-chain caveats limit per-user risk. Hackathon scope — per-user agent wallets are a production concern.

---

## 4. Wallet Connection (Frontend)

### Dependencies

- `wagmi` — React hooks for wallet connection
- `@tanstack/react-query` — required peer dep
- `viem` — types + signing utilities (already in agent, now also dashboard)
- `@metamask/smart-accounts-kit` — `createDelegation`, `erc7715ProviderActions`

### Auth: Nonce Signing

1. Frontend: `GET /api/auth/nonce?wallet=0x...`
2. Server: generates random nonce, stores in `nonces` table (5-min TTL)
3. Frontend: `walletClient.signMessage({ message: nonce })`
4. Frontend: `POST /api/auth/verify` with wallet + nonce + signature
5. Server: verifies via `recoverMessageAddress`, returns bearer token
6. All subsequent API calls include `Authorization: Bearer <token>`

### Frontend Code Organization

- `apps/dashboard/lib/wagmi.ts` — config (chains, connectors)
- `apps/dashboard/lib/delegation.ts` — delegation construction + signing
- `apps/dashboard/hooks/use-auth.ts` — nonce signing + session
- `apps/dashboard/hooks/use-delegation.ts` — ERC-7715 + functionCall flow
- `apps/dashboard/hooks/use-intents.ts` — intent list polling
- `apps/dashboard/hooks/use-intent-state.ts` — single intent state polling
- `apps/dashboard/components/connect-wallet.tsx` — header wallet button

---

## 5. API Design

### Auth (no token required)

```
GET  /api/auth/nonce?wallet=0x...    -> { nonce: string }
POST /api/auth/verify                -> { token: string }
  Body: { wallet, nonce, signature }
```

### Intent Parsing (no token required — exploration before connecting)

```
POST /api/parse-intent               -> { parsed: ParsedIntent }
  Body: { intent: string }
```

### Intent CRUD (token required)

```
POST   /api/intents                  -> { id: string }
  Body: { intentText, parsedIntent, walletAddress, permissionsContext?,
          delegationManager?, signedDelegation, delegatorSmartAccount }

GET    /api/intents?wallet=0x...     -> { intents: IntentSummary[] }

GET    /api/intents/:id              -> full state + feed (capped at 200 entries)

DELETE /api/intents/:id              -> { success: true }

GET    /api/intents/:id/logs         -> raw JSONL file download
```

### Legacy (deprecated, kept during transition)

```
GET  /api/state   — returns most recent intent state or empty default
POST /api/deploy  — removed, replaced by parse-intent + intents flow
```

---

## 6. Frontend UX Flow

1. User lands on dashboard -> "Connect Wallet" button in header
2. User connects MetaMask -> nonce auth flow -> session established
3. User enters intent in Configure tab (textarea, same as today)
4. "Preview" calls `POST /api/parse-intent` -> shows parsed allocation/budget/time
5. "Deploy Agent" triggers delegation signing flow:
   a. Frontend builds delegation object + generates audit report
   b. Shows audit screen (allows/prevents/worst-case)
   c. User clicks "Approve & Sign"
   d. ERC-7715 `requestExecutionPermissions` (MetaMask permission UI, demo)
   e. `signDelegation` (EIP-712 MetaMask popup, real delegation)
   f. `POST /api/intents` with everything
6. Monitor tab shows list of user's intents
7. Click intent -> full monitor view (stats, allocation, activity feed, transactions)
8. "Download Logs" button -> JSONL file download
9. "Stop Agent" button -> confirmation modal -> `DELETE /api/intents/:id`

Intent parsing works without wallet connection (exploration). Wallet required only at step 5.

---

## 7. Shared Code Moves

**To `@veil/common`:**
- Delegation builder pure functions (caveat construction, maxValue computation, scope building)
- Audit report generation (reads caveats, formats allows/prevents/worst-case)
- New Zod schemas for persistence types (CreateIntentRequest, IntentSummary, etc.)

**Stays in `packages/agent`:**
- Venice LLM intent parsing
- Delegation redemption (ERC-7710, server-side only)
- SQLite repository layer
- WorkerPool + AgentWorker
- API server + auth

**Stays in `apps/dashboard`:**
- wagmi config + wallet hooks
- Delegation signing (browser-side, uses functions from common)
- UI components

---

## 8. Migration Strategy

### Phase 1: Foundation (no breaking changes)
- Add SQLite + drizzle-orm to `packages/agent`
- Create database schema and migrations
- Extract delegation-building pure functions to `@veil/common`
- Extract audit generation to `@veil/common`
- Add WorkerPool alongside existing singleton loop
- Existing `/api/state` and `/api/deploy` keep working

### Phase 2: New API Endpoints (additive)
- Auth endpoints (`/api/auth/nonce`, `/api/auth/verify`)
- Intent endpoints (`/api/intents`, `/api/parse-intent`)
- Log download endpoint
- Server startup resumption logic
- Coexists with old endpoints

### Phase 3: Frontend Wallet Integration
- wagmi + wallet connection
- Delegation signing flow (ERC-7715 + functionCall)
- New Configure -> Audit -> Sign flow
- Multi-intent Monitor view
- Log download button
- Old flow still works without wallet (legacy mode)

### Phase 4: Cleanup
- Deprecate/remove `/api/deploy` and `/api/state`
- Remove singleton state from agent-loop
- Remove server-side delegation compilation
- Update VPS deploy script
- Update tests

Each phase is independently deployable. The demo works at any phase.

---

## 9. Testing Strategy

### Unit Tests (vitest)
- `packages/common`: audit generation, delegation builder, new schemas
- `packages/agent`: WorkerPool, SQLite repository (CRUD), startup resumption, auth token handling
- `apps/dashboard`: updated hooks, group-feed for per-intent feeds

### E2E Tests (vitest, real services)
- Full intent lifecycle: create -> run 2 cycles -> stop -> verify persisted -> restart -> verify resumed
- Auth flow: nonce -> sign -> verify -> use token
- Worker pool concurrency: 4 intents, max 2 concurrent, verify scheduling
- Expiry handling: short-lived intent -> verify auto-expired

### E2E Tests (Playwright, dashboard)
- Wallet connection flow
- Intent creation with delegation signing (investigate real on-chain signing with test wallet / Synpress rather than mocking)
- Multi-intent monitor view
- Log download
- Stop agent confirmation

---

## 10. Key Risks

1. **MetaMask smart account requirement**: ERC-7715 requires user's MetaMask to be upgraded to a smart account. If the user hasn't done this, the demo flow breaks. Mitigation: detect and guide the user through upgrade, or gracefully skip the ERC-7715 demo step.

2. **Browser `createDelegation` + `signDelegation`**: We're the first project to do this for DeFi. No reference implementations exist. Mitigation: thorough e2e testing, fallback to server-side delegation if browser signing fails.

3. **SQLite concurrency**: better-sqlite3 is synchronous and single-writer. With multiple workers writing state after each cycle, we need to ensure writes don't contend. Mitigation: WAL mode, brief transactions, worker pool limits natural concurrency.

4. **Hackathon deadline (2026-03-22)**: This is a large change. Mitigation: phased approach — Phase 1-2 alone gives persistence without wallet UX. Phase 3 adds the full demo flow.
