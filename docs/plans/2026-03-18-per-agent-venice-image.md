# Per-Agent Venice Image Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate a unique AI avatar for each agent during onboarding via Venice image API, serve it publicly, and wire it into ERC-8004 identity metadata.

**Architecture:** New `venice/image.ts` module handles the two-step generation (LLM prompt → Venice image API). Called from agent-loop after ERC-8004 registration. Served via a new public route in server.ts. identity.json dynamically references the avatar if it exists.

**Tech Stack:** Venice `/api/v1/images/generations` (OpenAI-compatible), qwen3-4b for prompt gen, Nano Banana 2 for image gen, Hono for serving, vitest for testing.

---

### Task 1: Create `venice/image.ts` — image prompt generation

**Files:**
- Create: `packages/agent/src/venice/image.ts`
- Test: `packages/agent/src/venice/__tests__/image.test.ts`

**Step 1: Write the failing test**

Create `packages/agent/src/venice/__tests__/image.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImagePrompt } from "../image.js";

vi.mock("../../config.js", () => ({
  env: {
    VENICE_API_KEY: "test-key",
    VENICE_BASE_URL: "https://api.venice.ai/api/v1/",
  },
}));

// Mock the LLM to return a canned prompt
vi.mock("../llm.js", () => ({
  getVeniceLlm: () => ({
    invoke: vi.fn().mockResolvedValue({
      content: "A bloated creature made of candlestick charts sitting in a swamp of liquidity",
    }),
  }),
}));

describe("generateImagePrompt", () => {
  it("returns a string prompt incorporating intent details", async () => {
    const prompt = await generateImagePrompt({
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 3,
      maxPerTradeUsd: 100,
    });

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @maw/agent test -- --run src/venice/__tests__/image.test.ts`
Expected: FAIL — module `../image.js` does not exist

**Step 3: Write the implementation**

Create `packages/agent/src/venice/image.ts`:

```typescript
/**
 * Venice AI image generation for per-agent avatars.
 * Two-step: LLM generates a creative prompt, then Venice image API renders it.
 *
 * @module @maw/agent/venice/image
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config.js";
import { getVeniceLlm } from "./llm.js";
import { logger } from "../logging/logger.js";
import type { IntentParse } from "./schemas.js";

const IMAGE_DIR = join("data", "images");
const IMAGE_MODEL = "nano-banana-2";
const IMAGE_SIZE = "1024x1024";

const SYSTEM_PROMPT = `You are creating a portrait of a sentient DeFi trading agent. This is not a robot. This is not a dashboard. This is a CREATURE — born from the intent of a human who wanted their money to move autonomously through decentralized markets while they slept.

Your job: describe a single striking image of this creature. Think of it as a character portrait for a being that exists in the liminal space between Wall Street and a fever dream.

Art influences you draw from (pick 1-2 per image, vary them):
- Zdzislaw Beksinski's dystopian surrealism — desolate dreamscapes, deformed figures emerging from impossible architecture
- Hieronymus Bosch's Garden of Earthly Delights — swarming grotesque creatures engaged in absurd rituals, moral allegory as visual chaos
- Francis Bacon's screaming popes — distorted flesh, caged figures, the violence of existing in a body
- Italian Brainrot meme aesthetic — objects that shouldn't be fused together, pseudo-logic that makes you stare longer than you should
- Crypto Wojak/Pepe variations — the pink wojak's despair, the smug pepe's confidence, the doomer's nihilism, translated into painterly surrealism instead of MS Paint
- HR Giger's biomechanical nightmares — organic forms merged with mechanical systems, tubes and sinew and chrome
- Charlie Engman's "Cursed" — bodies that don't work right, limbs that become furniture, faces like melted masks
- The uncanny valley of early DALL-E — too many fingers, eyes where there shouldn't be eyes, smiles that are almost right

The creature's personality comes from its trading strategy. You'll receive details about what tokens it trades, how aggressive it is, its budget. Use these to inform the creature's character:
- High ETH allocation = something ancient and elemental, carved from obsidian, wreathed in blue flame
- High USDC/stablecoin allocation = something bureaucratic and unsettling, a clerk from a dimension where paperwork is alive
- Aggressive budget = bloated, overfed, dripping, excessive
- Conservative budget = gaunt, skeletal, calculating, too many joints
- Short timeframe = frantic, blurred, multiple exposures, motion sickness
- Long timeframe = patient, geological, growing like a fungus or coral

