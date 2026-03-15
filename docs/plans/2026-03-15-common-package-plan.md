# `@veil/common` Shared Package — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `packages/common` as the single source of truth for API types, constants, and utilities shared between `packages/agent` and `apps/dashboard`, eliminating all type duplication and drift risk.

**Architecture:** New `@veil/common` package with Zod schemas (deriving types via `z.infer`), shared constants, formatting utilities, and token metadata. Both consumer packages import from common instead of maintaining parallel type definitions. The package has a single dependency (zod) and contains no framework-specific code.

**Tech Stack:** TypeScript, Zod v4, Vitest, pnpm workspaces

**Design doc:** `docs/plans/2026-03-15-common-package-design.md`

---

## Task 1: Scaffold `packages/common`

**Files:**
- Create: `packages/common/package.json`
- Create: `packages/common/tsconfig.json`
- Create: `packages/common/vitest.config.ts`
- Create: `packages/common/src/index.ts` (empty barrel, populated later)

**Step 1: Create `packages/common/package.json`**

```json
{
  "name": "@veil/common",
  "version": "0.1.0",
  "description": "Shared types, constants, and utilities for Veil monorepo",
  "type": "module",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/src/index.js",
      "types": "./dist/src/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^4.3.0"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vitest": "^4.1.0"
  }
}
```

**Step 2: Create `packages/common/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create `packages/common/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

**Step 4: Create empty barrel file `packages/common/src/index.ts`**

```typescript
// Barrel exports — populated as modules are added
```

**Step 5: Install dependencies and verify**

Run: `pnpm install`
Run: `pnpm --filter @veil/common build`
Expected: Builds successfully with empty output

**Step 6: Commit**

```
feat(common): scaffold @veil/common package
```

---

## Task 2: Implement schemas (TDD)

**Files:**
- Create: `packages/common/src/schemas.ts`
- Create: `packages/common/src/__tests__/schemas.test.ts`
- Modify: `packages/common/src/index.ts`

**Step 1: Write the failing tests**

