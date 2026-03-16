# Test File Reorganization — `__tests__/` per Module

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all test files in `packages/agent/src/` from colocated (adjacent to source) into `__tests__/` subdirectories per module, so source directories show only production code.

**Architecture:** Every directory that currently contains `.test.ts` or `.e2e.test.ts` files gets a `__tests__/` subdirectory. Tests move there via `git mv`. All relative imports in moved tests are updated (one extra `../` prefix since tests are now one directory deeper). Vitest config stays unchanged — the existing glob `src/**/*.test.ts` already matches nested `__tests__/` paths.

**Tech Stack:** git mv, vitest, TypeScript (ESM with `.js` extensions in imports)

---

## Before / After

```
BEFORE:                              AFTER:
src/                                 src/
  agent-loop.ts                        agent-loop.ts
  agent-loop.test.ts                   config.ts
  config.ts                            server.ts
  config.test.ts                       index.ts
  server.ts                            __tests__/
  server.test.ts                         agent-loop.test.ts
  server.e2e.test.ts                     config.test.ts
  index.ts                              server.test.ts
  data/                                  server.e2e.test.ts
    portfolio.ts                       data/
    portfolio.test.ts                    portfolio.ts
    portfolio.e2e.test.ts                prices.ts
    prices.ts                            thegraph.ts
    prices.test.ts                       queries.graphql
    prices.e2e.test.ts                   __tests__/
    thegraph.ts                            portfolio.test.ts
    thegraph.test.ts                       portfolio.e2e.test.ts
    thegraph.e2e.test.ts                   prices.test.ts
    queries.graphql                        prices.e2e.test.ts
  ...                                     thegraph.test.ts
                                           thegraph.e2e.test.ts
                                     ...
```

## Import Path Rules

When a test moves from `src/foo/bar.test.ts` to `src/foo/__tests__/bar.test.ts`:
- Sibling imports `"./bar.js"` become `"../bar.js"` (one level up)
- Parent imports `"../config.js"` become `"../../config.js"` (one extra level)
- `vi.mock()` string paths follow the same rule
- Package imports (`"viem"`, `"@veil/common"`, etc.) stay unchanged

When a test moves from `src/bar.test.ts` to `src/__tests__/bar.test.ts`:
- Sibling imports `"./bar.js"` become `"../bar.js"`
- Child imports `"./data/foo.js"` become `"../data/foo.js"`
- `vi.mock()` string paths follow the same rule

---

## Task 1: Move root-level test files

**Files:**
- Move: `src/config.test.ts` → `src/__tests__/config.test.ts`
- Move: `src/agent-loop.test.ts` → `src/__tests__/agent-loop.test.ts`
- Move: `src/server.test.ts` → `src/__tests__/server.test.ts`
- Move: `src/server.e2e.test.ts` → `src/__tests__/server.e2e.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/__tests__
git mv src/config.test.ts src/__tests__/
git mv src/agent-loop.test.ts src/__tests__/
git mv src/server.test.ts src/__tests__/
git mv src/server.e2e.test.ts src/__tests__/
```

**Step 2: Update imports in `src/__tests__/config.test.ts`**

All `./` imports become `../`:
```
"./config.js" → "../config.js"
```

**Step 3: Update imports in `src/__tests__/agent-loop.test.ts`**

All `./` imports become `../`:
```
"./agent-loop.js"         → "../agent-loop.js"
"./config.js"             → "../config.js"
"./venice/llm.js"         → "../venice/llm.js"
"./data/portfolio.js"     → "../data/portfolio.js"
"./data/prices.js"        → "../data/prices.js"
"./data/thegraph.js"      → "../data/thegraph.js"
"./delegation/compiler.js"→ "../delegation/compiler.js"
"./delegation/audit.js"   → "../delegation/audit.js"
"./delegation/redeemer.js"→ "../delegation/redeemer.js"
"./uniswap/trading.js"    → "../uniswap/trading.js"
"./logging/agent-log.js"  → "../logging/agent-log.js"
"./logging/budget.js"     → "../logging/budget.js"
"./identity/erc8004.js"   → "../identity/erc8004.js"
"./logging/logger.js"     → "../logging/logger.js"
"./uniswap/permit2.js"    → "../uniswap/permit2.js"
"./utils/retry.js"        → "../utils/retry.js"
```

This applies to both regular imports AND `vi.mock()` path strings.