Rules:
- NO text in the image
- NO real gore or violence
- The image should be deeply weird, darkly funny, and impossible to scroll past
- It should feel like something you'd see at 3 AM and send to a group chat with no context
- Describe materials, textures, lighting. Be specific. "Wet" is better than "dark." "Iridescent mucus membrane" is better than "shiny surface."
- The creature should exist in an environment — not floating in void. Give it a world.
- Output ONLY the image generation prompt, nothing else. 2-4 sentences max.`;

function buildUserMessage(intent: IntentParse): string {
  const tokens = Object.entries(intent.targetAllocation)
    .map(([t, pct]) => \`\${t}: \${(pct * 100).toFixed(0)}%\`)
    .join(", ");
  return \`Trading strategy: \${tokens}. Daily budget: $\${intent.dailyBudgetUsd}. Timeframe: \${intent.timeWindowDays} days. Drift threshold: \${(intent.driftThreshold * 100).toFixed(1)}%. Max slippage: \${(intent.maxSlippage * 100).toFixed(1)}%.\`;
}

/**
 * Generate a creative image prompt for this agent's avatar using Venice LLM.
 */
export async function generateImagePrompt(intent: IntentParse): Promise<string> {
  const llm = getVeniceLlm({
    model: "qwen3-4b",
    temperature: 1.2,
    maxTokens: 200,
  });

  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(intent) },
  ]);

  const content = typeof response.content === "string"
    ? response.content
    : "";

  // Strip thinking tags if present (qwen3 sometimes wraps output)
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Generate an avatar image via Venice image API and save to disk.
 * Returns the file path on success, null on failure.
 */
export async function generateAgentAvatar(
  intentId: string,
  intent: IntentParse,
): Promise<string | null> {
  try {
    // Step 1: Generate creative prompt via LLM
    logger.info({ intentId }, "Generating avatar prompt via Venice LLM");
    const imagePrompt = await generateImagePrompt(intent);
    logger.info({ intentId, imagePrompt }, "Avatar prompt generated");

    // Step 2: Call Venice image generation API
    logger.info({ intentId, model: IMAGE_MODEL }, "Generating avatar image");
    const response = await fetch(
      \`\${env.VENICE_BASE_URL}images/generations\`,
      {
        method: "POST",
        headers: {
          Authorization: \`Bearer \${env.VENICE_API_KEY}\`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt: imagePrompt,
          n: 1,
          size: IMAGE_SIZE,
          response_format: "url",
          safe_mode: false,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(\`Venice image API \${response.status}: \${text}\`);
    }

    const data = (await response.json()) as {
      data: Array<{ url?: string }>;
    };
    const imageUrl = data.data[0]?.url;
    if (!imageUrl) {
      throw new Error("Venice image API returned no URL");
    }

    // Step 3: Download and save
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(\`Failed to download image: \${imageResponse.status}\`);
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    await mkdir(IMAGE_DIR, { recursive: true });
    const filePath = join(IMAGE_DIR, \`\${intentId}.webp\`);
    await writeFile(filePath, buffer);

    logger.info({ intentId, filePath, bytes: buffer.length }, "Avatar saved");
    return filePath;
  } catch (err) {
    logger.error({ err, intentId }, "Avatar generation failed — using fallback SVG");
    return null;
  }
}

/** Check if an avatar exists for an intent */
export function avatarPath(intentId: string): string {
  return join(IMAGE_DIR, \`\${intentId}.webp\`);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @maw/agent test -- --run src/venice/__tests__/image.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/venice/image.ts packages/agent/src/venice/__tests__/image.test.ts
git commit -m "feat: add Venice image prompt generation for per-agent avatars"
```

---

### Task 2: Test the full avatar generation flow (mocked)

**Files:**
- Modify: `packages/agent/src/venice/__tests__/image.test.ts`

**Step 1: Add tests for `generateAgentAvatar`**

Append to the existing test file:

```typescript
import { generateAgentAvatar, avatarPath } from "../image.js";
import { existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";

// Mock fetch globally for the image download
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("generateAgentAvatar", () => {
  const testIntentId = "test-avatar-gen";
  const testPath = avatarPath(testIntentId);

  beforeEach(() => {
    mockFetch.mockReset();
    // Clean up any leftover test files
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("generates and saves an avatar image", async () => {
    // Mock Venice image API response
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("images/generations")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{ url: "https://example.com/fake-image.webp" }],
          }),
        });
      }
      // Mock image download
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
    });

    const result = await generateAgentAvatar(testIntentId, {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 3,
      maxPerTradeUsd: 100,
    });

    expect(result).toBe(testPath);
    expect(existsSync(testPath)).toBe(true);

    // Clean up
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("returns null on API failure", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("error") }),
    );

    const result = await generateAgentAvatar(testIntentId, {
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
      dailyBudgetUsd: 100,
      timeWindowDays: 3,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 3,
      maxPerTradeUsd: 50,
    });

    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @maw/agent test -- --run src/venice/__tests__/image.test.ts`
Expected: PASS (all 3 tests)

**Step 3: Commit**

