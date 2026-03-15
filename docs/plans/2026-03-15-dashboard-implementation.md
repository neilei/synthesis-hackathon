# Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js 15 dashboard with three tabbed screens (Configure, Audit, Monitor) that connects to the Veil agent API server.

**Architecture:** Next.js App Router at `apps/dashboard/`, proxies API calls through Next.js route handlers to the agent server at `localhost:3147`. Client-side polling for live data. Modern dark finance UI with Tailwind CSS v4. Playwright e2e tests.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, Recharts, Playwright, Vitest, Storybook

**Design doc:** `docs/plans/2026-03-15-dashboard-design.md`

**Impeccable skills:** Use `teach-impeccable` before first component, `frontend-design` for each screen, `polish`/`audit`/`critique`/`adapt`/`delight` in final passes.

---

### Task 1: Scaffold Next.js App

**Files:**
- Replace: `apps/dashboard/package.json`
- Create: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/app/layout.tsx`
- Create: `apps/dashboard/app/page.tsx`
- Create: `apps/dashboard/app/globals.css`
- Modify: `turbo.json` (add Next.js build outputs)
- Modify: `package.json` (add dashboard dev/build scripts)

**Step 1: Create the Next.js app with create-next-app**

```bash
cd /Users/adoll/projects/synthesis-hackathon
rm apps/dashboard/package.json
pnpm create next-app@latest apps/dashboard \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --turbopack \
  --yes
```

**Step 2: Clean up generated files**

Remove default page content, favicon, etc. Keep layout.tsx and globals.css shells.

**Step 3: Update `apps/dashboard/package.json`**

Set package name to `@veil/dashboard`. Add recharts dependency:

```bash
cd apps/dashboard
pnpm add recharts
pnpm add -D @playwright/test @storybook/react @storybook/nextjs vitest @testing-library/react @testing-library/dom jsdom
```

**Step 4: Update `apps/dashboard/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: undefined, // Full Next.js (not static export) for Vercel + API routes
};

export default nextConfig;
```

**Step 5: Configure Tailwind v4 with design tokens**

Tailwind v4 uses CSS-first configuration. Update `apps/dashboard/app/globals.css`:

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains-mono);

  --color-bg-primary: #09090b;
  --color-bg-surface: #18181b;
  --color-border: #27272a;
  --color-border-subtle: #1f1f23;
  --color-text-primary: #fafafa;
  --color-text-secondary: #a1a1aa;
  --color-accent-positive: #10b981;
  --color-accent-secondary: #6366f1;
  --color-accent-danger: #ef4444;
  --color-accent-warning: #f59e0b;
}
```

**Step 6: Configure fonts in `apps/dashboard/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Veil — Intent-Compiled Private DeFi Agent",
  description: "Autonomous portfolio rebalancing with on-chain delegation constraints",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-bg-primary text-text-primary min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
```