**Step 4: Update imports in `src/__tests__/server.test.ts`**

All `./` imports become `../`:
```
"./config.js"             → "../config.js"
"./venice/llm.js"         → "../venice/llm.js"
"./data/portfolio.js"     → "../data/portfolio.js"
"./data/prices.js"        → "../data/prices.js"
"./data/thegraph.js"      → "../data/thegraph.js"
"./delegation/compiler.js"→ "../delegation/compiler.js"
"./delegation/audit.js"   → "../delegation/audit.js"
"./delegation/redeemer.js"→ "../delegation/redeemer.js"
"./uniswap/trading.js"    → "../uniswap/trading.js"
"./logging/agent-log.js"  → "../logging/agent-log.js"
"./logging/budget.js"     → "../logging/budget.js"
"./identity/erc8004.js"   → "../identity/erc8004.js"
"./logging/logger.js"     → "../logging/logger.js"
"./utils/retry.js"        → "../utils/retry.js"
"./agent-loop.js"         → "../agent-loop.js"
"./server.js"             → "../server.js"
```

**Step 5: Update imports in `src/__tests__/server.e2e.test.ts`**

Check file — likely no relative imports (spawns server process). If it has any `./` paths, prefix with `../`.

**Step 6: Run unit tests to verify**

```bash
pnpm test
```

Expected: All tests pass. No import resolution errors.

**Step 7: Commit**

```bash
git add -A packages/agent/src/__tests__/ packages/agent/src/
git commit -m "refactor(agent): move root-level tests to __tests__/"
```

---

## Task 2: Move `data/` test files

**Files:**
- Move: `src/data/portfolio.test.ts` → `src/data/__tests__/portfolio.test.ts`
- Move: `src/data/portfolio.e2e.test.ts` → `src/data/__tests__/portfolio.e2e.test.ts`
- Move: `src/data/prices.test.ts` → `src/data/__tests__/prices.test.ts`
- Move: `src/data/prices.e2e.test.ts` → `src/data/__tests__/prices.e2e.test.ts`
- Move: `src/data/thegraph.test.ts` → `src/data/__tests__/thegraph.test.ts`
- Move: `src/data/thegraph.e2e.test.ts` → `src/data/__tests__/thegraph.e2e.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/data/__tests__
git mv src/data/portfolio.test.ts src/data/__tests__/
git mv src/data/portfolio.e2e.test.ts src/data/__tests__/
git mv src/data/prices.test.ts src/data/__tests__/
git mv src/data/prices.e2e.test.ts src/data/__tests__/
git mv src/data/thegraph.test.ts src/data/__tests__/
git mv src/data/thegraph.e2e.test.ts src/data/__tests__/
```

**Step 2: Update imports in each file**

Sibling `./` → `../`, parent `../` → `../../`:

`portfolio.test.ts`:
```
"./portfolio.js" → "../portfolio.js"
```

`portfolio.e2e.test.ts`:
```
"./portfolio.js" → "../portfolio.js"
```

`prices.test.ts`:
```
"../venice/llm.js" → "../../venice/llm.js"   (import + vi.mock)
"./prices.js"      → "../prices.js"
```

`prices.e2e.test.ts`:
```
"./prices.js" → "../prices.js"
```

`thegraph.test.ts`:
```
"../config.js"         → "../../config.js"         (vi.mock)
"../logging/logger.js" → "../../logging/logger.js"  (vi.mock)
"./thegraph.js"        → "../thegraph.js"
```

`thegraph.e2e.test.ts`:
```
"./thegraph.js" → "../thegraph.js"
"../config.js"  → "../../config.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A packages/agent/src/data/
git commit -m "refactor(agent): move data/ tests to __tests__/"
```

---

## Task 3: Move `delegation/` test files

