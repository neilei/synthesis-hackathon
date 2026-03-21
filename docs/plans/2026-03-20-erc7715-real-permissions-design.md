# ERC-7715 Real Permissions — Design Document

**Date:** 2026-03-20
**Branch:** `feat/erc7715-real-permissions`
**Status:** Approved, ready for implementation

## Problem

The ERC-7715 permission granting flow is mocked. The `use-delegation.ts` hook builds a fake delegation JSON with `signature: "0x"` — MetaMask is never involved. The backend ignores the frontend's delegation data and creates its own server-side delegation via `createDelegationFromIntent()`. Users connecting MetaMask Flask are never prompted to sign anything.

MetaMask's $5K "Best Use of Delegations" prize explicitly lists "ERC-7715 extensions" and "intent-based delegations" as high-value patterns. We need the real flow.

## Solution: Two-Step Pull+Swap Architecture

Replace the mocked frontend delegation and server-side `functionCall` delegation with the real ERC-7715 permission flow:

1. **Browser (ERC-7715 Grant):** User approves `native-token-periodic` and/or `erc20-token-periodic` permissions in MetaMask Flask. Flask returns `permissionsContext`, `delegationManager`, and `dependencies`.
2. **Backend (ERC-7710 Pull):** Agent uses `sendTransactionWithDelegation()` to pull tokens from user's smart account to agent EOA, within the granted period limits.
3. **Backend (Uniswap Swap):** Agent swaps from its own EOA. No delegation involved in the swap itself.

### Why Two-Step Instead of Single-Step Delegated Swap

ERC-7715 permission types (`native-token-periodic`, `erc20-token-periodic`) are **token-transfer-only**. They add `ExactCalldataEnforcer("0x")` for native tokens, preventing arbitrary contract calls like Uniswap's `execute()`. The `functionCall` scope that allows arbitrary calls is only available via programmatic `createDelegation()`, not through the ERC-7715 browser flow.

The two-step architecture is the correct pattern: permission-constrained token pull, then standard swap from agent's own wallet.

## Architecture

```
User (MetaMask Flask)           Dashboard                    Backend Agent
     |                              |                             |
     | 1. Enter intent              |                             |
     | ---------------------------> |                             |
     |                              | 2. POST /api/parse-intent   |
     |                              | --------------------------> |
     |                              | <-- parsed + audit -------- |
     |                              |                             |
     | 3. Flask permission prompt   |                             |
     | <-- requestExecutionPerms    |                             |
     | -- approve in Flask -------> |                             |
     |                              | 4. POST /api/intents        |
     |                              |   { permissionsContext,     |
     |                              |     delegationManager,      |
     |                              |     dependencies,           |
     |                              |     parsedIntent }          |
     |                              | --------------------------> |
     |                              |                             |
     |                              |       5. Agent loop:        |
     |                              |          a. Pull ETH/USDC   |
     |                              |             via ERC-7710    |
     |                              |          b. Swap on Uniswap |
     |                              |             from agent EOA  |
```

## Component Changes

### Frontend

#### `apps/dashboard/hooks/use-delegation.ts` — Rewrite

Current: Builds fake delegation JSON, returns `{ signedDelegation, delegatorSmartAccount }`.

New:
- Extend wagmi wallet client with `erc7715ProviderActions()` from `@metamask/smart-accounts-kit/actions`
- Call `requestExecutionPermissions()` with permission(s) computed from intent:
  - `native-token-periodic` for ETH budget (periodAmount from daily budget, periodDuration = 86400)
  - `erc20-token-periodic` for USDC budget (if intent has USDC allocation)
- Return `{ permissionsContext, delegationManager, dependencies }` from each granted permission
- Detect Flask via `window.ethereum?.isFlask` — show install prompt if missing

Hook return type changes from `DelegationResult` to `PermissionResult`:
```typescript
interface PermissionResult {
  permissions: GrantedPermission[];  // one per token type
  delegationManager: string;
  dependencies: { factory: string; factoryData: string }[];
}

interface GrantedPermission {
  type: "native-token-periodic" | "erc20-token-periodic";
  context: string;  // hex-encoded permissionsContext
  token: string;    // "ETH" or token address
}
```

