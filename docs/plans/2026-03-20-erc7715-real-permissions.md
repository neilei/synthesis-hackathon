# ERC-7715 Real Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the mocked ERC-7715 frontend delegation with real MetaMask Flask permission granting (ERC-7715) and SDK-based redemption (ERC-7710), using a two-step pull+swap architecture.

**Architecture:** The browser requests `native-token-periodic` and/or `erc20-token-periodic` permissions from MetaMask Flask via `erc7715ProviderActions()`. The backend agent pulls tokens from the user's smart account to the agent EOA via `erc7710WalletActions().sendTransactionWithDelegation()`, then swaps from its own address on Uniswap.

**Tech Stack:** `@metamask/smart-accounts-kit@0.4.0-beta.1`, viem, wagmi v2, MetaMask Flask ≥13.5.0, Sepolia testnet

**Design doc:** `docs/plans/2026-03-20-erc7715-real-permissions-design.md`

---

### Task 1: Create Branch and Add Dashboard Dependency

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `pnpm-lock.yaml` (auto-generated)

**Step 1: Create the feature branch**

```bash
git checkout -b feat/erc7715-real-permissions
```

**Step 2: Add `@metamask/smart-accounts-kit` to dashboard**

```bash
pnpm --filter @veil/dashboard add @metamask/smart-accounts-kit@0.4.0-beta.1
```

**Step 3: Verify it installs correctly**

Run: `pnpm install`
Expected: no errors, package resolves

**Step 4: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore: add @metamask/smart-accounts-kit to dashboard"
```

---

### Task 2: Add `computePeriodAmount` to `@veil/common`

**Files:**
- Modify: `packages/common/src/delegation.ts:17-32`
- Modify: `packages/common/src/index.ts:48-55`
- Create: `packages/common/src/__tests__/delegation.test.ts`

**Step 1: Write the failing test**

Create `packages/common/src/__tests__/delegation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computePeriodAmount } from "../delegation.js";