Create `packages/common/src/__tests__/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  ParsedIntentSchema,
  SwapRecordSchema,
  AuditReportSchema,
  AgentLogEntrySchema,
  AgentStateResponseSchema,
  DeployResponseSchema,
} from "../schemas.js";

describe("ParsedIntentSchema", () => {
  const valid = {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  };

  it("accepts valid intent", () => {
    expect(ParsedIntentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing fields", () => {
    const { dailyBudgetUsd: _, ...partial } = valid;
    expect(ParsedIntentSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects wrong types", () => {
    expect(
      ParsedIntentSchema.safeParse({ ...valid, dailyBudgetUsd: "200" }).success,
    ).toBe(false);
  });
});

describe("SwapRecordSchema", () => {
  const valid = {
    txHash: "0xabc123",
    sellToken: "ETH",
    buyToken: "USDC",
    sellAmount: "0.1",
    status: "confirmed",
    timestamp: "2026-03-15T00:00:00.000Z",
  };

  it("accepts valid swap record", () => {
    expect(SwapRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing txHash", () => {
    const { txHash: _, ...partial } = valid;
    expect(SwapRecordSchema.safeParse(partial).success).toBe(false);
  });
});

describe("AuditReportSchema", () => {
  const valid = {
    allows: ["Swap ETH/USDC"],
    prevents: ["External transfers"],
    worstCase: "Max loss: $200",
    warnings: [],
  };

  it("accepts valid audit report", () => {
    expect(AuditReportSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty arrays", () => {
    expect(
      AuditReportSchema.safeParse({
        ...valid,
        allows: [],
        prevents: [],
      }).success,
    ).toBe(true);
  });

  it("strips unknown fields (intentMatch, formatted)", () => {
    const withExtra = { ...valid, intentMatch: "yes", formatted: "text" };
    const result = AuditReportSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("intentMatch" in result.data).toBe(false);
      expect("formatted" in result.data).toBe(false);
    }
  });
});

describe("AgentLogEntrySchema", () => {
  it("accepts minimal entry (required fields only)", () => {
    const minimal = {
      timestamp: "2026-03-15T00:00:00.000Z",
      sequence: 0,
      action: "agent_start",
    };
    expect(AgentLogEntrySchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts full entry with all optional fields", () => {
    const full = {
      timestamp: "2026-03-15T00:00:00.000Z",
      sequence: 1,
      action: "price_fetch",
      tool: "venice-web-search",
      parameters: { token: "ETH" },
      result: { price: 2000 },
      duration_ms: 1500,
      error: undefined,
    };
    expect(AgentLogEntrySchema.safeParse(full).success).toBe(true);
  });

  it("does not require success field", () => {
    const entry = {
      timestamp: "2026-03-15T00:00:00.000Z",
      sequence: 0,
      action: "test",
      success: true,
    };
    const result = AgentLogEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("success" in result.data).toBe(false);
    }
  });
});

describe("AgentStateResponseSchema", () => {
  const valid = {
    cycle: 3,
    running: true,
    ethPrice: 2000,
    drift: 0.02,
    trades: 1,
    totalSpent: 45,
    budgetTier: "normal",
    allocation: { ETH: 0.58, USDC: 0.42 },
    target: { ETH: 0.6, USDC: 0.4 },
    totalValue: 1500,
    feed: [],
    transactions: [],
    audit: null,
  };

  it("accepts valid state response", () => {
    expect(AgentStateResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts state with audit report", () => {
    const withAudit = {
      ...valid,
      audit: {
        allows: ["Trade ETH/USDC"],
        prevents: ["Overspend"],
        worstCase: "Max loss: $200",
        warnings: [],
      },
    };
    expect(AgentStateResponseSchema.safeParse(withAudit).success).toBe(true);
  });

  it("accepts state with transactions and feed", () => {
    const withData = {
      ...valid,
      transactions: [
        {
          txHash: "0xabc",
          sellToken: "ETH",
          buyToken: "USDC",
          sellAmount: "0.1",
          status: "confirmed",
          timestamp: "2026-03-15T00:00:00.000Z",
        },
      ],
      feed: [
        {
          timestamp: "2026-03-15T00:00:00.000Z",
          sequence: 0,
          action: "agent_start",
        },
      ],
    };
    expect(AgentStateResponseSchema.safeParse(withData).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { cycle: _, ...partial } = valid;
    expect(AgentStateResponseSchema.safeParse(partial).success).toBe(false);
  });
});

describe("DeployResponseSchema", () => {
  const valid = {
    parsed: {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    },
    audit: null,
  };

  it("accepts valid deploy response", () => {
    expect(DeployResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts response with audit", () => {
    const withAudit = {
      ...valid,
      audit: {
        allows: ["Trade"],
        prevents: ["Overspend"],
        worstCase: "Max loss: $200",
        warnings: [],
      },
    };
    expect(DeployResponseSchema.safeParse(withAudit).success).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/common test`
Expected: FAIL — cannot resolve `../schemas.js`

**Step 3: Write `packages/common/src/schemas.ts`**