**Files:**
- Move: `src/delegation/audit.test.ts` → `src/delegation/__tests__/audit.test.ts`
- Move: `src/delegation/audit.e2e.test.ts` → `src/delegation/__tests__/audit.e2e.test.ts`
- Move: `src/delegation/compiler.test.ts` → `src/delegation/__tests__/compiler.test.ts`
- Move: `src/delegation/compiler.e2e.test.ts` → `src/delegation/__tests__/compiler.e2e.test.ts`
- Move: `src/delegation/delegation.e2e.test.ts` → `src/delegation/__tests__/delegation.e2e.test.ts`
- Move: `src/delegation/redeemer.test.ts` → `src/delegation/__tests__/redeemer.test.ts`
- Move: `src/delegation/redeemer.e2e.test.ts` → `src/delegation/__tests__/redeemer.e2e.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/delegation/__tests__
git mv src/delegation/audit.test.ts src/delegation/__tests__/
git mv src/delegation/audit.e2e.test.ts src/delegation/__tests__/
git mv src/delegation/compiler.test.ts src/delegation/__tests__/
git mv src/delegation/compiler.e2e.test.ts src/delegation/__tests__/
git mv src/delegation/delegation.e2e.test.ts src/delegation/__tests__/
git mv src/delegation/redeemer.test.ts src/delegation/__tests__/
git mv src/delegation/redeemer.e2e.test.ts src/delegation/__tests__/
```

**Step 2: Update imports in each file**

`audit.test.ts`:
```
"./audit.js"            → "../audit.js"
"../venice/schemas.js"  → "../../venice/schemas.js"
```

`audit.e2e.test.ts`:
```
"./audit.js"            → "../audit.js"
"./compiler.js"         → "../compiler.js"
"../venice/schemas.js"  → "../../venice/schemas.js"
```

`compiler.test.ts`:
```
"../venice/llm.js"      → "../../venice/llm.js"       (vi.mock)
"../config.js"          → "../../config.js"            (vi.mock)
"./compiler.js"         → "../compiler.js"             (import + dynamic import)
"../venice/schemas.js"  → "../../venice/schemas.js"
```

`compiler.e2e.test.ts`:
```
"./compiler.js"         → "../compiler.js"
"../venice/schemas.js"  → "../../venice/schemas.js"
```

`delegation.e2e.test.ts`:
```
"./compiler.js"         → "../compiler.js"
"./audit.js"            → "../audit.js"
"../venice/schemas.js"  → "../../venice/schemas.js"
```

`redeemer.test.ts`:
```
"../logging/logger.js"  → "../../logging/logger.js"    (vi.mock)
"./redeemer.js"         → "../redeemer.js"
```

`redeemer.e2e.test.ts`:
```
"./redeemer.js"  → "../redeemer.js"
"./compiler.js"  → "../compiler.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A packages/agent/src/delegation/
git commit -m "refactor(agent): move delegation/ tests to __tests__/"
```

---

## Task 4: Move `identity/` test files

**Files:**
- Move: `src/identity/erc8004.test.ts` → `src/identity/__tests__/erc8004.test.ts`
- Move: `src/identity/erc8004.e2e.test.ts` → `src/identity/__tests__/erc8004.e2e.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/identity/__tests__
git mv src/identity/erc8004.test.ts src/identity/__tests__/
git mv src/identity/erc8004.e2e.test.ts src/identity/__tests__/
```

**Step 2: Update imports**

`erc8004.test.ts`:
```
"../config.js"   → "../../config.js"   (vi.mock)
"./erc8004.js"   → "../erc8004.js"
```

`erc8004.e2e.test.ts`:
```
"../config.js"   → "../../config.js"
"./erc8004.js"   → "../erc8004.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -A packages/agent/src/identity/
git commit -m "refactor(agent): move identity/ tests to __tests__/"
```

---

## Task 5: Move `logging/` test files

**Files:**
- Move: `src/logging/agent-log.test.ts` → `src/logging/__tests__/agent-log.test.ts`
- Move: `src/logging/budget.test.ts` → `src/logging/__tests__/budget.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/logging/__tests__
git mv src/logging/agent-log.test.ts src/logging/__tests__/
git mv src/logging/budget.test.ts src/logging/__tests__/
```

**Step 2: Update imports**

`agent-log.test.ts`:
```
"./agent-log.js" → "../agent-log.js"
```

`budget.test.ts`:
```
"./budget.js" → "../budget.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -A packages/agent/src/logging/
git commit -m "refactor(agent): move logging/ tests to __tests__/"
```

---

## Task 6: Move `uniswap/` test files

