# Design: `@veil/common` Shared Package

**Date:** 2026-03-15
**Status:** Approved

## Problem

Three categories of duplication create drift risk between `packages/agent` and `apps/dashboard`:

### 1. Types (HIGH severity)

| Type | Agent Location | Dashboard Location | Status |
|------|---------------|-------------------|--------|
| `AgentLogEntry` | `types.ts:40` (dead), `logging/agent-log.ts:14` (active) | `lib/types.ts:39` | **3 definitions, DRIFTED** — logging module makes fields optional + omits `success`; dashboard requires all fields + `success: boolean` (never populated) |
| `SwapRecord` | `agent-loop.ts:64` | `lib/types.ts:23` | Identical but duplicated |
| `AuditReport` | `delegation/audit.ts:16` | `lib/types.ts:32` | **DRIFTED** — agent has `intentMatch` + `formatted`; dashboard doesn't |
| `ParsedIntent` / `IntentParse` | `venice/schemas.ts:49` (Zod) | `lib/types.ts:51` (interface) | Same shape, different names, no shared source |
| `AgentStateResponse` | Constructed inline in `server.ts:144-189` | `lib/types.ts:7` | No compile-time contract |
| `DeployResponse` | Constructed inline in `server.ts:126-136` | `lib/types.ts:60` | No compile-time contract |

**Dead code in `types.ts`:** `Intent`, `RebalanceDecision`, `AgentLogEntry`, `DelegationConfig` are all exported but never imported. Only `PortfolioState` is used.

### 2. Constants (MEDIUM severity)

| Constant | Locations | Count |
|----------|-----------|-------|
| Agent wallet address `0xf130...` | `monitor.tsx:16`, `portfolio.e2e.test.ts:11`, `portfolio.test.ts:25`, `compiler.test.ts:242` | 4x |
| Port 3147 | `server.ts:18`, `app/api/state/route.ts:7`, `app/api/deploy/route.ts:7`, tests | 5x |
| `AGENT_API_URL` line | `app/api/state/route.ts:7`, `app/api/deploy/route.ts:7` | 2x (identical) |
| Chain ID `11155111` | `server.ts:116`, `agent-loop.ts:809`, `server.test.ts:416` | 3x (not using `CHAINS.sepolia.id`) |

### 3. Utilities (MEDIUM severity)

| Utility | Location(s) | Issue |
|---------|-------------|-------|
| `TOKEN_COLORS` | `monitor.tsx:18-22`, `audit.tsx:17-27` | Different shapes, different fallback colors (`bg-zinc-500` vs `bg-amber-500`), `audit.tsx` normalizes with `toUpperCase()` but `monitor.tsx` doesn't |
| `getTokenColor()` | `monitor.tsx:24`, `audit.tsx:29` | Duplicated with different fallbacks |
| `formatCurrency()` | `monitor.tsx:42-49` | Only in monitor, but agent uses inline `toLocaleString()` |
| `truncateAddress()` / `truncateHash()` | `monitor.tsx:32-40` | Only in monitor |
| `formatTimestamp()` | `monitor.tsx:51-65` | Only in monitor |

## Solution

Create `packages/common` (`@veil/common`) as the single source of truth for API contract types, shared constants, and formatting utilities.

### What goes in `@veil/common`

**Zod schemas + derived types (`schemas.ts`):**
- `ParsedIntentSchema` / `ParsedIntent` — moved from `venice/schemas.ts` (`.describe()` annotations kept, harmless)
- `SwapRecordSchema` / `SwapRecord`
- `AuditReportSchema` / `AuditReport` — the API subset (`allows`, `prevents`, `worstCase`, `warnings`)
- `AgentLogEntrySchema` / `AgentLogEntry` — canonical form matching what `logAction()` actually writes: `timestamp`, `sequence`, `action` required; `tool`, `parameters`, `result`, `duration_ms`, `error` optional; **no `success` field** (never populated)
- `AgentStateResponseSchema` / `AgentStateResponse`
- `DeployResponseSchema` / `DeployResponse`

**Constants (`constants.ts`):**
- `AGENT_ADDRESS` — `0xf13021F02E23a8113C1bD826575a1682F6Fac927`
- `DEFAULT_AGENT_PORT` — `3147`
- `API_PATHS` — `{ state: "/api/state", deploy: "/api/deploy" }`

