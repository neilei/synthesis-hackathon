# Per-Agent Venice Image Generation — Design

## Goal

Each intent/agent gets a unique, AI-generated avatar image created by Venice during agent onboarding. The image reflects the agent's trading strategy and is served as the ERC-8004 `image` field so it appears on 8004scan and the dashboard.

## When

During agent registration in `agent-loop/index.ts`, right after `registerAgent` succeeds and before the main monitoring loop. Non-fatal — falls back to static SVG on failure.

## How

### Step 1: Generate image prompt via LLM

Call `fastLlm` (qwen3-4b, **temperature 1.2**) with a system prompt that maps the intent's strategy to a creature personality. The system prompt draws from specific art influences (Beksinski, Bosch, Bacon, Giger, Italian Brainrot, crypto Wojak/Pepe culture, Charlie Engman's "Cursed") and uses the intent config (tokens, allocation, budget, timeframe) to inform the creature's character:

- High ETH allocation → ancient, elemental, obsidian, blue flame
- High stablecoin allocation → bureaucratic, unsettling, alive paperwork
- Aggressive budget → bloated, overfed, dripping, excessive
- Conservative budget → gaunt, skeletal, calculating, too many joints
- Short timeframe → frantic, blurred, multiple exposures
- Long timeframe → patient, geological, fungal, coral-like

Output: 2-4 sentence image generation prompt. Rules: no text in image, no real gore/violence, deeply weird, darkly funny, impossible to scroll past.

### Step 2: Generate image via Venice

`POST /api/v1/images/generations` with:
- model: `nano-banana-2`
- size: `1024x1024`
- safe_mode: false
- response_format: `url`

Download the returned URL. Cost: $0.10/image.

### Step 3: Save to filesystem

Save to `data/images/{intentId}.webp`. Same pattern as evidence documents.

### Step 4: Serve publicly

`GET /api/intents/:id/avatar.webp` — no auth, before auth middleware in server.ts.
Headers: `Cache-Control: public, max-age=31536000, immutable`.

HAProxy cache on VPS for this path pattern. Max object size 1MB.

### Step 5: Wire into identity.json

`identity.ts` checks if `data/images/{intentId}.webp` exists:
- Yes → `image: "https://api.veil.moe/api/intents/{id}/avatar.webp"`
- No → `image: "https://api.veil.moe/veil-agent.svg"` (fallback)

## Components

| File | Change |
|------|--------|
| `packages/agent/src/venice/image.ts` | **New.** `generateAgentAvatar(intentId, parsedIntent)` — LLM prompt gen + Venice image gen + download + save |
| `packages/agent/src/agent-loop/index.ts` | Call `generateAgentAvatar` after registration, before main loop |
| `packages/agent/src/routes/identity.ts` | Dynamic `image` field based on avatar existence |
| `packages/agent/src/server.ts` | Add public avatar route |
| `scripts/deploy.sh` | Add HAProxy cache config for avatar path |

## Data Flow

```
POST /api/intents → workerPool.start(intentId)
  → agent-loop starts
    → registerAgent(agentURI) → agentId minted
    → generateAgentAvatar(intentId, parsedIntent)
      → fastLlm(system_prompt + intent, temp=1.2) → image_prompt
      → POST venice/images/generations(nano-banana-2, prompt) → url
      → download url → save data/images/{intentId}.webp
    → enter main monitoring loop...

GET /api/intents/:id/identity.json
  → image: exists(avatar.webp) ? dynamic_url : static_svg

GET /api/intents/:id/avatar.webp  (public, no auth)
  → HAProxy cache hit → serve cached
  → miss → Hono serves file → Cache-Control: immutable
```

## Error Handling

Image generation is non-fatal. If any step fails (LLM, Venice image API, download, disk write):
- Log the error via pino
- Fall back to static SVG
- Agent continues normally with registration and trading

## Cost

- LLM prompt: ~$0.001 (qwen3-4b)
- Image: $0.10 (Nano Banana 2 at 1K)
- Total: ~$0.10 per agent

## Testing

- Unit: mock Venice API, verify prompt includes intent-specific details, verify file save, verify avatar route headers
- E2e: generate real image via Venice, verify valid image file