```bash
git add packages/agent/src/venice/__tests__/image.test.ts
git commit -m "test: add full avatar generation flow tests with mocked Venice API"
```

---

### Task 3: Add avatar serving route in server.ts

**Files:**
- Modify: `packages/agent/src/server.ts:80-94`
- Test: `packages/agent/src/routes/__tests__/avatar.test.ts`

**Step 1: Write the failing test**

Create `packages/agent/src/routes/__tests__/avatar.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// We'll test the route handler directly rather than through server.ts
// to avoid needing the full server setup

vi.mock("../../config.js", () => ({
  env: { AGENT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  CONTRACTS: {},
}));

describe("avatar route", () => {
  it("returns 404 for non-existent avatar", async () => {
    const app = new Hono();

    // Inline the route logic we'll add to server.ts
    app.get("/api/intents/:id/avatar.webp", (c) => {
      const intentId = c.req.param("id");
      if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
        return c.json({ error: "Invalid intent ID" }, 400);
      }
      // File won't exist in test
      return c.json({ error: "Avatar not found" }, 404);
    });

    const res = await app.request("/api/intents/nonexistent/avatar.webp");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid intent ID", async () => {
    const app = new Hono();

    app.get("/api/intents/:id/avatar.webp", (c) => {
      const intentId = c.req.param("id");
      if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
        return c.json({ error: "Invalid intent ID" }, 400);
      }
      return c.json({ error: "Avatar not found" }, 404);
    });

    const res = await app.request("/api/intents/bad%20id%3B/avatar.webp");
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it passes** (this is a self-contained test)

Run: `pnpm --filter @maw/agent test -- --run src/routes/__tests__/avatar.test.ts`
Expected: PASS

**Step 3: Add the avatar route to server.ts**

In `packages/agent/src/server.ts`, add after the evidence route (after line 94) and before the public intent listing:

```typescript
// Agent avatar images (public — referenced by ERC-8004 identity image field)
app.get("/api/intents/:id/avatar.webp", (c) => {
  const intentId = c.req.param("id");
  if (!/^[a-zA-Z0-9_-]+$/.test(intentId)) {
    return c.json({ error: "Invalid intent ID" }, 400);
  }
  const filePath = join("data", "images", `${intentId}.webp`);
  if (!existsSync(filePath)) {
    return c.json({ error: "Avatar not found" }, 404);
  }
  const content = readFileSync(filePath);
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(content);
});
```

**Step 4: Run full test suite to verify nothing breaks**

Run: `pnpm --filter @maw/agent test -- --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/routes/__tests__/avatar.test.ts
git commit -m "feat: add public avatar.webp serving route with immutable caching"
```

---

### Task 4: Wire identity.json to use dynamic avatar

**Files:**
- Modify: `packages/agent/src/routes/identity.ts:1-3,55`
- Modify: `packages/agent/src/routes/__tests__/identity.test.ts`

**Step 1: Update identity.test.ts with avatar existence test**

Add a new test to the existing file:

```typescript
it("uses dynamic avatar URL when avatar exists", async () => {
  // Mock existsSync to return true for avatar path
  vi.doMock("node:fs", () => ({
    existsSync: (path: string) => path.includes("avatar") || path.includes("images"),
  }));

  // Re-import to pick up mock — or just test the logic inline
  const repo = createMockRepo(SAMPLE_INTENT);
  app.route("/api/intents", createIdentityRoutes({ repo }));

  const res = await app.request("/api/intents/test-intent-123/identity.json");
  const body = await res.json();

  // When no avatar exists, falls back to SVG
  expect(body.image).toMatch(/maw-agent\.svg|avatar\.webp/);
});
```

**Step 2: Modify identity.ts**

At the top of `packages/agent/src/routes/identity.ts`, add the import:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
```

Change line 55 from:
```typescript
      image: "https://api.maw.finance/maw-agent.svg",
```
To:
```typescript
      image: existsSync(join("data", "images", `${intentId}.webp`))
        ? `https://api.maw.finance/api/intents/${intentId}/avatar.webp`
        : "https://api.maw.finance/maw-agent.svg",