describe("computePeriodAmount", () => {
  it("converts daily budget USD to ETH wei per period", () => {
    // $200/day at $500/ETH = 0.4 ETH = 400000000000000000 wei
    const result = computePeriodAmount(200, "ETH");
    expect(result).toBe(400000000000000000n);
  });

  it("converts daily budget USD to USDC units per period", () => {
    // $200/day in USDC = 200 USDC = 200_000_000 (6 decimals)
    const result = computePeriodAmount(200, "USDC");
    expect(result).toBe(200_000_000n);
  });

  it("returns 0 for zero budget", () => {
    expect(computePeriodAmount(0, "ETH")).toBe(0n);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/common test -- --run delegation`
Expected: FAIL — `computePeriodAmount` not exported

**Step 3: Implement `computePeriodAmount`**

Add to `packages/common/src/delegation.ts` after `computeMaxCalls` (after line 45):

```typescript
/**
 * Compute the token amount per period for an ERC-7715 periodic permission.
 * For ETH: converts daily USD budget to wei using conservative ETH price.
 * For USDC: converts daily USD budget to USDC units (6 decimals).
 */
export function computePeriodAmount(
  dailyBudgetUsd: number,
  token: "ETH" | "USDC",
  conservativeEthPrice = CONSERVATIVE_ETH_PRICE_USD,
): bigint {
  if (dailyBudgetUsd === 0) return 0n;
  if (token === "USDC") {
    return BigInt(Math.ceil(dailyBudgetUsd * 1e6));
  }
  // ETH: convert USD to ETH at conservative price, then to wei
  const ethAmount = dailyBudgetUsd / conservativeEthPrice;
  return BigInt(Math.ceil(ethAmount * 1e18));
}
```

Add to `packages/common/src/index.ts` exports (line 49, inside the delegation.js export block):

```typescript
export {
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
  computePeriodAmount,
  detectAdversarialIntent,
  generateAuditReport,
  type AdversarialWarning,
} from "./delegation.js";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @veil/common test -- --run delegation`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/common/src/delegation.ts packages/common/src/index.ts packages/common/src/__tests__/delegation.test.ts
git commit -m "feat: add computePeriodAmount for ERC-7715 periodic permissions"
```

---

### Task 3: Update DB Schema — Replace `signedDelegation` with Permissions Fields

**Files:**
- Modify: `packages/agent/src/db/schema.ts:19-26`

**Step 1: Update the intents table schema**

Replace lines 19-26 in `packages/agent/src/db/schema.ts`:

```typescript
  // ERC-7715 permissions (from MetaMask Flask)
  permissions: text("permissions"),           // JSON: [{ type, context, token }]
  delegationManager: text("delegation_manager"),
  dependencies: text("dependencies"),         // JSON: [{ factory, factoryData }]
```

This removes `signedDelegation` (was `.notNull()`), `delegatorSmartAccount` (was `.notNull()`), and the old `permissionsContext` field. All three new fields are nullable because:
- Existing DB rows won't have them
- The fields are set from frontend data at creation time

**Step 2: Delete existing dev database** (dev data only, we're on a feature branch)

```bash
rm -f data/veil.db data/veil.db-wal data/veil.db-shm
```

**Step 3: Verify the agent compiles**

Run: `pnpm --filter @veil/agent exec tsc --noEmit 2>&1 | head -20`
Expected: Type errors in `routes/intents.ts` and `agent-worker.ts` (they reference old field names). This is expected — we'll fix them in subsequent tasks.

**Step 4: Commit**

```bash
git add packages/agent/src/db/schema.ts
git commit -m "feat: update DB schema for ERC-7715 permissions fields"
```

---

### Task 4: Update Intent Route to Accept Permissions Data

**Files:**
- Modify: `packages/agent/src/routes/intents.ts:25-89`
- Modify: `packages/agent/src/routes/__tests__/intents.test.ts`

**Step 1: Update the POST / handler**

Replace the field extraction and validation in `packages/agent/src/routes/intents.ts` (lines 29-53):

```typescript
    const intentText =
      typeof body.intentText === "string" ? body.intentText.trim() : null;
    const parsedIntentRaw = body.parsedIntent;
    const permissions =
      typeof body.permissions === "string" ? body.permissions : null;
    const delegationManager =
      typeof body.delegationManager === "string"
        ? body.delegationManager
        : null;
    const dependencies =
      typeof body.dependencies === "string" ? body.dependencies : null;

    if (!intentText || !parsedIntentRaw || !permissions || !delegationManager) {
      return c.json(
        {
          error:
            "Missing required fields: intentText, parsedIntent, permissions, delegationManager",
        },
        400,
      );
    }
```

Update the `deps.repo.createIntent()` call (around line 71-89):

```typescript
    const intent = deps.repo.createIntent({
      id: intentId,
      walletAddress: wallet,
      intentText,
      parsedIntent: JSON.stringify(parsed),
      status: "active",
      createdAt: now,
      expiresAt,
      permissions,
      delegationManager,
      dependencies,
    });
```

**Step 2: Update the unit test**

In `packages/agent/src/routes/__tests__/intents.test.ts`, find the test body payloads that send `signedDelegation` and `delegatorSmartAccount`. Replace with:

```typescript
const intentBody = {
  intentText: "60/40 ETH/USDC, $200/day, 7 days",
  parsedIntent: { /* existing parsed intent */ },
  permissions: JSON.stringify([
    { type: "native-token-periodic", context: "0xdeadbeef", token: "ETH" },
  ]),
  delegationManager: "0x0000000000000000000000000000000000000001",
  dependencies: JSON.stringify([]),
};
```

**Step 3: Run tests**

Run: `pnpm --filter @veil/agent test -- --run intents`
Expected: PASS (or fix any remaining references to old field names)

**Step 4: Commit**

```bash
git add packages/agent/src/routes/intents.ts packages/agent/src/routes/__tests__/intents.test.ts
git commit -m "feat: accept ERC-7715 permissions data in POST /api/intents"
```

---

### Task 5: Rewrite `redeemer.ts` — Pull Functions via `erc7710WalletActions`

**Files:**
- Rewrite: `packages/agent/src/delegation/redeemer.ts`
- Create: `packages/agent/src/delegation/__tests__/redeemer.test.ts` (rewrite)

**Step 1: Write the failing tests**

Rewrite `packages/agent/src/delegation/__tests__/redeemer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Hex, Address } from "viem";

// Mock the SDK's wallet actions
const mockSendTransactionWithDelegation = vi.fn();
vi.mock("@metamask/smart-accounts-kit/actions", () => ({
  erc7710WalletActions: () => () => ({
    sendTransactionWithDelegation: mockSendTransactionWithDelegation,
  }),
}));

// Mock viem
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      extend: vi.fn(() => ({
        sendTransactionWithDelegation: mockSendTransactionWithDelegation,
      })),
    })),
    createPublicClient: vi.fn(() => ({
      getCode: vi.fn().mockResolvedValue("0x"),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    })),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0xAgentAddress" as Address,
  })),
}));

vi.mock("../../config.js", () => ({
  rpcTransport: vi.fn(),
}));

describe("pullNativeToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendTransactionWithDelegation.mockResolvedValue("0xtxhash" as Hex);
  });

  it("calls sendTransactionWithDelegation with correct params for ETH pull", async () => {
    const { pullNativeToken } = await import("../redeemer.js");
    const result = await pullNativeToken({
      agentKey: "0xabc123" as `0x${string}`,
      chain: { id: 11155111, name: "sepolia" } as any,
      agentAddress: "0xAgentAddress" as Address,
      amount: 100000000000000000n, // 0.1 ETH
      permissionsContext: "0xdeadbeef" as Hex,
      delegationManager: "0xDelegationManager" as Address,
    });

    expect(mockSendTransactionWithDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xAgentAddress",
        data: "0x",
        value: 100000000000000000n,
        permissionsContext: "0xdeadbeef",
        delegationManager: "0xDelegationManager",
      }),
    );
    expect(result).toBe("0xtxhash");
  });
});

describe("pullErc20Token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendTransactionWithDelegation.mockResolvedValue("0xtxhash" as Hex);
  });

  it("encodes transfer() calldata for USDC pull", async () => {
    const { pullErc20Token } = await import("../redeemer.js");
    const result = await pullErc20Token({
      agentKey: "0xabc123" as `0x${string}`,
      chain: { id: 11155111, name: "sepolia" } as any,
      agentAddress: "0xAgentAddress" as Address,
      tokenAddress: "0xUSDC" as Address,
      amount: 200000000n, // 200 USDC
      permissionsContext: "0xdeadbeef" as Hex,
      delegationManager: "0xDelegationManager" as Address,
    });

    expect(mockSendTransactionWithDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xUSDC",
        value: 0n,
        permissionsContext: "0xdeadbeef",
        delegationManager: "0xDelegationManager",
      }),
    );
    // Verify data is a transfer() call (selector 0xa9059cbb)
    const call = mockSendTransactionWithDelegation.mock.calls[0][0];
    expect(call.data.startsWith("0xa9059cbb")).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/agent test -- --run redeemer`
Expected: FAIL — `pullNativeToken` and `pullErc20Token` not exported

**Step 3: Rewrite `redeemer.ts`**

Replace `packages/agent/src/delegation/redeemer.ts` entirely:

```typescript
/**
 * ERC-7710 permission redemption. Uses the Smart Accounts Kit's
 * erc7710WalletActions to pull tokens from the user's MetaMask smart
 * account to the agent EOA, within ERC-7715 granted permission limits.
 *
 * @module @veil/agent/delegation/redeemer
 */
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  type Chain,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { rpcTransport } from "../config.js";
import { logger } from "../logging/logger.js";

// Minimal ERC-20 ABI for transfer encoding
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PullNativeParams {
  agentKey: `0x${string}`;
  chain: Chain;
  agentAddress: Address;
  amount: bigint;
  permissionsContext: Hex;
  delegationManager: Address;
}

export interface PullErc20Params {
  agentKey: `0x${string}`;
  chain: Chain;
  agentAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  permissionsContext: Hex;
  delegationManager: Address;
}

export interface DeployDependencyParams {
  agentKey: `0x${string}`;
  chain: Chain;
  smartAccountAddress: Address;
  dependencies: { factory: Address; factoryData: Hex }[];
}

// ---------------------------------------------------------------------------
// deploySmartAccountIfNeeded — deploy user's smart account from dependencies
// ---------------------------------------------------------------------------

export async function deploySmartAccountIfNeeded(
  params: DeployDependencyParams,
): Promise<Hex | null> {
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: rpcTransport(params.chain),
  });

  const code = await publicClient.getCode({
    address: params.smartAccountAddress,
  });
  if (code && code !== "0x") {
    return null; // Already deployed
  }

  if (params.dependencies.length === 0) {
    throw new Error(
      "Smart account not deployed and no dependencies provided for deployment",
    );
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  });

  // Deploy using the first dependency's factory
  const dep = params.dependencies[0]!;
  const txHash = await walletClient.sendTransaction({
    to: dep.factory,
    data: dep.factoryData,
    chain: params.chain,
    account: walletClient.account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Smart account deployment failed: ${txHash}`);
  }

  logger.info(
    `User smart account deployed at ${params.smartAccountAddress} (tx: ${txHash})`,
  );
  return txHash;
}

// ---------------------------------------------------------------------------
// pullNativeToken — pull ETH from user's smart account via ERC-7710
// ---------------------------------------------------------------------------

export async function pullNativeToken(
  params: PullNativeParams,
): Promise<Hex> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  }).extend(erc7710WalletActions());

  logger.info(
    `Pulling ${params.amount} wei from user smart account via ERC-7710...`,
  );

  const txHash = await walletClient.sendTransactionWithDelegation({
    to: params.agentAddress,
    data: "0x" as Hex,
    value: params.amount,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
  });

  return txHash;
}