#### `apps/dashboard/components/configure.tsx` — Minor Updates

- "Signing delegation..." step label → "Requesting permissions in MetaMask..."
- Handle user rejection (Flask popup dismissed)
- Pass new permission data shape to `createIntent()`

#### `apps/dashboard/lib/api.ts` — Update Payload

```typescript
createIntent(token, {
  intentText,
  parsedIntent,
  permissions: [...],        // replaces signedDelegation
  delegationManager,
  dependencies,
});
```

#### `apps/dashboard/package.json` — Add Dependency

Add `@metamask/smart-accounts-kit` (match agent version: `0.4.0-beta.1`).

#### `apps/dashboard/components/delegation-details.tsx` — No Change

Pure display component, computes from `ParsedIntent`. Unaffected.

### Backend

#### `packages/agent/src/delegation/redeemer.ts` — Rewrite

Current: Manual `DelegationManager.encode.redeemDelegations()`.

New:
- Extend agent wallet client with `erc7710WalletActions()` from `@metamask/smart-accounts-kit/actions`
- `pullNativeToken(params)`: calls `sendTransactionWithDelegation({ to: agentAddress, data: "0x", value: amount, permissionsContext, delegationManager })`
- `pullErc20Token(params)`: calls `sendTransactionWithDelegation({ to: tokenAddress, data: transfer(agentAddress, amount), value: 0n, permissionsContext, delegationManager })`
- Keep `deployDelegatorIfNeeded()` — use `dependencies` from permission response for factory args instead of `smartAccount.getFactoryArgs()`
- Delete `fundDelegatorIfNeeded()` — no longer funding a smart account; agent swaps from its own wallet
- Delete `redeemDelegation()` — replaced by pull functions

#### `packages/agent/src/delegation/compiler.ts` — Partial Delete

- Keep `compileIntent()` — Venice LLM parsing, used by `/api/parse-intent`
- Delete `createDelegationFromIntent()` — delegation creation moves to browser
- Delete `createDelegatorSmartAccount()` — user's smart account is created by Flask

#### `packages/agent/src/agent-loop/swap.ts` — Simplify

Current: ~100 lines of `canUseDelegation` branching, delegation redemption, fallback logic.

New:
1. Before swap: `pullTokensForSwap()` pulls needed tokens from user's smart account to agent EOA
2. Swap: always direct tx from agent EOA. No delegation in the swap call.
3. Remove: `canUseDelegation`, delegation redemption attempt, fallback re-quoting, smart account swapper logic
4. `swapperAddress` is always `agentAddress`
5. Permit2 flow for ERC-20 sells stays (agent now holds USDC in its own wallet)

#### `packages/agent/src/agent-loop/index.ts` — Load Permissions From DB

Current Step 2: calls `createDelegationFromIntent()` server-side.

New Step 2: loads permissions data from intent record in DB:
```typescript
state.permissions = JSON.parse(intent.permissions);
state.delegationManager = intent.delegationManager;
state.dependencies = JSON.parse(intent.dependencies);
```

Deploy user's smart account if needed using `dependencies`.

No more `state.delegation` or `state.delegatorSmartAccount` (MetaMaskSmartAccount objects). Replaced by `state.permissions` (serializable permission data).

#### `packages/agent/src/routes/intents.ts` — Accept New Fields

Replace `signedDelegation` + `delegatorSmartAccount` with:
- `permissions` (JSON array of `{ type, context, token }`)
- `delegationManager` (address string)
- `dependencies` (JSON array of `{ factory, factoryData }`)

#### `packages/agent/src/db/schema.ts` — Migration