**Formatting utilities (`format.ts`):**
- `truncateAddress(address: string): string`
- `truncateHash(hash: string): string`
- `formatCurrency(value: number): string`
- `formatTimestamp(timestamp: string): string`
- `formatPercentage(value: number, decimals?: number): string`

**Token metadata (`tokens.ts`):**
- `TOKEN_META: Record<string, { bg: string; labelColor: string; label: string }>` — unified map replacing both `monitor.tsx` and `audit.tsx` versions
- `getTokenBg(token: string): string` — returns bg class, falls back to `bg-zinc-500`
- `getTokenLabelColor(token: string): string` — returns text class, falls back to `text-zinc-400`
- `getTokenLabel(token: string): string` — returns display label, falls back to input
- All lookups normalize via `toUpperCase()`

### What stays where it is

- **Agent-internal types:** `AgentState` (non-serializable: `Delegation`, `MetaMaskSmartAccount`, `bigint`), `AgentConfig`, `PortfolioState`
- **Agent-internal `AuditReport`:** Keeps `intentMatch` + `formatted`. Import the common `AuditReport` as `ApiAuditReport` or similar if needed, or just keep the name since it's a superset
- **Venice LLM schemas:** `IntentParseLlmSchema`, `RebalanceDecisionSchema`, `MarketAnalysisSchema`, `PriceResponseSchema` — agent-only, LLM-specific
- **Dashboard component props:** `MonitorProps`, `AuditProps`, etc.
- **Agent config/env:** `env`, `CONTRACTS`, `CHAINS` — depend on `viem`/`dotenv`
- **SVG icons:** Dashboard-only UI components

### Package structure

```
packages/common/
  package.json          @veil/common — deps: zod only
  tsconfig.json         extends ../../tsconfig.base.json
  vitest.config.ts
  src/
    index.ts            barrel export
    schemas.ts           Zod schemas + z.infer types
    constants.ts         AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS
    format.ts            truncateAddress, formatCurrency, etc.
    tokens.ts            TOKEN_META, getTokenBg, getTokenLabelColor, getTokenLabel
    __tests__/
      schemas.test.ts    valid/invalid data, edge cases
      format.test.ts     formatting edge cases
      tokens.test.ts     lookup + fallback behavior
```

### Key design decisions

1. **Zod as only dependency** — no `viem`, `react`, `dotenv`. Stays lightweight and importable everywhere.
2. **API-surface types only** — defines what crosses the wire, not internal implementation types.
3. **Runtime validation enabled** — dashboard can `safeParse` API responses; server can type-check response construction.
4. **`AgentLogEntry` canonical form drops `success`** — it was never written by `logAction()`. The dashboard defines it as required but never reads it. Removing it fixes the lie.
5. **`AuditReport` is the API subset** — the agent's internal `AuditReport` (with `intentMatch` + `formatted`) is a superset. Server continues to strip those fields when serializing. The common type gives that stripped shape a name.
6. **Tailwind classes in common** — `TOKEN_META` contains Tailwind class strings. This is fine because they're just strings; the package doesn't depend on Tailwind. The consuming app's Tailwind config needs to scan `node_modules/@veil/common` (or the classes are already in the app's source and will be picked up).
7. **`IntentParseSchema` moves to common** — the `.describe()` annotations are harmless and useful for documentation. Agent's `venice/schemas.ts` imports from common instead of defining its own.

## Migration Changes

### Agent (`packages/agent`)

| File | Change |
|------|--------|
| `package.json` | Add `"@veil/common": "workspace:*"` |
| `types.ts` | Delete `Intent`, `RebalanceDecision`, `AgentLogEntry`, `DelegationConfig` (dead code). Keep only `PortfolioState`. |
| `agent-loop.ts` | Delete `SwapRecord` interface. Import from `@veil/common`. |
| `logging/agent-log.ts` | Delete local `AgentLogEntry`. Import from `@veil/common`. |
| `venice/schemas.ts` | Delete `IntentParseSchema` + `IntentParse`. Import from `@veil/common`. Keep `IntentParseLlmSchema`, `RebalanceDecisionSchema`, `MarketAnalysisSchema`, `PriceResponseSchema`. |
| `delegation/audit.ts` | Keep internal `AuditReport` (superset). No change needed — it's structurally compatible. |
| `server.ts` | Import `AgentStateResponse`, `DeployResponse`, `DEFAULT_AGENT_PORT`, `API_PATHS` from `@veil/common`. Type the response objects for compile-time safety. |