**Files:**
- Move: `src/uniswap/permit2.test.ts` → `src/uniswap/__tests__/permit2.test.ts`
- Move: `src/uniswap/permit2.e2e.test.ts` → `src/uniswap/__tests__/permit2.e2e.test.ts`
- Move: `src/uniswap/schemas.test.ts` → `src/uniswap/__tests__/schemas.test.ts`
- Move: `src/uniswap/trading.test.ts` → `src/uniswap/__tests__/trading.test.ts`
- Move: `src/uniswap/trading.e2e.test.ts` → `src/uniswap/__tests__/trading.e2e.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/uniswap/__tests__
git mv src/uniswap/permit2.test.ts src/uniswap/__tests__/
git mv src/uniswap/permit2.e2e.test.ts src/uniswap/__tests__/
git mv src/uniswap/schemas.test.ts src/uniswap/__tests__/
git mv src/uniswap/trading.test.ts src/uniswap/__tests__/
git mv src/uniswap/trading.e2e.test.ts src/uniswap/__tests__/
```

**Step 2: Update imports**

`permit2.test.ts`:
```
"../config.js"   → "../../config.js"   (vi.mock)
"./permit2.js"   → "../permit2.js"
```

`permit2.e2e.test.ts`:
```
"../config.js"   → "../../config.js"
"./permit2.js"   → "../permit2.js"
```

`schemas.test.ts`:
```
"./schemas.js"   → "../schemas.js"
```

`trading.test.ts`:
```
"../config.js"   → "../../config.js"   (vi.mock)
"./trading.js"   → "../trading.js"
"./schemas.js"   → "../schemas.js"
```

`trading.e2e.test.ts`:
```
"./trading.js"   → "../trading.js"
"../config.js"   → "../../config.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -A packages/agent/src/uniswap/
git commit -m "refactor(agent): move uniswap/ tests to __tests__/"
```

---

## Task 7: Move `utils/` test files

**Files:**
- Move: `src/utils/retry.test.ts` → `src/utils/__tests__/retry.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/utils/__tests__
git mv src/utils/retry.test.ts src/utils/__tests__/
```

**Step 2: Update imports**

`retry.test.ts`:
```
"../logging/logger.js" → "../../logging/logger.js"  (vi.mock)
"./retry.js"           → "../retry.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -A packages/agent/src/utils/
git commit -m "refactor(agent): move utils/ tests to __tests__/"
```

---

## Task 8: Move `venice/` test files

**Files:**
- Move: `src/venice/llm.test.ts` → `src/venice/__tests__/llm.test.ts`
- Move: `src/venice/llm.e2e.test.ts` → `src/venice/__tests__/llm.e2e.test.ts`
- Move: `src/venice/schemas.test.ts` → `src/venice/__tests__/schemas.test.ts`

**Step 1: Create directory and move files**

```bash
cd packages/agent
mkdir -p src/venice/__tests__
git mv src/venice/llm.test.ts src/venice/__tests__/
git mv src/venice/llm.e2e.test.ts src/venice/__tests__/
git mv src/venice/schemas.test.ts src/venice/__tests__/
```

**Step 2: Update imports**

`llm.test.ts`:
```
"../config.js"        → "../../config.js"        (vi.mock)
"../logging/budget.js" → "../../logging/budget.js" (vi.mock)
"./llm.js"            → "../llm.js"              (dynamic import)
```

`llm.e2e.test.ts`:
```
"./llm.js"      → "../llm.js"
"./schemas.js"  → "../schemas.js"
```

`schemas.test.ts`:
```
"./schemas.js"  → "../schemas.js"
```

**Step 3: Run unit tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -A packages/agent/src/venice/
git commit -m "refactor(agent): move venice/ tests to __tests__/"
```

---

## Task 9: Final verification and lint

**Step 1: Run full unit test suite**

```bash
pnpm test
```

Expected: All unit tests pass — same count as before.

**Step 2: Run lint**

```bash
pnpm run lint
```

Expected: No new lint errors.

**Step 3: Run TypeScript type check**

```bash
pnpm run build
```

Expected: Clean build (tests are excluded from tsconfig by default, but verify no collateral damage).

**Step 4: Verify no test files remain adjacent to source**

```bash
find packages/agent/src -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/data -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/delegation -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/identity -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/logging -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/uniswap -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/utils -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
find packages/agent/src/venice -maxdepth 1 -name '*.test.ts' -o -name '*.e2e.test.ts'
```

Expected: All find commands return empty — no stray test files.

**Step 5: Verify test count matches**

```bash
find packages/agent/src -name '*.test.ts' | wc -l
```

Expected: 30 (18 unit + 12 e2e — same as before).