```typescript
import { z } from "zod";

// ---------------------------------------------------------------------------
// ParsedIntent — what the LLM produces after parsing a natural language intent.
// Used in deploy responses and agent config.
// ---------------------------------------------------------------------------

export const ParsedIntentSchema = z.object({
  targetAllocation: z
    .record(z.string(), z.number())
    .describe(
      "Target allocation as token symbol to percentage (0-1). e.g. { ETH: 0.6, USDC: 0.4 }",
    ),
  dailyBudgetUsd: z
    .number()
    .describe("Maximum USD value of trades per day"),
  timeWindowDays: z
    .number()
    .describe("How many days the delegation should last"),
  maxTradesPerDay: z
    .number()
    .describe("Maximum number of trades per day"),
  maxSlippage: z
    .number()
    .describe("Maximum slippage as decimal, e.g. 0.005 for 0.5%"),
  driftThreshold: z
    .number()
    .describe(
      "Minimum allocation drift to trigger rebalance, e.g. 0.05 for 5%",
    ),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

// ---------------------------------------------------------------------------
// SwapRecord — a single executed swap, shown in transaction history.
// ---------------------------------------------------------------------------

export const SwapRecordSchema = z.object({
  txHash: z.string(),
  sellToken: z.string(),
  buyToken: z.string(),
  sellAmount: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

export type SwapRecord = z.infer<typeof SwapRecordSchema>;

// ---------------------------------------------------------------------------
// AuditReport — the API-surface subset of the delegation audit.
// The agent's internal AuditReport has additional fields (intentMatch, formatted)
// that are stripped by the server before sending to the dashboard.
// ---------------------------------------------------------------------------

export const AuditReportSchema = z.object({
  allows: z.array(z.string()),
  prevents: z.array(z.string()),
  worstCase: z.string(),
  warnings: z.array(z.string()),
});

export type AuditReport = z.infer<typeof AuditReportSchema>;

// ---------------------------------------------------------------------------
// AgentLogEntry — a single line from agent_log.jsonl.
// Canonical form: timestamp/sequence/action required, everything else optional.
// This matches what logAction() actually writes.
// ---------------------------------------------------------------------------

export const AgentLogEntrySchema = z.object({
  timestamp: z.string(),
  sequence: z.number(),
  action: z.string(),
  tool: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  duration_ms: z.number().optional(),
  error: z.string().optional(),
});

export type AgentLogEntry = z.infer<typeof AgentLogEntrySchema>;

// ---------------------------------------------------------------------------
// AgentStateResponse — GET /api/state response shape.
// ---------------------------------------------------------------------------

export const AgentStateResponseSchema = z.object({
  cycle: z.number(),
  running: z.boolean(),
  ethPrice: z.number(),
  drift: z.number(),
  trades: z.number(),
  totalSpent: z.number(),
  budgetTier: z.string(),
  allocation: z.record(z.string(), z.number()),
  target: z.record(z.string(), z.number()),
  totalValue: z.number(),
  feed: z.array(AgentLogEntrySchema),
  transactions: z.array(SwapRecordSchema),
  audit: AuditReportSchema.nullable(),
});

export type AgentStateResponse = z.infer<typeof AgentStateResponseSchema>;

// ---------------------------------------------------------------------------
// DeployResponse — POST /api/deploy response shape.
// ---------------------------------------------------------------------------

export const DeployResponseSchema = z.object({
  parsed: ParsedIntentSchema,
  audit: AuditReportSchema.nullable(),
});

export type DeployResponse = z.infer<typeof DeployResponseSchema>;
```

**Step 4: Export from barrel**

Update `packages/common/src/index.ts`:

```typescript
export {
  ParsedIntentSchema,
  type ParsedIntent,
  SwapRecordSchema,
  type SwapRecord,
  AuditReportSchema,
  type AuditReport,
  AgentLogEntrySchema,
  type AgentLogEntry,
  AgentStateResponseSchema,
  type AgentStateResponse,
  DeployResponseSchema,
  type DeployResponse,
} from "./schemas.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @veil/common test`
Expected: All pass

**Step 6: Build**

Run: `pnpm --filter @veil/common build`
Expected: Compiles cleanly

**Step 7: Commit**

```
feat(common): add Zod schemas for API contract types
```

---

## Task 3: Implement constants (TDD)

**Files:**
- Create: `packages/common/src/constants.ts`
- Create: `packages/common/src/__tests__/constants.test.ts`
- Modify: `packages/common/src/index.ts`

**Step 1: Write the failing tests**

Create `packages/common/src/__tests__/constants.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS } from "../constants.js";

describe("constants", () => {
  it("AGENT_ADDRESS is a valid 0x address", () => {
    expect(AGENT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("DEFAULT_AGENT_PORT is 3147", () => {
    expect(DEFAULT_AGENT_PORT).toBe(3147);
  });

  it("API_PATHS has state and deploy paths", () => {
    expect(API_PATHS.state).toBe("/api/state");
    expect(API_PATHS.deploy).toBe("/api/deploy");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/common test`
Expected: FAIL — cannot resolve `../constants.js`

**Step 3: Write `packages/common/src/constants.ts`**

```typescript
export const AGENT_ADDRESS = "0xf13021F02E23a8113C1bD826575a1682F6Fac927";

export const DEFAULT_AGENT_PORT = 3147;

export const API_PATHS = {
  state: "/api/state",
  deploy: "/api/deploy",
} as const;
```

**Step 4: Add to barrel**

Append to `packages/common/src/index.ts`:

```typescript
export { AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS } from "./constants.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @veil/common test`
Expected: All pass

**Step 6: Commit**

```
feat(common): add shared constants (address, port, API paths)
```

---

## Task 4: Implement formatting utilities (TDD)

**Files:**
- Create: `packages/common/src/format.ts`
- Create: `packages/common/src/__tests__/format.test.ts`
- Modify: `packages/common/src/index.ts`