// ---------------------------------------------------------------------------
// pullErc20Token — pull ERC-20 tokens from user's smart account via ERC-7710
// ---------------------------------------------------------------------------

export async function pullErc20Token(
  params: PullErc20Params,
): Promise<Hex> {
  const transferData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [params.agentAddress, params.amount],
  });

  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  }).extend(erc7710WalletActions());

  logger.info(
    `Pulling ${params.amount} tokens from user smart account via ERC-7710...`,
  );

  const txHash = await walletClient.sendTransactionWithDelegation({
    to: params.tokenAddress,
    data: transferData,
    value: 0n,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
  });

  return txHash;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/agent test -- --run redeemer`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/delegation/redeemer.ts packages/agent/src/delegation/__tests__/redeemer.test.ts
git commit -m "feat: rewrite redeemer with ERC-7710 pull functions via Smart Accounts Kit"
```

---

### Task 6: Clean Up `compiler.ts` — Remove Server-Side Delegation Creation

**Files:**
- Modify: `packages/agent/src/delegation/compiler.ts`
- Modify: `packages/agent/src/delegation/__tests__/compiler.test.ts`

**Step 1: Remove `createDelegationFromIntent` and `createDelegatorSmartAccount`**

Keep `compileIntent()` (lines 35-86). Delete `createDelegatorSmartAccount()` (lines 93-110) and `createDelegationFromIntent()` (lines 121-202).

