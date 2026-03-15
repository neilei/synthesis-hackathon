# Veil — Intent-Compiled Private DeFi Agent

## What This Is

An autonomous DeFi agent for the Synthesis Hackathon (deadline: 2026-03-22). The agent:

1. Takes a natural language portfolio intent ("60/40 ETH/USDC, $200/day, 7 days")
2. Compiles it into an ERC-7715 delegation with on-chain caveats the agent cannot violate
3. Privately reasons about when to rebalance (Venice AI, no data retention)
4. Executes trades on Uniswap via ERC-7710 delegation redemption
5. Logs every decision to agent_log.jsonl and ERC-8004 reputation registry

## Project Structure (Monorepo)

```
packages/agent/     Backend — agent loop, API server, all integrations
apps/dashboard/     Frontend — Next.js dashboard (Configure, Audit, Monitor)
docs/               Design docs, plans, research
reference/          Code patterns from existing projects
agent.json          PAM spec manifest (root level)
```

Root `package.json` uses pnpm workspaces. Run everything from root:

- `pnpm test` — unit tests (packages/agent)
- `pnpm run test:e2e` — e2e tests
- `pnpm run serve` — API server on :3147
- `pnpm run dev` — CLI agent
- `pnpm run codegen` — GraphQL codegen for The Graph
- `pnpm run dev:dashboard` — Next.js dashboard dev server
- `pnpm run build:dashboard` — build dashboard for production
- `pnpm --filter @veil/dashboard test:e2e` — Playwright e2e tests (uses port 3100)

## Chains

- **Ethereum Sepolia** (chainId 11155111) — primary for Uniswap swaps. Wallet funded with 1 ETH.
- **Base Sepolia** — used for ERC-8004 identity. Wallet funded with 0.5 ETH.
- **Base Mainnet** — ERC-8004 production contracts. Not used yet.
- Uniswap Trading API does NOT support Base Sepolia.

## Sponsor Integrations

| Sponsor              | Prize                                | Integration Point                            | Package Path |
| -------------------- | ------------------------------------ | -------------------------------------------- | ------------ |
| Venice ($11.5K)      | Private LLM, web search, multi-model | `packages/agent/src/venice/`                 |
| MetaMask ($5K)       | ERC-7715 grant + ERC-7710 redeem     | `packages/agent/src/delegation/`             |
| Uniswap ($5K)        | Trading API + Permit2                | `packages/agent/src/uniswap/`                |
| Protocol Labs ($16K) | ERC-8004, agent.json, logs           | `packages/agent/src/identity/`, `agent.json` |
| AgentCash ($1.75K)   | x402 paid data                       | NOT STARTED — on hold                        |

## Coding Standards

- **TypeScript strict mode** — no `any` types, no unsafe casts
- **Zod validation** on all external data (API responses, user input, env vars)
- **No stubs or TODOs in committed code** — if something isn't done, don't pretend it is
- **Tests required** — every module needs unit tests. E2e tests for external service calls.
- **Vitest** for testing (not Jest). Config at `packages/agent/vitest.config.ts`
- **ESM only** — `"type": "module"` in package.json, `.js` extensions in imports
- **dotenv** loads from project root `.env` (not package-level)
- **No Express** — server uses Node.js `http` module directly

## Key Technical Decisions

- **Venice multi-model**: qwen3-4b (fast), gemini-3-flash-preview (research/web search + scraping), gemini-3-1-pro-preview (reasoning). All confirmed valid via `GET /api/v1/models`. Venice model catalog changes frequently — always verify against the live API, never static docs.
- **Structured output**: `llm.withStructuredOutput(zodSchema)` + `safeParse()` post-validation
- **Budget tracking**: Venice `x-venice-balance-usd` response header captured via custom fetch wrapper
- **The Graph**: Uses official Uniswap V3 Ethereum mainnet subgraph (ID: `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`). Types generated via graphql-codegen.
- **Delegation flow**: ERC-7715 creates scoped permission (human approves once), ERC-7710 redeems server-side (no browser needed). Falls back to direct tx if delegation fails. Must pass `valueLte: { maxValue }` in `functionCall` scope — SDK defaults to `maxValue: 0n` if omitted, blocking all ETH-value calls.
- **Agent identity**: ERC-8004 NFT on Base, reputation feedback uses dynamic agentId from registration

## Current Status (updated 2026-03-15)

- Phase 1 (Graph codegen fix): COMPLETE
- Phase 2 (Monorepo): COMPLETE
- Phase 3 (Agent e2e run): COMPLETE (2 real swaps on Sepolia, 3 ERC-8004 txs on Base Sepolia)
- Phase 4 (Git push): NOT STARTED
- Phase 5 (Next.js frontend): IN PROGRESS — all 3 screens built, 14 Playwright e2e tests passing, polish pass done. Remaining: Storybook (optional), integration test with agent server, Vercel deploy.
- See `docs/plans/2026-03-14-full-project-plan.md` for full plan

## Design Context

### Users

DeFi-savvy individuals and hackathon judges. They understand wallet addresses, token allocations, and trading terminology. They're evaluating both the tech and the presentation. Context: sitting at a laptop, reviewing a 3-minute demo or exploring the live app. The job: see the agent's intent, understand the safety constraints, and monitor autonomous trading in real time.

### Brand Personality

**Sophisticated. Private. Powerful.** Like a modernized Bloomberg Terminal for on-chain autonomous agents. Every pixel communicates competence and trustworthiness. The product handles real money — the UI must reflect that gravity.