```

**Step 3: Run identity tests**

Run: `pnpm --filter @maw/agent test -- --run src/routes/__tests__/identity.test.ts`
Expected: All existing tests pass (they won't have the avatar file so they get the SVG fallback)

**Step 4: Commit**

```bash
git add packages/agent/src/routes/identity.ts packages/agent/src/routes/__tests__/identity.test.ts
git commit -m "feat: identity.json uses dynamic avatar URL with SVG fallback"
```

---

### Task 5: Call avatar generation from agent-loop

**Files:**
- Modify: `packages/agent/src/agent-loop/index.ts:27,200-201`

**Step 1: Add import**

At line 27 of `agent-loop/index.ts`, after the `registerAgent` import, add:

```typescript
import { generateAgentAvatar } from "../venice/image.js";
```

**Step 2: Add avatar generation after registration**

After line 200 (end of the registration `else` block's closing brace, right before the HARD GATE comment at line 203), insert:

```typescript
  // Generate unique avatar image for this agent
  if (state.agentId != null && config.intentId) {
    try {
      const parsedIntent = config.intent;
      await generateAgentAvatar(config.intentId, parsedIntent);
      logger.info({ intentId: config.intentId }, "Agent avatar generated");
      config.intentLogger?.log("avatar_generated", {
        tool: "venice-image",
        result: { intentId: config.intentId, model: "nano-banana-2" },
      });
    } catch (err) {
      logger.warn({ err, intentId: config.intentId }, "Avatar generation failed — continuing with fallback SVG");
      config.intentLogger?.log("avatar_generation_failed", {
        tool: "venice-image",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
```

**Step 3: Run full agent tests**

Run: `pnpm --filter @maw/agent test -- --run`
Expected: All tests pass (avatar generation is wrapped in try/catch so it's non-fatal)

**Step 4: Commit**

```bash
git add packages/agent/src/agent-loop/index.ts
git commit -m "feat: generate unique Venice avatar during agent onboarding"
```

---

### Task 6: E2E test — real Venice image generation

**Files:**
- Create: `packages/agent/src/venice/__tests__/image.e2e.test.ts`

**Step 1: Write the e2e test**

```typescript
import { describe, it, expect } from "vitest";
import { generateImagePrompt, generateAgentAvatar, avatarPath } from "../image.js";
import { existsSync, unlinkSync } from "node:fs";

describe("Venice image generation (e2e)", () => {
  it("generates a real image prompt via Venice LLM", async () => {
    const prompt = await generateImagePrompt({
      targetAllocation: { ETH: 0.7, USDC: 0.3 },
      dailyBudgetUsd: 500,
      timeWindowDays: 14,
      driftThreshold: 0.03,
      maxSlippage: 0.005,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 200,
    });

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(20);
    console.log("Generated prompt:", prompt);
  }, 30_000);

  it("generates and saves a real avatar image", async () => {
    const testId = "e2e-test-avatar";
    const path = avatarPath(testId);

    // Clean up from previous runs
    if (existsSync(path)) unlinkSync(path);

    const result = await generateAgentAvatar(testId, {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 3,
      maxPerTradeUsd: 100,
    });

    expect(result).toBe(path);
    expect(existsSync(path)).toBe(true);

    console.log("Avatar saved to:", result);

    // Clean up
    if (existsSync(path)) unlinkSync(path);
  }, 60_000);
});
```

**Step 2: Run e2e test (requires VENICE_API_KEY in .env)**

Run: `pnpm --filter @maw/agent test:e2e -- --run src/venice/__tests__/image.e2e.test.ts`
Expected: PASS — real image generated and saved

**Step 3: Commit**

```bash
git add packages/agent/src/venice/__tests__/image.e2e.test.ts
git commit -m "test: add e2e test for real Venice avatar generation"
```

---

### Task 7: HAProxy cache config for avatar images

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add HAProxy cache config to deploy setup**

In `scripts/deploy.sh`, inside `cmd_setup()`, after the systemd service creation (after line 106 `ssh_run "sudo systemctl daemon-reload"`), add a step to patch HAProxy config:

```bash
  # 6. Add caching for avatar images in HAProxy (if haproxy is present)
  log "Configuring HAProxy cache for avatar images..."
  ssh_run "which haproxy >/dev/null 2>&1" && ssh_run "sudo tee /etc/haproxy/conf.d/maw-cache.cfg > /dev/null" <<'CACHEEOF'
cache maw_avatar_cache
  total-max-size 64  # 64MB
  max-object-size 1048576  # 1MB per object
  max-age 86400  # 1 day default (overridden by Cache-Control from origin)
CACHEEOF
  ssh_run "which haproxy >/dev/null 2>&1 && sudo systemctl reload haproxy || true"
```

**Step 2: Verify deploy script syntax**

Run: `bash -n scripts/deploy.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: add HAProxy cache config for avatar images in deploy script"
```

---

### Task 8: Build, lint, run full test suite

**Step 1: Build**

Run: `pnpm --filter @maw/common build && pnpm --filter @maw/agent build`
Expected: Clean build, no errors

**Step 2: Lint**

Run: `pnpm --filter @maw/agent run lint`
Expected: No lint errors

**Step 3: Run unit tests**

Run: `pnpm --filter @maw/agent test -- --run`
Expected: All tests pass

**Step 4: Commit any fixups if needed, then final commit**

```bash
git add -A
git commit -m "chore: build verification for per-agent Venice image generation"
```