Remove unused imports: `createDelegation`, `getSmartAccountsEnvironment`, `toMetaMaskSmartAccount`, `Implementation`, `Delegation`, `MetaMaskSmartAccount` from `@metamask/smart-accounts-kit`. Remove `CONTRACTS`, `rpcTransport` imports. Remove `SECONDS_PER_DAY` import. Remove `encodePacked` from viem. Keep only what `compileIntent` needs.

**Step 2: Update compiler tests**

Remove tests for `createDelegationFromIntent` and `createDelegatorSmartAccount`. Keep tests for `compileIntent` and `detectAdversarialIntent`.

**Step 3: Verify compilation**

Run: `pnpm --filter @veil/agent exec tsc --noEmit 2>&1 | head -20`
Expected: May still show errors from agent-loop/index.ts (next task)

**Step 4: Commit**

```bash
git add packages/agent/src/delegation/compiler.ts packages/agent/src/delegation/__tests__/compiler.test.ts
git commit -m "refactor: remove server-side delegation creation from compiler"
```

---

### Task 7: Update Agent State and Config Types

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:13,20-23,44-69,71-88,116-137,269-316`

**Step 1: Update imports**

Remove line 13 (`import type { Delegation, MetaMaskSmartAccount } from "@metamask/smart-accounts-kit"`).

Remove line 22 (`createDelegationFromIntent` from the delegation/compiler import).

**Step 2: Update AgentConfig**

Replace `delegatorKey` (line 46) with permissions fields:

```typescript
export interface AgentConfig {
  intent: IntentParse;
  agentKey: `0x${string}`;
  chainId: number;
  intervalMs: number;
  /** ERC-7715 permissions granted by user in MetaMask Flask */
  permissions: { type: string; context: string; token: string }[];
  /** DelegationManager contract address from permission response */
  delegationManager: string;
  /** Factory deployment info for user's smart account */
  dependencies: { factory: string; factoryData: string }[];
  maxCycles?: number;
  signal?: AbortSignal;
  onCycleComplete?: (state: AgentState) => void;
  intentLogger?: import("../logging/intent-log.js").IntentLogger;
  intentId?: string;
  existingAgentId?: bigint;
  onAgentIdRegistered?: (agentId: string) => void;
  initialCycle?: number;
  initialTradesExecuted?: number;
  initialTotalSpentUsd?: number;
}
```

**Step 3: Update AgentState**

Replace `delegation` and `delegatorSmartAccount` with permissions:

```typescript
export interface AgentState {
  permissions: { type: string; context: string; token: string }[];
  delegationManager: string;
  dependencies: { factory: string; factoryData: string }[];
  tradesExecuted: number;
  totalSpentUsd: number;
  running: boolean;
  cycle: number;
  ethPrice: number;
  drift: number;
  allocation: Record<string, number>;
  totalValue: number;
  budgetTier: string;
  transactions: SwapRecord[];
  audit: DetailedAuditReport | null;
  agentId: bigint | null;
  deployError: string | null;
}
```

**Step 4: Update state initialization in `runAgentLoop`**

```typescript
const state: AgentState = {
  permissions: config.permissions,
  delegationManager: config.delegationManager,
  dependencies: config.dependencies,
  tradesExecuted: config.initialTradesExecuted ?? 0,
  // ... rest stays the same, remove delegation: null, delegatorSmartAccount: null
};
```

**Step 5: Replace Step 2 (delegation creation) with permissions loading**

Replace lines 269-316 with:

```typescript
  // --- Step 2: Load ERC-7715 permissions ---
  logger.info("Loading ERC-7715 permissions from user grant...");
  if (state.permissions.length === 0) {
    const msg = "No ERC-7715 permissions granted — cannot pull tokens from user.";
    logger.error(msg);
    state.deployError = msg;
    state.running = false;
    logAction("permissions_missing", { error: msg });
    config.intentLogger?.log("permissions_missing", { error: msg });
    return state;
  }

  logAction("permissions_loaded", {
    tool: "metamask-erc7715",
    result: {
      permissionCount: state.permissions.length,
      types: state.permissions.map((p) => p.type),
      delegationManager: state.delegationManager,
      dependencyCount: state.dependencies.length,
    },
  });
  config.intentLogger?.log("permissions_loaded", {
    tool: "metamask-erc7715",
    result: {
      permissionCount: state.permissions.length,
      types: state.permissions.map((p) => p.type),
    },
  });