**Step 1: Write the failing tests**

Create `packages/common/src/__tests__/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  truncateAddress,
  truncateHash,
  formatCurrency,
  formatTimestamp,
  formatPercentage,
} from "../format.js";

describe("truncateAddress", () => {
  it("truncates a full address", () => {
    expect(truncateAddress("0xf13021F02E23a8113C1bD826575a1682F6Fac927")).toBe(
      "0xf130...c927",
    );
  });

  it("returns short strings unchanged", () => {
    expect(truncateAddress("0xabc")).toBe("0xabc");
  });

  it("returns empty string unchanged", () => {
    expect(truncateAddress("")).toBe("");
  });
});

describe("truncateHash", () => {
  it("truncates a full tx hash", () => {
    expect(truncateHash("0xabcdef1234567890abcdef")).toBe("0xabcd...cdef");
  });

  it("returns short strings unchanged", () => {
    expect(truncateHash("0xabc")).toBe("0xabc");
  });
});

describe("formatCurrency", () => {
  it("formats positive numbers as USD", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats decimals", () => {
    expect(formatCurrency(45.5)).toBe("$45.50");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });
});

describe("formatTimestamp", () => {
  it("formats recent timestamps as seconds ago", () => {
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10_000).toISOString();
    expect(formatTimestamp(tenSecondsAgo)).toBe("10s ago");
  });

  it("formats minutes ago", () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatTimestamp(fiveMinAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
    expect(formatTimestamp(twoHoursAgo)).toBe("2h ago");
  });

  it("formats days ago", () => {
    const now = new Date();
    const threeDaysAgo = new Date(
      now.getTime() - 3 * 86400_000,
    ).toISOString();
    expect(formatTimestamp(threeDaysAgo)).toBe("3d ago");
  });
});

describe("formatPercentage", () => {
  it("formats decimal as percentage with default 1 decimal", () => {
    expect(formatPercentage(0.058)).toBe("5.8%");
  });

  it("formats with custom decimals", () => {
    expect(formatPercentage(0.058, 2)).toBe("5.80%");
  });

  it("formats zero", () => {
    expect(formatPercentage(0)).toBe("0.0%");
  });

  it("formats with 0 decimals", () => {
    expect(formatPercentage(0.6, 0)).toBe("60%");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/common test`
Expected: FAIL — cannot resolve `../format.js`

**Step 3: Write `packages/common/src/format.ts`**

```typescript
export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function truncateHash(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatPercentage(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
```

**Step 4: Add to barrel**

Append to `packages/common/src/index.ts`:

```typescript
export {
  truncateAddress,
  truncateHash,
  formatCurrency,
  formatTimestamp,
  formatPercentage,
} from "./format.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @veil/common test`
Expected: All pass

**Step 6: Commit**

```
feat(common): add formatting utilities
```

---

## Task 5: Implement token metadata (TDD)

**Files:**
- Create: `packages/common/src/tokens.ts`
- Create: `packages/common/src/__tests__/tokens.test.ts`
- Modify: `packages/common/src/index.ts`

**Step 1: Write the failing tests**

Create `packages/common/src/__tests__/tokens.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  TOKEN_META,
  getTokenBg,
  getTokenLabelColor,
  getTokenLabel,
} from "../tokens.js";

describe("TOKEN_META", () => {
  it("has entries for ETH, WETH, and USDC", () => {
    expect(TOKEN_META.ETH).toBeDefined();
    expect(TOKEN_META.WETH).toBeDefined();
    expect(TOKEN_META.USDC).toBeDefined();
  });

  it("ETH and WETH share the same bg color", () => {
    expect(TOKEN_META.ETH.bg).toBe(TOKEN_META.WETH.bg);
  });
});

describe("getTokenBg", () => {
  it("returns emerald for ETH", () => {
    expect(getTokenBg("ETH")).toBe("bg-emerald-500");
  });

  it("is case-insensitive", () => {
    expect(getTokenBg("eth")).toBe("bg-emerald-500");
    expect(getTokenBg("Usdc")).toBe("bg-indigo-500");
  });

  it("returns fallback for unknown tokens", () => {
    expect(getTokenBg("DOGE")).toBe("bg-zinc-500");
  });
});

describe("getTokenLabelColor", () => {
  it("returns emerald for ETH", () => {
    expect(getTokenLabelColor("ETH")).toBe("text-emerald-400");
  });

  it("returns indigo for USDC", () => {
    expect(getTokenLabelColor("USDC")).toBe("text-indigo-400");
  });

  it("is case-insensitive", () => {
    expect(getTokenLabelColor("weth")).toBe("text-emerald-400");
  });

  it("returns fallback for unknown tokens", () => {
    expect(getTokenLabelColor("DOGE")).toBe("text-zinc-400");
  });
});

describe("getTokenLabel", () => {
  it("returns display label for known tokens", () => {
    expect(getTokenLabel("ETH")).toBe("ETH");
    expect(getTokenLabel("WETH")).toBe("WETH");
    expect(getTokenLabel("USDC")).toBe("USDC");
  });

  it("is case-insensitive", () => {
    expect(getTokenLabel("eth")).toBe("ETH");
  });

  it("returns uppercased input for unknown tokens", () => {
    expect(getTokenLabel("doge")).toBe("DOGE");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @veil/common test`