### Aesthetic Direction

- **Visual tone:** Modern dark finance. Dense but not cluttered. Professional, not playful.
- **Reference:** Bloomberg Terminal (modernized) — maximum information density, monospace numbers, professional trading feel. Also draws from Linear's spacing discipline and Stripe's typographic hierarchy.
- **Anti-references:** Neon hacker terminals (too gimmicky), generic SaaS dashboards (too bland), Web3 "degen" aesthetics (too unserious).
- **Theme:** Dark only. `#09090b` zinc-950 background. Emerald-500 as primary accent (positive/CTA). Indigo-500 secondary. Red/amber for danger/warning states.
- **Typography:** Inter for body, JetBrains Mono for all numbers, addresses, and data. Tabular-nums for column alignment.
- **Cards:** Solid zinc-900 fill, 1px zinc-800 border, 8px radius. No shadows, no glassmorphism.

### Design Principles

1. **Data density over decoration** — Every element earns its space. No filler, no ornamental graphics. If it doesn't inform, it doesn't belong.
2. **Numbers are first-class citizens** — Financial data uses monospace, tabular-nums, and careful alignment. Prices, percentages, and addresses are always legible at a glance.
3. **Trust through transparency** — Show what the agent is allowed to do, what it's prevented from doing, and what it actually did. The audit report is the product's credibility.
4. **Restraint in color** — Emerald for positive/active, red for danger, amber for warnings. Everything else is grayscale. Color means something — never decorative.
5. **Responsive without compromise** — Desktop is the primary viewport (judge demos), but mobile must be fully functional. Stack gracefully, never truncate critical data.

## Best practices/Standards

### React standards

- Avoid using `use client` when possible
- Prefer functional components over class components
- Any UI component should have a story, and stories should be checked for completeness after a major change
- Use `pnpm/pnpm run lint` to check for linting errors after you're done

### Backend (agent) standards

- Vitest is used for testing

### Typescript standards

- Do not use `any` unless explicitly instructed otherwise
- Do not type cast unless explicitly instructed otherwise. If you must typecast, any usage must have a clear and convincing comment explaining why
- Avoid type casting as a solution to type errors unless it's absolutely necessary or explicitly instructed otherwise
- Avoid type casting as a solution to type errors unless it's absolutely necessary or explicitly instructed otherwise
- Avoid using @ts-expect-error, @ts-ignore, or @ts-nocheck unless absolutely necessary or explicitly instructed otherwise. Fix things instead
- Never do hot imports in code function bodies
- When using Zod schemas, derive TypeScript types using `z.infer<typeof schema>` rather than defining types separately - this prevents type drift where the schema and type diverge
- Prefer vitest for testing when able
- After making significant changes (adding functions, renaming files and functions, significant logic changes, etc), you should run `pnpm run lint`, `pnpm run build` and `pnpm run test:unit` to confirm your changes compile, or if you change multiple apps/packages, verify with `turbo run lint`, `turbo run build`, and `turbo run test:unit` (pnpm or pnpm allowed depending on the project standard, avoid yarn and npm unless standard in project)

### Solidity standards

- Always follow best practices for solidity development.
- Prefer foundry to hardhat when you're able to choose (may be restricted by vendor tech in rare cases)
- Prefer viem to ethers always when you're able to choose
- Always verify contracts after deploying. Always set up contract deployment scripts/plugins to automatically verify contracts when they're deployed
- Always analyze changes to the contracts for security vulnerabilities and fix them if detected

#### Foundry guidelines

- Confirm any significant changes compile w/ `forge build` after you're done
- Test any significant changes w/ `forge test` after you're done
- Check tests for compatibility w/ any new contract changes
- New public functions should have a corresponding script in the `script` folder
- Always prefer Error types over inline revert messages
- You may use Foundry's `console2.log` in scripts liberally and in contracts conservatively for debugging purposes and clarity
- When writing a new script or changing inputs and/or outputs of a script, you should update the README.md file to reflect the changes
- After deploying to a real environment (Base Mainnet, Base Sepolia, etc), you should run `forge verify` to verify the contracts on the blockchain.

### Other standards

- When installing new dependencies, always use the latest version of dependencies that the project will allow
- CLAUDE.MD and README.MD are living docs that should be reviewed for accuracy after major changes. Do not fill these with fluff, just make sure they're current.
- The year is 2026. If you search for "recent" information in the web and choose to include the year in your search, you should use the year 2025 or 2026. Avoid using 2024, 2023, or other years before 2025 when searching for up to date information
- According to <https://github.com/anthropics/claude-code/issues/13137>, bash permission wildcards don't match commands with redirects or special shell characters. To avoid me having to manually approve commands excessively, structure your commands to avoid the use of special characters when possible (esp ">", "&&", "||")
- You should always write e2e tests and unit tests for your work. When relevant, e2e tests should be configurable to run against, or should just outright run against real chains/frontends/backends/agents etc, and you should always test against real systems before claiming work is complete. Aim for high test coverage.
- Avoid using inline environment variables in commands you run, as this requires me to manually approve the command. Everything has a .env file you can source, or use dotenv or similar to load, for secrets
- Always opt out of optional telemetry. Don't remove code that disables it. Always ADD code that disables it when missing (such as in Claude settings in .claude/settings.json, turbo.json vars, envvars in github actions)
- When deprecating code, you don't have to worry about backwards compatibility or leaving a comment trail unless explicitly instructed otherwise, just remove the code.
- Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
- Always think and do research to make sure you're confident before taking action, it's important for you to not code reflexively