```

**Step 6: Commit**

```bash
git add packages/agent/src/agent-loop/index.ts
git commit -m "refactor: replace delegation state with ERC-7715 permissions in agent loop"
```

---

### Task 8: Simplify `swap.ts` — Two-Step Pull+Swap

**Files:**
- Modify: `packages/agent/src/agent-loop/swap.ts`
- Modify: `packages/agent/src/__tests__/swap-safety.test.ts`

**Step 1: Replace delegation imports with pull functions**

Replace the `redeemDelegation` import with:

```typescript
import { pullNativeToken, pullErc20Token } from "../delegation/redeemer.js";
```

**Step 2: Remove `canUseDelegation` logic**

Remove lines 119-124. The `swapperAddress` is always `agentAddress`.

**Step 3: Add pull step before swap**

Before the Uniswap quote (around line 170), add token pull logic:

```typescript
  // Pull tokens from user's smart account if permissions are available
  const ethPermission = state.permissions.find(
    (p) => p.type === "native-token-periodic" || p.type === "native-token-stream",
  );
  const erc20Permission = state.permissions.find(
    (p) => p.type === "erc20-token-periodic" || p.type === "erc20-token-stream",
  );

  if (isEthSell && ethPermission) {
    try {
      const pullTx = await pullNativeToken({
        agentKey: config.agentKey,
        chain,
        agentAddress,
        amount: parseUnits(swap.sellAmount, 18),
        permissionsContext: ethPermission.context as `0x${string}`,
        delegationManager: state.delegationManager as `0x${string}`,
      });
      logger.info(`Pulled ${swap.sellAmount} ETH from user (tx: ${pullTx})`);
      logAction("token_pull", {
        cycle: state.cycle,
        tool: "metamask-erc7710",
        result: { txHash: pullTx, token: "ETH", amount: swap.sellAmount },
      });
      config.intentLogger?.log("token_pull", {
        cycle: state.cycle,
        tool: "metamask-erc7710",
        result: { txHash: pullTx, token: "ETH", amount: swap.sellAmount },
      });
    } catch (pullErr) {
      const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
      logger.error({ err: pullErr }, `Failed to pull ETH: ${pullMsg}`);
      throw new Error(`Token pull failed: ${pullMsg}`);
    }
  } else if (!isEthSell && erc20Permission) {
    try {
      const pullTx = await pullErc20Token({
        agentKey: config.agentKey,
        chain,
        agentAddress,
        tokenAddress: sellTokenAddress,
        amount: parseUnits(swap.sellAmount, decimals),
        permissionsContext: erc20Permission.context as `0x${string}`,
        delegationManager: state.delegationManager as `0x${string}`,
      });
      logger.info(`Pulled ${swap.sellAmount} ${swap.sellToken} from user (tx: ${pullTx})`);
      logAction("token_pull", {
        cycle: state.cycle,
        tool: "metamask-erc7710",
        result: { txHash: pullTx, token: swap.sellToken, amount: swap.sellAmount },
      });
      config.intentLogger?.log("token_pull", {
        cycle: state.cycle,
        tool: "metamask-erc7710",
        result: { txHash: pullTx, token: swap.sellToken, amount: swap.sellAmount },
      });
    } catch (pullErr) {
      const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
      logger.error({ err: pullErr }, `Failed to pull ${swap.sellToken}: ${pullMsg}`);
      throw new Error(`Token pull failed: ${pullMsg}`);
    }
  }