Expected: FAIL — cannot resolve `../tokens.js`

**Step 3: Write `packages/common/src/tokens.ts`**

```typescript
interface TokenMeta {
  bg: string;
  labelColor: string;
  label: string;
}

export const TOKEN_META: Record<string, TokenMeta> = {
  ETH: { bg: "bg-emerald-500", labelColor: "text-emerald-400", label: "ETH" },
  WETH: { bg: "bg-emerald-500", labelColor: "text-emerald-400", label: "WETH" },
  USDC: { bg: "bg-indigo-500", labelColor: "text-indigo-400", label: "USDC" },
};

export function getTokenBg(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.bg ?? "bg-zinc-500";
}

export function getTokenLabelColor(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.labelColor ?? "text-zinc-400";
}

export function getTokenLabel(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.label ?? token.toUpperCase();
}
```

**Step 4: Add to barrel**

Append to `packages/common/src/index.ts`:

```typescript
export {
  TOKEN_META,
  getTokenBg,
  getTokenLabelColor,
  getTokenLabel,
} from "./tokens.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @veil/common test`
Expected: All pass

**Step 6: Build the full package**

Run: `pnpm --filter @veil/common build`
Expected: Compiles cleanly

**Step 7: Commit**

```
feat(common): add token metadata with unified color/label lookups
```

---

## Task 6: Migrate `packages/agent` — types

**Files:**
- Modify: `packages/agent/package.json` — add `@veil/common` dependency
- Modify: `packages/agent/src/types.ts` — remove dead code
- Modify: `packages/agent/src/agent-loop.ts:64-71` — delete `SwapRecord`, import from common
- Modify: `packages/agent/src/logging/agent-log.ts:14-23` — delete `AgentLogEntry`, import from common
- Modify: `packages/agent/src/venice/schemas.ts:49-74` — delete `IntentParseSchema` + `IntentParse`, import from common

**Step 1: Add `@veil/common` dependency to agent**

In `packages/agent/package.json`, add to `dependencies`:

```json
"@veil/common": "workspace:*"
```

Run: `pnpm install`

**Step 2: Clean up `types.ts` — remove dead exports**

Replace `packages/agent/src/types.ts` with only the live export:

```typescript
/**
 * Core domain types consumed only within the agent package.
 *
 * @module @veil/agent/types
 */
import type { Address } from "viem";

export interface PortfolioState {
  address: Address;
  balances: Record<string, { raw: bigint; formatted: string; usdValue: number }>;
  totalUsdValue: number;
  allocation: Record<string, number>;
  drift: Record<string, number>;
  maxDrift: number;
  timestamp: number;
}
```

**Step 3: Migrate `agent-loop.ts` — delete `SwapRecord`, import from common**

In `packages/agent/src/agent-loop.ts`:
- Add import: `import type { SwapRecord } from "@veil/common";`
- Delete lines 64-71 (the `SwapRecord` interface)

**Step 4: Migrate `logging/agent-log.ts` — delete local `AgentLogEntry`, import from common**

In `packages/agent/src/logging/agent-log.ts`:
- Add import: `import type { AgentLogEntry } from "@veil/common";`
- Delete lines 14-23 (the local `AgentLogEntry` interface)