- Remove: `signedDelegation` column
- Add: `permissions` (text, JSON), `dependencies` (text, JSON)
- Keep: `delegationManager` (text, address)
- Remove: `delegatorSmartAccount` (address was the server's smart account, no longer applicable)

### Shared (`@maw/common`)

#### `packages/common/src/delegation.ts` — Update Exports

- Keep: `computeMaxValueWei`, `computeExpiryTimestamp`, `computeMaxCalls`, `detectAdversarialIntent`, `generateAuditReport`
- Add: `computePeriodAmount()` — converts daily budget to wei per period for ERC-7715
- Keep: safety thresholds, CONSERVATIVE_ETH_PRICE

#### `packages/common/src/constants.ts` — No Change

`AGENT_ADDRESS` used as the `to` field (session account) in permission requests.

#### `packages/common/src/schemas.ts` — Update IntentRecordSchema

Replace `signedDelegation`/`delegatorSmartAccount` fields with `permissions`/`delegationManager`/`dependencies`.

## Data Flow: Permission Types to Intent Parameters

| Intent Parameter | Maps To | Permission Type |
|-----------------|---------|----------------|
| `dailyBudgetUsd` | `periodAmount` (ETH) | `native-token-periodic` |
| `timeWindowDays` | `expiry` timestamp | permission expiry |
| N/A (USDC allocation) | `periodAmount` (USDC) | `erc20-token-periodic` |
| `maxTradesPerDay` | Software-enforced | agent loop safety check |
| `maxSlippage` | Software-enforced | Uniswap slippage parameter |
| `driftThreshold` | Software-enforced | agent reasoning trigger |

Note: `maxTradesPerDay`, `maxSlippage`, and `driftThreshold` remain software-enforced. ERC-7715 permission types don't have these constraints — they only control token amounts and time periods.

## Testing Strategy

### Unit Tests (Stubbed Clients)

**Frontend:**
- Stub `walletClient.requestExecutionPermissions()` to return mock permission responses
- Test parameter computation from intent (daily budget → period amount)
- Test Flask detection and error handling (user rejection, Flask not installed)
- Test multiple permission types (ETH-only vs ETH+USDC)

**Backend redeemer:**
- Stub `walletClient.sendTransactionWithDelegation()` → verify correct `to`, `data`, `value`, `permissionsContext` for ETH pulls
- Stub for USDC pulls → verify `transfer()` encoding
- Test deployment handling with mock `dependencies`

**Backend swap:**
- Mock pull functions + Uniswap calls
- Test two-step flow: pull amount matches swap amount
- Test safety checks still block oversized swaps

### E2E Tests

- Backend integration: hardcoded `permissionsContext` + `delegationManager` (from a real Flask approval on Sepolia). Test the full pull+swap cycle against live contracts.
- Frontend Playwright: test UI flow up to the Flask popup. Mock `requestExecutionPermissions` (can't automate Flask in headless Chrome).

### Manual Smoke Test (Pre-Merge Gate)

1. Install MetaMask Flask in browser
2. Connect to dashboard on Sepolia
3. Submit intent ("60/40 ETH/USDC, $50/day, 3 days")
4. Verify Flask shows permission prompt with correct amounts
5. Approve → verify intent created
6. Watch agent logs → verify pull transaction + Uniswap swap
7. Verify on-chain: ETH moved from user's smart account → agent → Uniswap

## Risk: ExactCalldataEnforcer Uncertainty

We believe `native-token-periodic` adds `ExactCalldataEnforcer("0x")` based on SDK caveat builder source. The actual caveat construction happens inside MetaMask Flask's permission snap.

**Mitigation:** First task on the branch is a smoke test — request a permission in Flask, inspect the returned `permissionsContext`, attempt a plain ETH pull. If caveats differ from expected, we adjust before building the full flow.

## What's Deleted

- `createDelegationFromIntent()` in compiler.ts
- `createDelegatorSmartAccount()` in compiler.ts
- `redeemDelegation()` in redeemer.ts
- `fundDelegatorIfNeeded()` in redeemer.ts
- `canUseDelegation` branching in swap.ts
- Delegation fallback logic in swap.ts
- `state.delegation` and `state.delegatorSmartAccount` in agent state
- `signedDelegation` DB column
- `delegatorSmartAccount` DB column
- Server-side `delegatorKey` config (no longer creating delegations server-side)

## What's Preserved

- Venice LLM intent parsing (`compileIntent()`)
- All safety checks (budget, per-trade, trade count)
- Uniswap Trading API integration (quote, swap, Permit2)
- ERC-8004 identity + judge evaluation
- Per-intent logging + SSE streaming
- Auth flow (nonce signing)
- `@maw/common` computation functions
- `deployDelegatorIfNeeded()` (repurposed for user smart account deployment)