```

**Step 4: Remove all delegation redemption and fallback logic**

Remove the `canUseDelegation` branching in the swap execution section (the `if (canUseDelegation) { ... } else { ... }` block). Replace with a single direct-tx path — the agent always swaps from its own address.

**Step 5: Update swap safety tests**

Update `packages/agent/src/__tests__/swap-safety.test.ts` to use the new `AgentState` shape (replace `delegation`/`delegatorSmartAccount` with `permissions`/`delegationManager`/`dependencies`).

**Step 6: Run tests**

Run: `pnpm --filter @veil/agent test -- --run swap`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/agent/src/agent-loop/swap.ts packages/agent/src/__tests__/swap-safety.test.ts
git commit -m "feat: implement two-step pull+swap flow with ERC-7710 token pulls"
```

---

### Task 9: Update `agent-worker.ts` — Load Permissions From DB

**Files:**
- Modify: `packages/agent/src/agent-worker.ts:65-111`

**Step 1: Replace `DELEGATOR_PRIVATE_KEY` check with permissions check**

Replace lines 65-71:

```typescript
    if (!intent.permissions || !intent.delegationManager) {
      const msg = "Intent has no ERC-7715 permissions — cannot start agent without user-granted permissions.";
      logger.error({ intentId: this.intentId }, msg);
      this.intentLogger.log("worker_error", { error: msg });
      this.deps.repo.updateIntentStatus(this.intentId, "failed");
      return;
    }
```

**Step 2: Update AgentConfig construction**

Replace lines 90-111. Remove `delegatorKey`, add permissions fields:

```typescript
    let permissions;
    let dependencies;
    try {
      permissions = JSON.parse(intent.permissions);
      dependencies = intent.dependencies ? JSON.parse(intent.dependencies) : [];
    } catch {
      logger.error({ intentId: this.intentId }, "Failed to parse permissions/dependencies");
      this.running = false;
      return;
    }

    const config: AgentConfig = {
      intent: parsed,
      agentKey: env.AGENT_PRIVATE_KEY,
      chainId: 11155111,
      intervalMs: 20_000,
      permissions,
      delegationManager: intent.delegationManager,
      dependencies,
      signal: this.abortController.signal,
      intentLogger: this.intentLogger,
      intentId: this.intentId,
      existingAgentId:
        intent.agentId != null ? BigInt(intent.agentId) : undefined,
      initialCycle: intent.cycle,
      initialTradesExecuted: intent.tradesExecuted,
      initialTotalSpentUsd: intent.totalSpentUsd,
      onAgentIdRegistered: (agentId: string) => {
        this.deps.repo.updateIntentAgentId(this.intentId, agentId);
      },
      onCycleComplete: (loopState) => {
        this.state = loopState;
        this.persistState(loopState);
      },
    };
```

**Step 3: Run full agent test suite**

Run: `pnpm --filter @veil/agent test -- --run`
Expected: PASS (or identify remaining issues)

**Step 4: Commit**

```bash
git add packages/agent/src/agent-worker.ts
git commit -m "feat: load ERC-7715 permissions from DB in agent worker"
```

---

### Task 10: Rewrite Frontend `use-delegation.ts` → `use-permissions.ts`

**Files:**
- Rename + Rewrite: `apps/dashboard/hooks/use-delegation.ts` → `apps/dashboard/hooks/use-permissions.ts`
- Modify: `apps/dashboard/components/configure.tsx` (update import)

**Step 1: Create `use-permissions.ts`**