**Step 5: Migrate `venice/schemas.ts` — delete `IntentParseSchema` + `IntentParse`, import from common**

In `packages/agent/src/venice/schemas.ts`:
- Add import: `import { ParsedIntentSchema } from "@veil/common";`
- Add re-export: `export { ParsedIntentSchema };`
- Add type re-export: `export type { ParsedIntent } from "@veil/common";`
- Delete lines 49-74 (the `IntentParseSchema` definition and `IntentParse` type)
- Note: Keep using `IntentParse` name locally via the re-export. All existing imports of `IntentParse` from `./venice/schemas.js` will continue to work.

Also add a type alias so existing code that imports `IntentParse` doesn't break:

```typescript
import { ParsedIntentSchema, type ParsedIntent } from "@veil/common";
// Re-export under both names for backwards compatibility within the agent
export { ParsedIntentSchema };
export type { ParsedIntent };
export type IntentParse = ParsedIntent;
```

**Step 6: Update server.ts — import AgentLogEntry from common**

In `packages/agent/src/server.ts`, change line 16:
- From: `import type { AgentLogEntry } from "./logging/agent-log.js";`
- To: `import type { AgentLogEntry } from "@veil/common";`

**Step 7: Run agent build and tests**

Run: `pnpm --filter @veil/common build`
Run: `pnpm --filter @veil/agent build`
Expected: Both compile cleanly

Run: `pnpm --filter @veil/agent test`
Expected: All existing tests pass

**Step 8: Commit**

```
refactor(agent): import shared types from @veil/common

- Delete dead exports from types.ts (Intent, RebalanceDecision, AgentLogEntry, DelegationConfig)
- Import SwapRecord, AgentLogEntry, ParsedIntent from @veil/common
- Re-export IntentParse as alias for ParsedIntent for internal compatibility
```

---

## Task 7: Migrate `packages/agent` — constants and server typing

**Files:**
- Modify: `packages/agent/src/server.ts` — use common constants, type responses

**Step 1: Import common constants in server.ts**

In `packages/agent/src/server.ts`:
- Add import: `import { DEFAULT_AGENT_PORT, API_PATHS, type AgentStateResponse, type DeployResponse } from "@veil/common";`
- Change line 18 from: `const PORT = process.env.PORT ? Number(process.env.PORT) : 3147;`
  - To: `const PORT = process.env.PORT ? Number(process.env.PORT) : DEFAULT_AGENT_PORT;`

**Step 2: Type the handleState response for compile-time safety**

In `handleState`, add a type annotation to the response objects. Change the two `sendJson` calls to use a typed variable:

For the null/no-config path (lines 149-163), change to:

```typescript
const defaultState: AgentStateResponse = {
  cycle: 0,
  running: false,
  ethPrice: 0,
  drift: 0,
  trades: 0,
  totalSpent: 0,
  budgetTier: "normal",
  allocation: {},
  target: {},
  totalValue: 0,
  feed: readLogFeed(),
  transactions: [],
  audit: null,
};
sendJson(res, defaultState);
```

For the active state path (lines 167-188), change to:

```typescript
const response: AgentStateResponse = {
  cycle: state.cycle,
  running: state.running,
  ethPrice: state.ethPrice,
  drift: state.drift,
  trades: state.tradesExecuted,
  totalSpent: state.totalSpentUsd,
  budgetTier: state.budgetTier,
  allocation: state.allocation,
  target: config.intent.targetAllocation,
  totalValue: state.totalValue,
  feed: readLogFeed(),
  transactions: state.transactions,
  audit: state.audit
    ? {
        allows: state.audit.allows,
        prevents: state.audit.prevents,
        worstCase: state.audit.worstCase,
        warnings: state.audit.warnings,
      }
    : null,
};
sendJson(res, response);
```

**Step 3: Type the handleDeploy response**

In `handleDeploy`, type the success response (lines 126-136):

```typescript
const deployResponse: DeployResponse = {
  parsed,
  audit: state?.audit
    ? {
        allows: state.audit.allows,
        prevents: state.audit.prevents,
        worstCase: state.audit.worstCase,
        warnings: state.audit.warnings,
      }
    : null,
};
sendJson(res, deployResponse);
```

**Step 4: Use API_PATHS in route matching**

In the server's request handler (lines 255-258), change:
- `url === "/api/deploy"` to `url === API_PATHS.deploy`
- `url === "/api/state"` to `url === API_PATHS.state`