### Dashboard (`apps/dashboard`)

| File | Change |
|------|--------|
| `package.json` | Add `"@veil/common": "workspace:*"` |
| `lib/types.ts` | **Delete entirely.** All types come from `@veil/common`. |
| `lib/api.ts` | Import types from `@veil/common`. |
| `hooks/use-agent-state.ts` | Import `AgentStateResponse` from `@veil/common`. |
| `components/monitor.tsx` | Import `truncateAddress`, `truncateHash`, `formatCurrency`, `formatTimestamp`, `getTokenBg`, `getTokenLabel`, `AGENT_ADDRESS` from `@veil/common`. Delete local versions. Remove `success` references if any. |
| `components/audit.tsx` | Import `getTokenBg`, `getTokenLabelColor` from `@veil/common`. Delete local `TOKEN_COLORS`, `TOKEN_LABEL_COLORS`, `getTokenColor`, `getTokenLabelColor`. |
| `app/api/state/route.ts` | Import `DEFAULT_AGENT_PORT`, `API_PATHS` from `@veil/common`. |
| `app/api/deploy/route.ts` | Import `DEFAULT_AGENT_PORT`, `API_PATHS` from `@veil/common`. |

### Tailwind config

Dashboard's Tailwind config must scan `@veil/common` source to pick up class strings in `TOKEN_META`. Add content path if using file-based scanning, or rely on the classes already appearing in component source (they do — both `bg-emerald-500` and `bg-indigo-500` are used in dashboard components already, plus `bg-zinc-500` as fallback).

## Testing Strategy

### 1. `@veil/common` unit tests

- **`schemas.test.ts`**: Validate each schema with valid data, invalid data (missing fields, wrong types), edge cases (empty arrays, zero values). Test that `AgentLogEntry` optional fields are truly optional. Test `AuditReport` rejects `intentMatch`/`formatted`.
- **`format.test.ts`**: Edge cases — empty strings, very long addresses, negative numbers, zero, large numbers, non-numeric timestamps.
- **`tokens.test.ts`**: Known tokens return correct classes. Unknown tokens return fallbacks. Case-insensitive lookup works.

### 2. Consumer tests (no changes expected)

- `pnpm --filter @veil/agent test` — all existing agent unit tests pass
- `pnpm --filter @veil/dashboard test` — all existing dashboard vitest tests pass
- `pnpm --filter @veil/dashboard test:e2e` — all Playwright tests pass

### 3. Build verification

- `pnpm --filter @veil/common build` — compiles cleanly
- `turbo run build` — full monorepo builds in correct order (`common` before `agent`/`dashboard`)
- `turbo run test` — all tests pass
- `pnpm run lint` — no lint errors

### Verification checklist

- [ ] `pnpm --filter @veil/common build` succeeds
- [ ] `pnpm --filter @veil/common test` passes
- [ ] `pnpm --filter @veil/agent build` succeeds (no type errors)
- [ ] `pnpm --filter @veil/agent test` passes
- [ ] `pnpm --filter @veil/dashboard build` succeeds
- [ ] `pnpm --filter @veil/dashboard test` passes
- [ ] `pnpm --filter @veil/dashboard test:e2e` passes
- [ ] `turbo run build` succeeds
- [ ] `turbo run test` passes
- [ ] `pnpm run lint` passes
- [ ] `apps/dashboard/lib/types.ts` is deleted
- [ ] No `AgentLogEntry` defined anywhere except `@veil/common`
- [ ] No `SwapRecord` defined anywhere except `@veil/common`
- [ ] No duplicate `TOKEN_COLORS` maps in dashboard
- [ ] No `success` field on `AgentLogEntry` anywhere
- [ ] `types.ts` only exports `PortfolioState`