```typescript
"use client";

import { useState, useCallback } from "react";
import { useWalletClient } from "wagmi";
import { parseEther } from "viem";
import type { Hex } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import type { ParsedIntent } from "@veil/common";
import { AGENT_ADDRESS, computePeriodAmount, computeExpiryTimestamp } from "@veil/common";
import { CONTRACTS } from "@/lib/contracts";

export interface GrantedPermission {
  type: "native-token-periodic" | "erc20-token-periodic";
  context: string;
  token: string;
}

export interface PermissionResult {
  permissions: GrantedPermission[];
  delegationManager: string;
  dependencies: { factory: string; factoryData: string }[];
}

export function usePermissions() {
  const { data: walletClient } = useWalletClient();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPermissions = useCallback(
    async (parsed: ParsedIntent): Promise<PermissionResult | null> => {
      if (!walletClient) {
        setError("Wallet not connected");
        return null;
      }

      // Check for Flask
      const ethereum = (window as any).ethereum;
      if (!ethereum?.isMetaMask) {
        setError("MetaMask not detected. Please install MetaMask Flask.");
        return null;
      }

      setRequesting(true);
      setError(null);

      try {
        const client = walletClient.extend(erc7715ProviderActions());
        const expiry = computeExpiryTimestamp(parsed.timeWindowDays);

        // Build permission requests based on intent allocation
        const permissionRequests = [];
        const hasEth = parsed.targetAllocation["ETH"] != null;
        const hasUsdc = parsed.targetAllocation["USDC"] != null;

        if (hasEth) {
          const ethPeriodAmount = computePeriodAmount(
            parsed.dailyBudgetUsd,
            "ETH",
          );
          permissionRequests.push({
            chainId: walletClient.chain.id,
            expiry,
            to: AGENT_ADDRESS as `0x${string}`,
            isAdjustmentAllowed: true,
            permission: {
              type: "native-token-periodic" as const,
              data: {
                periodAmount: ethPeriodAmount,
                periodDuration: 86400, // 1 day
                justification: `Rebalance: up to ${ethPeriodAmount} wei ETH per day for portfolio management`,
              },
            },
          });
        }

        if (hasUsdc) {
          const usdcPeriodAmount = computePeriodAmount(
            parsed.dailyBudgetUsd,
            "USDC",
          );
          permissionRequests.push({
            chainId: walletClient.chain.id,
            expiry,
            to: AGENT_ADDRESS as `0x${string}`,
            isAdjustmentAllowed: true,
            permission: {
              type: "erc20-token-periodic" as const,
              data: {
                tokenAddress: CONTRACTS.USDC_SEPOLIA,
                periodAmount: usdcPeriodAmount,
                periodDuration: 86400,
                justification: `Rebalance: up to ${usdcPeriodAmount} USDC units per day for portfolio management`,
              },
            },
          });
        }

        const grantedPermissions =
          await client.requestExecutionPermissions(permissionRequests);

        // Map response to our GrantedPermission shape
        const permissions: GrantedPermission[] = grantedPermissions.map(
          (gp: any, i: number) => ({
            type: permissionRequests[i]!.permission.type,
            context: gp.context,
            token:
              permissionRequests[i]!.permission.type ===
              "native-token-periodic"
                ? "ETH"
                : CONTRACTS.USDC_SEPOLIA,
          }),
        );

        return {
          permissions,
          delegationManager: grantedPermissions[0]?.delegationManager ?? "",
          dependencies: grantedPermissions[0]?.dependencies ?? [],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Permission request failed";
        if (msg.includes("User rejected") || msg.includes("denied")) {
          setError("Permission request was rejected in MetaMask.");
        } else {
          setError(msg);
        }
        return null;
      } finally {
        setRequesting(false);
      }
    },
    [walletClient],
  );

  return {
    requestPermissions,
    requesting,
    error,
  };
}
```

**Step 2: Create `apps/dashboard/lib/contracts.ts`** (token addresses for dashboard)

```typescript
export const CONTRACTS = {
  USDC_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
} as const;
```

**Step 3: Delete old `use-delegation.ts`**

**Step 4: Update `configure.tsx`** — replace `useDelegation` import with `usePermissions`, update the `handleDeploy` function to use the new return shape.

**Step 5: Update `api.ts`** — change `createIntent` signature to accept permissions fields instead of `signedDelegation`/`delegatorSmartAccount`.

**Step 6: Run dashboard type check**

Run: `pnpm --filter @veil/dashboard exec tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/dashboard/hooks/ apps/dashboard/components/configure.tsx apps/dashboard/lib/api.ts apps/dashboard/lib/contracts.ts
git commit -m "feat: real ERC-7715 permission request via MetaMask Flask"
```

---

### Task 11: Update `IntentRecordSchema` and API Types

**Files:**
- Modify: `packages/common/src/schemas.ts:79-95`

**Step 1: Remove old delegation fields from schema considerations**

The `IntentRecordSchema` doesn't currently include `signedDelegation` or `delegatorSmartAccount` (they're in the DB but not the API schema). Verify no changes needed to the Zod schema — the permissions data is stored in DB columns but not necessarily returned in the list API.

**Step 2: Run type check across monorepo**

Run: `pnpm run lint` and `pnpm --filter @veil/agent exec tsc --noEmit` and `pnpm --filter @veil/dashboard exec tsc --noEmit`
Expected: PASS

**Step 3: Commit if any changes**

```bash
git add -A
git commit -m "chore: align API types with ERC-7715 permissions schema"
```

---

### Task 12: Update Existing Tests — Agent Loop, E2E, Lifecycle

**Files:**
- Modify: `packages/agent/src/__tests__/agent-loop.test.ts`
- Modify: `packages/agent/src/__tests__/startup.test.ts`
- Modify: `packages/agent/src/__tests__/lifecycle.e2e.test.ts`
- Modify: `packages/agent/src/__tests__/multi-intent.e2e.test.ts`
- Modify: `packages/agent/src/delegation/__tests__/delegation.e2e.test.ts`
- Modify: `apps/dashboard/tests/configure.spec.ts`