**Step 5: Build and test**

Run: `pnpm --filter @veil/agent build`
Expected: Compiles cleanly — type errors here mean the API contract has drifted

Run: `pnpm --filter @veil/agent test`
Expected: All tests pass

**Step 6: Commit**

```
refactor(agent): use @veil/common constants and typed API responses

Server response objects now have compile-time type checking against
the shared AgentStateResponse and DeployResponse schemas.
```

---

## Task 8: Migrate `apps/dashboard` — types and API

**Files:**
- Modify: `apps/dashboard/package.json` — add `@veil/common` dependency
- Delete: `apps/dashboard/lib/types.ts`
- Modify: `apps/dashboard/lib/api.ts`
- Modify: `apps/dashboard/lib/api.test.ts`
- Modify: `apps/dashboard/hooks/use-agent-state.ts`
- Modify: `apps/dashboard/hooks/use-deploy.ts`

**Step 1: Add `@veil/common` dependency to dashboard**

In `apps/dashboard/package.json`, add to `dependencies`:

```json
"@veil/common": "workspace:*"
```

Run: `pnpm install`

**Step 2: Update `lib/api.ts` — import from common**

Replace `apps/dashboard/lib/api.ts`:

```typescript
/**
 * Client-side fetch wrappers for /api/state and /api/deploy endpoints.
 *
 * @module @veil/dashboard/lib/api
 */
import type { AgentStateResponse, DeployResponse } from "@veil/common";

export async function fetchAgentState(): Promise<AgentStateResponse> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`Failed to fetch state: ${res.status}`);
  return res.json();
}

export async function deployAgent(intent: string): Promise<DeployResponse> {
  const res = await fetch("/api/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `Deploy failed: ${res.status}`);
  }
  return res.json();
}
```

**Step 3: Update `hooks/use-agent-state.ts` — import from common**

Change line 10:
- From: `import type { AgentStateResponse } from "@/lib/types";`
- To: `import type { AgentStateResponse } from "@veil/common";`

**Step 4: Update `hooks/use-deploy.ts` — import from common**

Change line 11:
- From: `import type { DeployResponse } from "@/lib/types";`
- To: `import type { DeployResponse } from "@veil/common";`

**Step 5: Delete `apps/dashboard/lib/types.ts`**

Remove the file entirely. All types now come from `@veil/common`.

**Step 6: Update any remaining imports of `@/lib/types`**

Search for any other files importing from `@/lib/types` and update them:
- `components/monitor.tsx` line 14: change `import type { AgentLogEntry, SwapRecord } from "@/lib/types"` to `import type { AgentLogEntry, SwapRecord } from "@veil/common"`
- `components/audit.tsx` line 10: change `import type { DeployResponse } from "@/lib/types"` to `import type { DeployResponse } from "@veil/common"`

**Step 7: Build and test**

Run: `pnpm --filter @veil/common build`
Run: `pnpm --filter @veil/dashboard build`
Expected: Compiles cleanly

Run: `pnpm --filter @veil/dashboard test`
Expected: All vitest tests pass

**Step 8: Commit**

```
refactor(dashboard): import all types from @veil/common

Delete lib/types.ts — single source of truth is now @veil/common.
```

---

## Task 9: Migrate `apps/dashboard` — utilities, constants, token metadata

**Files:**
- Modify: `apps/dashboard/components/monitor.tsx`
- Modify: `apps/dashboard/components/audit.tsx`
- Modify: `apps/dashboard/app/api/state/route.ts`
- Modify: `apps/dashboard/app/api/deploy/route.ts`

**Step 1: Migrate `monitor.tsx` — replace local utilities**

In `apps/dashboard/components/monitor.tsx`:

Replace the import and local definitions (lines 14-71) with:

```typescript
import type { AgentLogEntry, SwapRecord } from "@veil/common";
import {
  AGENT_ADDRESS,
  truncateHash,
  truncateAddress,
  formatCurrency,
  formatTimestamp,
  getTokenBg,
  getTokenLabel,
} from "@veil/common";
```