**Step 7: Minimal page.tsx**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold tracking-wider text-accent-positive">
        VEIL
      </h1>
    </main>
  );
}
```

**Step 8: Update turbo.json — add `.next/**` to build outputs**

```json
"build": {
  "dependsOn": ["^build"],
  "outputs": ["dist/**", ".next/**"]
}
```

**Step 9: Add dashboard scripts to root package.json**

Add these scripts:
- `"dev:dashboard": "pnpm --filter @veil/dashboard dev"`
- `"build:dashboard": "pnpm --filter @veil/dashboard build"`

**Step 10: Verify**

```bash
cd /Users/adoll/projects/synthesis-hackathon
pnpm install
pnpm run dev:dashboard
```

Expected: Next.js dev server starts on port 3000. Browser shows "VEIL" in emerald green on dark background.

**Step 11: Commit**

```
feat(dashboard): scaffold Next.js 15 app with Tailwind v4 design tokens
```

---

### Task 2: Types + API Layer

**Files:**
- Create: `apps/dashboard/lib/types.ts`
- Create: `apps/dashboard/lib/api.ts`
- Create: `apps/dashboard/app/api/state/route.ts`
- Create: `apps/dashboard/app/api/deploy/route.ts`

**Step 1: Create TypeScript types matching agent API response**

`apps/dashboard/lib/types.ts`:

```typescript
export interface AgentStateResponse {
  cycle: number;
  running: boolean;
  ethPrice: number;
  drift: number;
  trades: number;
  totalSpent: number;
  budgetTier: string;
  allocation: Record<string, number>;
  target: Record<string, number>;
  totalValue: number;
  feed: AgentLogEntry[];
  transactions: SwapRecord[];
  audit: AuditReport | null;
}

export interface SwapRecord {
  txHash: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  status: string;
  timestamp: string;
}

export interface AuditReport {
  allows: string[];
  prevents: string[];
  worstCase: string;
  warnings: string[];
}

export interface AgentLogEntry {
  timestamp: string;
  sequence: number;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  error?: string;
}

export interface DeployRequest {
  intent: string;
}

export interface DeployResponse {
  parsed: {
    targetAllocation: Record<string, number>;
    dailyBudgetUsd: number;
    timeWindowDays: number;
    maxTradesPerDay: number;
    maxSlippage: number;
    driftThreshold: number;
  };
  audit: AuditReport | null;
}

export interface ApiError {
  error: string;
}
```

**Step 2: Create fetch helpers**

`apps/dashboard/lib/api.ts`:

```typescript
import type { AgentStateResponse, DeployResponse } from "./types";

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

**Step 3: Create API proxy route for state**

`apps/dashboard/app/api/state/route.ts`:

```typescript
const AGENT_API_URL = process.env.AGENT_API_URL || "http://localhost:3147";

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API_URL}/api/state`, {
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

**Step 4: Create API proxy route for deploy**

`apps/dashboard/app/api/deploy/route.ts`:

```typescript
const AGENT_API_URL = process.env.AGENT_API_URL || "http://localhost:3147";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${AGENT_API_URL}/api/deploy`, {
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

**Step 5: Verify**

```bash
# Start agent server in one terminal
pnpm run serve &

# In another terminal, test the proxy
curl http://localhost:3000/api/state
```

Expected: Returns the agent state JSON proxied through Next.js.

**Step 6: Commit**

```
feat(dashboard): add API types, fetch helpers, and proxy routes
```

---

### Task 3: Hooks (useAgentState, useDeploy)

**Files:**
- Create: `apps/dashboard/hooks/use-agent-state.ts`
- Create: `apps/dashboard/hooks/use-deploy.ts`

**Step 1: Create useAgentState polling hook**

`apps/dashboard/hooks/use-agent-state.ts`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAgentState } from "@/lib/api";
import type { AgentStateResponse } from "@/lib/types";

export function useAgentState(enabled: boolean, intervalMs = 5000) {
  const [data, setData] = useState<AgentStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchAgentState();
      setData(state);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [enabled, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
```

**Step 2: Create useDeploy mutation hook**

`apps/dashboard/hooks/use-deploy.ts`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { deployAgent } from "@/lib/api";
import type { DeployResponse } from "@/lib/types";

export function useDeploy() {
  const [data, setData] = useState<DeployResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const deploy = useCallback(async (intent: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await deployAgent(intent);
      setData(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, error, loading, deploy };
}
```

**Step 3: Commit**

```
feat(dashboard): add useAgentState polling hook and useDeploy mutation hook
```

---

### Task 4: Shared Components (tabs, stats-card, sponsor-badge, skeleton)

**Files:**
- Create: `apps/dashboard/components/tabs.tsx`
- Create: `apps/dashboard/components/stats-card.tsx`
- Create: `apps/dashboard/components/sponsor-badge.tsx`
- Create: `apps/dashboard/components/skeleton.tsx`
- Create: `apps/dashboard/components/error-banner.tsx`

**Step 1: Run `teach-impeccable` skill to establish design context**

Invoke the `teach-impeccable` skill before writing any UI components. This establishes persistent design guidelines for the Veil project.

**Step 2: Build tabs component**

`apps/dashboard/components/tabs.tsx` — horizontal tab bar with Configure, Audit, Monitor. Active tab has emerald underline. Disabled tabs (Audit/Monitor before deploy) are dimmed.

Props: `activeTab`, `onTabChange`, `agentRunning` (to enable/disable Monitor tab).

**Step 3: Build stats-card component**

`apps/dashboard/components/stats-card.tsx` — a card showing a label + value + optional trend indicator. Uses `font-mono` for the value. Supports loading (skeleton) and error ("--") states.

**Step 4: Build sponsor-badge component**

`apps/dashboard/components/sponsor-badge.tsx` — small pill badge: icon + "Powered by X" text. Props: `sponsor` (venice | metamask | uniswap | protocol-labs), `variant` (inline | footer).

**Step 5: Build skeleton component**

`apps/dashboard/components/skeleton.tsx` — reusable animated skeleton primitives: `SkeletonLine`, `SkeletonCard`, `SkeletonTable`. Pulse animation on zinc-800/zinc-700.

**Step 6: Build error-banner component**

`apps/dashboard/components/error-banner.tsx` — full-width red/amber banner with error message and optional retry button.

**Step 7: Invoke `frontend-design` skill for each component**

Use the `frontend-design` skill to generate high-quality implementations of each component listed above.

**Step 8: Verify components render**

Import and render each component on page.tsx temporarily to verify they display correctly.

**Step 9: Commit**

```
feat(dashboard): add shared UI components (tabs, stats-card, sponsor-badge, skeleton, error-banner)
```

---

### Task 5: Configure Screen

**Files:**
- Create: `apps/dashboard/components/configure.tsx`
- Modify: `apps/dashboard/app/page.tsx`

**Step 1: Invoke `frontend-design` skill for Configure screen**

Use the `frontend-design` skill to build the Configure screen component matching the design doc:
- Centered card layout, max-width 640px
- "VEIL" wordmark + subtitle
- Large textarea with placeholder
- 3 preset pill buttons
- Full-width "Compile & Deploy" button with loading state
- Error display below button

**Step 2: Build Configure component**

`apps/dashboard/components/configure.tsx`:
- Uses `useDeploy` hook
- Textarea controlled by local state
- Preset buttons set textarea value
- Deploy button calls `deploy(intentText)`
- On success: calls `onDeploySuccess(data)` callback (parent switches tab)
- On error: shows error message inline
- Loading state: button shows spinner + "Compiling intent via Venice AI..."

**Step 3: Wire into page.tsx**

Update `apps/dashboard/app/page.tsx` to:
- Manage tab state (`configure` | `audit` | `monitor`)
- Store deploy response data (for audit screen)
- Render tabs + active screen
- On deploy success: store response, switch to `audit` tab

**Step 4: Verify**

```bash
pnpm run dev:dashboard
```

Navigate to localhost:3000. Should see Configure screen with textarea, presets, and deploy button.

**Step 5: Commit**

```
feat(dashboard): add Configure screen with intent input and deploy flow
```

---

### Task 6: Audit Screen

**Files:**
- Create: `apps/dashboard/components/audit.tsx`
- Create: `apps/dashboard/components/intent-bar.tsx`

**Step 1: Invoke `frontend-design` skill for Audit screen**

Use `frontend-design` to build the Audit screen matching the design doc:
- Two-column layout (desktop), stacked (mobile)
- Left: parsed intent card with allocation bar + key-value pairs
- Right: delegation report with ALLOWS/PREVENTS/WORST CASE/WARNINGS
- Sponsor badges for Venice and MetaMask
- Bottom status bar linking to Monitor

**Step 2: Build intent-bar component**

`apps/dashboard/components/intent-bar.tsx` — horizontal stacked bar showing allocation percentages. Each token gets a colored segment with label. Uses CSS widths (no chart library needed).

**Step 3: Build Audit component**

`apps/dashboard/components/audit.tsx`:
- Props: `deployResponse: DeployResponse`
- Left column: IntentBar + key-value grid
- Right column: ALLOWS (green checkmarks), PREVENTS (red x-marks), WORST CASE (amber box), WARNINGS (orange list)
- Venice badge on left, MetaMask badge on right
- "View Monitor" link at bottom

**Step 4: Wire into page.tsx**

Render Audit component when `activeTab === "audit"`, passing `deployResponse`.

**Step 5: Verify**

Deploy an intent on Configure, verify it auto-switches to Audit with populated data.

**Step 6: Commit**

```
feat(dashboard): add Audit screen with delegation report and intent visualization
```

---

### Task 7: Monitor Screen

**Files:**
- Create: `apps/dashboard/components/monitor.tsx`
- Create: `apps/dashboard/components/allocation-chart.tsx`
- Create: `apps/dashboard/components/tx-table.tsx`

**Step 1: Invoke `frontend-design` skill for Monitor screen**

Use `frontend-design` to build the Monitor screen matching the design doc:
- Top: 4 stats cards (portfolio value, drift, trades, budget spent)
- Middle: allocation chart + AI reasoning panel
- Bottom: transaction table
- Status bar with running indicator

**Step 2: Build allocation-chart component**

`apps/dashboard/components/allocation-chart.tsx` — Recharts PieChart (donut) or horizontal stacked bar showing current vs target allocation. Two visual layers: current (solid) and target (outline/ghost).

**Step 3: Build tx-table component**

`apps/dashboard/components/tx-table.tsx` — table of swap transactions. Columns: txHash (linked to etherscan as `https://sepolia.etherscan.io/tx/{hash}`), sellToken, buyToken, amount, status, timestamp. Empty state message when no trades.

**Step 4: Build Monitor component**

`apps/dashboard/components/monitor.tsx`:
- Uses `useAgentState(true)` for polling
- Stats row: 4 StatsCard components
- Middle: AllocationChart + AI reasoning card (latest feed entry with action="rebalance_decision")
- Bottom: TxTable
- Status bar: green/red dot, cycle count, agent address (truncated), chain
- Loading: skeleton cards
- Error: error banner with retry
- Not running: "Agent not deployed" with link to Configure

**Step 5: Wire into page.tsx**

Render Monitor component when `activeTab === "monitor"`.

**Step 6: Verify**

Start agent server (`pnpm run serve`), deploy an intent, switch to Monitor tab. Should show live-updating stats.

**Step 7: Commit**

```
feat(dashboard): add Monitor screen with live stats, allocation chart, and transaction table
```

---

### Task 8: Footer with Sponsor Logos

**Files:**
- Create: `apps/dashboard/components/footer.tsx`
- Modify: `apps/dashboard/app/layout.tsx`

**Step 1: Build footer component**

`apps/dashboard/components/footer.tsx` — bottom bar with sponsor logos: Venice, MetaMask, Uniswap, Protocol Labs. Subtle, small logos with "Built with" prefix. Links to sponsor sites.

**Step 2: Add footer to layout.tsx**

Render footer at the bottom of the body, outside the main content area.

**Step 3: Commit**

```
feat(dashboard): add sponsor logo footer
```

---

### Task 9: Storybook Setup + Stories

**Files:**
- Create: `apps/dashboard/.storybook/main.ts`
- Create: `apps/dashboard/.storybook/preview.ts`
- Create: stories for each component (co-located as `*.stories.tsx`)

**Step 1: Initialize Storybook**

```bash
cd apps/dashboard
pnpm dlx storybook@latest init --builder webpack5
```

Follow prompts. Select React + Next.js framework.

**Step 2: Write stories for each component**

Each component gets a `.stories.tsx` file with variants:
- `tabs.stories.tsx` — default, audit-active, monitor-active, disabled states
- `stats-card.stories.tsx` — default, loading, error, positive trend, negative trend
- `sponsor-badge.stories.tsx` — each sponsor variant
- `configure.stories.tsx` — empty, with text, loading, error
- `audit.stories.tsx` — with full deploy response, with warnings
- `monitor.stories.tsx` — running, not running, loading, error
- `tx-table.stories.tsx` — with data, empty
- `allocation-chart.stories.tsx` — with data, empty

**Step 3: Verify Storybook runs**

```bash
pnpm --filter @veil/dashboard storybook
```

**Step 4: Commit**

```
feat(dashboard): add Storybook setup and component stories
```

---

### Task 10: Playwright E2E Tests

**Files:**
- Create: `apps/dashboard/playwright.config.ts`
- Create: `apps/dashboard/tests/dashboard.spec.ts`
- Create: `apps/dashboard/tests/configure.spec.ts`
- Create: `apps/dashboard/tests/monitor.spec.ts`

**Step 1: Configure Playwright**

`apps/dashboard/playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

**Step 2: Write configure.spec.ts**

Tests:
- Page loads with Configure tab active
- Textarea accepts input
- Preset buttons fill textarea
- Deploy button disabled when textarea empty
- Deploy button enabled when textarea has text
- (Mock API) Deploy shows loading state, then switches to Audit tab

**Step 3: Write dashboard.spec.ts**

Tests:
- Full flow: type intent > deploy > audit renders > switch to monitor
- Tab navigation works
- Tabs are disabled before deploy

**Step 4: Write monitor.spec.ts**

Tests:
- Shows "Agent not deployed" when agent not running
- Shows stats when agent is running (mock API response)
- Transaction links point to etherscan

**Step 5: Install Playwright browsers**

```bash
pnpm --filter @veil/dashboard exec playwright install chromium
```

**Step 6: Run tests**

```bash
pnpm --filter @veil/dashboard exec playwright test
```

**Step 7: Add test scripts to dashboard package.json**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

**Step 8: Commit**

```
feat(dashboard): add Playwright e2e tests for all screens
```

---

### Task 11: Impeccable Design Pass

**Step 1: Invoke `polish` skill**

Run on the entire `apps/dashboard/components/` directory. Fix alignment, spacing, consistency, and detail issues.

**Step 2: Invoke `audit` skill**

Run accessibility, performance, responsive design checks. Fix any issues found.

**Step 3: Invoke `critique` skill**

Evaluate overall design effectiveness. Implement feedback.

**Step 4: Invoke `adapt` skill**

Verify mobile responsive behavior at 375px, 768px, and 1024px breakpoints. Fix layout issues.

**Step 5: Invoke `delight` skill**

Add micro-interactions:
- Tab transition animations (fade or slide)
- Stats card number counting animation
- Deploy button pulse/glow on hover
- Skeleton shimmer animation
- Smooth transitions when data updates

**Step 6: Commit**

```
style(dashboard): impeccable design pass — polish, a11y, responsive, animations
```

---

### Task 12: Integration Test + Final Verify

**Step 1: Start agent server + dashboard together**

```bash
# Terminal 1
pnpm run serve

# Terminal 2
pnpm run dev:dashboard
```

**Step 2: Full manual walkthrough**

1. Open localhost:3000
2. Type "60/40 ETH/USDC, $200/day, 7 days" in Configure
3. Click "Compile & Deploy"
4. Verify Audit screen shows parsed intent + delegation report
5. Click Monitor tab
6. Verify live stats update every 5s
7. Verify transaction table populates after a swap

**Step 3: Run all tests**

```bash
pnpm run build          # Full monorepo build
pnpm run test           # Agent unit tests
pnpm run test:e2e       # Agent e2e tests
pnpm --filter @veil/dashboard exec playwright test  # Dashboard e2e
```

**Step 4: Verify Storybook**

```bash
pnpm --filter @veil/dashboard storybook
```

All stories render without errors.

**Step 5: Run lint**

```bash
pnpm run lint
```

**Step 6: Update CLAUDE.md status**

Update the "Current Status" section to mark Phase 5 (Next.js frontend) as COMPLETE.

**Step 7: Commit**

```
chore: mark dashboard Phase 5 complete, update CLAUDE.md status
```

---

### Dependency Summary

```
Task 1 (Scaffold) --> Task 2 (API Layer) --> Task 3 (Hooks)
                                              |
Task 4 (Shared Components) ----+              |
                                |              |
Task 5 (Configure) <-----------+--------------+
Task 6 (Audit) <---------------+
Task 7 (Monitor) <-------------+
                                |
Task 8 (Footer) <--------------+
Task 9 (Storybook) <-----------+
Task 10 (Playwright) <---------+
                                |
Task 11 (Design Pass) <--------+
Task 12 (Integration) <--------+
```

Tasks 1-3 are sequential. Tasks 4-10 can be parallelized in pairs (4+5, 6+7, 8+9+10). Task 11-12 are sequential and depend on all prior tasks.