**Step 1: Update all test fixtures**

Every test that creates an `AgentConfig` or `AgentState` needs to use the new permissions shape instead of `delegation`/`delegatorSmartAccount`/`delegatorKey`.

Fixture pattern:

```typescript
const mockPermissions = [
  { type: "native-token-periodic", context: "0xdeadbeef", token: "ETH" },
];
const mockDelegationManager = "0x0000000000000000000000000000000000000001";
const mockDependencies: { factory: string; factoryData: string }[] = [];

const config: AgentConfig = {
  intent: mockIntent,
  agentKey: "0x..." as `0x${string}`,
  chainId: 11155111,
  intervalMs: 20_000,
  permissions: mockPermissions,
  delegationManager: mockDelegationManager,
  dependencies: mockDependencies,
};
```

**Step 2: Update dashboard Playwright tests**

In `apps/dashboard/tests/configure.spec.ts`, mock the `requestExecutionPermissions` call instead of the old `signDelegation` mock.

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update all tests for ERC-7715 permissions architecture"
```

---

### Task 13: Remove Dead Code and Clean Up Config

**Files:**
- Modify: `packages/agent/src/config.ts:29-34` (make `DELEGATOR_PRIVATE_KEY` no longer referenced)
- Delete: `packages/agent/src/delegation/__tests__/audit.e2e.test.ts` (if it tests old delegation flow)
- Clean up any remaining imports of deleted functions

**Step 1: Remove `DELEGATOR_PRIVATE_KEY` from env schema**

In `packages/agent/src/config.ts`, remove lines 29-34 (the `DELEGATOR_PRIVATE_KEY` field). The agent no longer creates delegations server-side.

**Step 2: Search for any remaining references**

```bash
grep -r "DELEGATOR_PRIVATE_KEY\|createDelegationFromIntent\|createDelegatorSmartAccount\|signedDelegation\|delegatorSmartAccount\|fundDelegatorIfNeeded\|redeemDelegation[^s]" packages/agent/src/ apps/dashboard/ --include="*.ts" -l
```

Fix any remaining references.

**Step 3: Run full build + test**

Run: `pnpm run lint && pnpm --filter @veil/agent exec tsc --noEmit && pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead delegation code and DELEGATOR_PRIVATE_KEY config"
```

---

### Task 14: Update CLAUDE.md and Design Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/plans/2026-03-20-erc7715-real-permissions-design.md`

**Step 1: Update CLAUDE.md**

- Update "Delegation flow" bullet to describe the two-step pull+swap architecture
- Remove references to `delegatorKey`, `functionCall` scope, `ValueLteEnforcer`
- Add note about MetaMask Flask requirement for ERC-7715 permissions
- Update "Key Technical Decisions" delegation section

**Step 2: Mark design doc status as "Implemented"**

**Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update CLAUDE.md and design doc for ERC-7715 real permissions"
```

---

### Task 15: Manual Smoke Test on Sepolia

**Not code — manual verification gate.**

1. Start the agent server: `pnpm run serve`
2. Start the dashboard: `pnpm run dev:dashboard`
3. Open browser with MetaMask Flask installed, connected to Sepolia
4. Fund the Flask wallet with Sepolia ETH
5. Navigate to dashboard, connect wallet
6. Submit intent: "60/40 ETH/USDC, $50/day, 3 days"
7. Verify Flask shows permission prompt with correct amounts
8. Approve the permission
9. Verify intent is created and agent starts
10. Watch agent logs for `token_pull` and `swap_executed` events
11. Verify on-chain: ETH moved from user's smart account → agent EOA → Uniswap

If the smoke test reveals issues (e.g., ExactCalldataEnforcer revert), create a follow-up task to address.

---

## Task Dependency Graph

```
Task 1 (branch + deps)
  ↓
Task 2 (computePeriodAmount)
  ↓
Task 3 (DB schema) → Task 4 (intent route) → Task 9 (agent-worker)
  ↓                                               ↓
Task 5 (redeemer rewrite) → Task 8 (swap.ts) → Task 7 (agent state) → Task 12 (tests)
  ↓                                                                        ↓
Task 6 (compiler cleanup)                                            Task 13 (dead code)
                                                                          ↓
Task 10 (frontend hook) → Task 11 (API types) → Task 14 (docs) → Task 15 (smoke test)
```

Tasks 2, 3, 5, 6, 10 can start in parallel after Task 1. Tasks 7-9 depend on earlier tasks. Tasks 12-15 are sequential cleanup and validation.