Delete these local definitions:
- `const AGENT_ADDRESS = ...` (line 16)
- `const TOKEN_COLORS = ...` (lines 18-22)
- `function getTokenColor(...)` (lines 24-26)
- `function getTokenLabel(...)` (lines 28-30) — now imported
- `function truncateHash(...)` (lines 32-35)
- `function truncateAddress(...)` (lines 37-40)
- `function formatCurrency(...)` (lines 42-49)
- `function formatTimestamp(...)` (lines 51-65)

Then update all references in the component:
- `getTokenColor(token)` -> `getTokenBg(token)`
- The rest (`truncateHash`, `truncateAddress`, `formatCurrency`, `formatTimestamp`, `getTokenLabel`, `AGENT_ADDRESS`) keep the same names.

**Step 2: Migrate `audit.tsx` — replace local token colors**

In `apps/dashboard/components/audit.tsx`:

Replace the import and local definitions (lines 10-35) with:

```typescript
import type { DeployResponse } from "@veil/common";
import { getTokenBg, getTokenLabelColor } from "@veil/common";
```

Delete these local definitions:
- `const TOKEN_COLORS = ...` (lines 17-21)
- `const TOKEN_LABEL_COLORS = ...` (lines 23-27)
- `function getTokenColor(...)` (lines 29-31)
- `function getTokenLabelColor(...)` (lines 33-35) — now imported

Update all references:
- `getTokenColor(token)` -> `getTokenBg(token)`
- `getTokenLabelColor(token)` keeps the same name

**Step 3: Migrate proxy routes — use shared constants**

In `apps/dashboard/app/api/state/route.ts`, replace:

```typescript
import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.state}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Agent server unreachable" },
      { status: 502 },
    );
  }
}
```

In `apps/dashboard/app/api/deploy/route.ts`, replace:

```typescript
import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.deploy}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Agent server unreachable" },
      { status: 502 },
    );
  }
}
```

**Step 4: Build and test**

Run: `pnpm --filter @veil/common build`
Run: `pnpm --filter @veil/dashboard build`
Expected: Compiles cleanly

Run: `pnpm --filter @veil/dashboard test`
Expected: All vitest tests pass

**Step 5: Commit**

```
refactor(dashboard): use @veil/common utilities, constants, and token metadata

- Replace local formatting functions with @veil/common imports
- Unify TOKEN_COLORS into shared TOKEN_META (consistent fallbacks, case normalization)
- Use shared AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS constants
```

---

## Task 10: Full verification

**Step 1: Full monorepo build**

Run: `turbo run build`
Expected: All 3 packages build in order: common -> agent + dashboard

**Step 2: Full test suite**

Run: `turbo run test`
Expected: All unit tests pass across all packages

**Step 3: Dashboard e2e tests**

Run: `pnpm --filter @veil/dashboard test:e2e`
Expected: All Playwright tests pass

**Step 4: Lint**

Run: `pnpm run lint`
Expected: No lint errors

**Step 5: Verify no remaining duplicates**

Run: `grep -r "interface AgentLogEntry" packages/ apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v .claude/worktrees`
Expected: Only `packages/common/src/schemas.ts`

Run: `grep -r "interface SwapRecord" packages/ apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v .claude/worktrees`
Expected: Only `packages/common/src/schemas.ts` (as Zod-inferred, not interface — actually 0 results since it's `z.object` not `interface`)

Run: `grep -r "TOKEN_COLORS" apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v .claude/worktrees`
Expected: 0 results

Run: `grep -rn "success.*boolean" packages/common/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v test`
Expected: 0 results (no `success` field in AgentLogEntry schema)

**Step 6: Verify types.ts cleanup**

Run: `grep -c "export" packages/agent/src/types.ts`
Expected: 1 (only `PortfolioState`)

**Step 7: Commit**

```
chore: verify @veil/common migration — all builds and tests pass
```

---

## Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update project structure section**

Add `packages/common/` to the project structure:

```
packages/common/    Shared types, constants, and utilities
packages/agent/     Backend — agent loop, API server, all integrations
apps/dashboard/     Frontend — Next.js dashboard (Configure, Audit, Monitor)
```

**Step 2: Add note about shared types**

Add a bullet to Key Technical Decisions:

```
- **Shared types**: `@veil/common` is the single source of truth for API contract types (Zod schemas + derived types), shared constants, and formatting utilities. Both `packages/agent` and `apps/dashboard` import from common — never define duplicate type interfaces.
```

**Step 3: Commit**

```
docs: update CLAUDE.md with @veil/common package
```
