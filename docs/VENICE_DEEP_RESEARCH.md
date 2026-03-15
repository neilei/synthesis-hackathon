# Venice AI Deep Research -- $11,500 Prize Strategy

## 1. WHAT VENICE WANTS (Exact Words + Analysis)

### Prize Track: "Private Agents, Trusted Actions"

**Prize breakdown (paid in VVV tokens):**
- 1st: 1,000 VVV (~$5,750)
- 2nd: 600 VVV (~$3,450)
- 3rd: 400 VVV (~$2,300)

### Venice's Own Words (from SPONSOR_TECH.md bounty description + synthesis themes):

> "Private cognition -> public on-chain action. No-data-retention inference, OpenAI-compatible API, multimodal."

> Examples they gave: "private treasury copilots, confidential governance analysts, deal negotiation agents, on-chain risk desks, confidential due diligence agents, private multi-agent coordination."

### What the Track Name Itself Tells Us

"Private Agents, Trusted Actions" has TWO halves -- most teams will focus on one:

1. **Private Agents** = Venice's inference is private (no data retention, no logging). Your agent THINKS privately using Venice.
2. **Trusted Actions** = The agent then ACTS publicly on-chain in a way that is verifiable and trustworthy.

The winning project must demonstrate BOTH: private reasoning that feeds into public, verifiable on-chain execution. The gap between "thinking" and "doing" is the prize criteria.

### Venice's Broader Philosophy (from their blog, docs, token pages):

- "The only way to achieve reasonable user privacy is to avoid collecting this information in the first place."
- "Build AI with no data retention, permissionless access, and compute you permanently own."
- VVV is "designed primarily for agents" -- they see agents as their core market.
- "For AI agents to scale, we need a new model" (beyond pay-per-request).
- Venice + Fleek partnership = "the first end-to-end solution for private agents"
- $27M Incentive Fund prioritizes: technical innovation, effective API utilization, value alignment with privacy/uncensored AI, clear focused objectives, significant results through effective AI implementation.

### Hackathon Theme Alignment

Venice's track maps directly to the hackathon's "Agents that keep secrets" theme:
> "Your agent pays for things without linking your identity to every transaction."
> "Agents leak user metadata through API calls and interactions, requiring a default privacy layer."

---

## 2. MODEL CATALOG

**WARNING:** Venice's model catalog changes frequently. Always verify against the live API:
```
GET https://api.venice.ai/api/v1/models
```

The static tables below are a snapshot and WILL become stale. Use the API as the source of truth.

---

## 3. VENICE-SPECIFIC FEATURES (Beyond "Swap the Base URL")

This is the critical section. A Venice judge will look for use of features that ONLY Venice has.

### A. `venice_parameters` Object

Passed via `extra_body` in OpenAI SDK:

```python
client.chat.completions.create(
    model="zai-org-glm-4.7",
    messages=[...],
    extra_body={
        "venice_parameters": {
            "enable_web_search": "auto",        # Real-time web data
            "enable_web_scraping": True,         # Scrape up to 5 URLs
            "enable_web_citations": True,        # Source attribution
            "include_venice_system_prompt": False, # Disable Venice defaults
            "strip_thinking_response": True,     # Hide <think> blocks
        }
    }
)
```

### B. Web Search with Citations ($10/1K calls)

Venice can search the web in real-time and return structured citations:

```python
# Response includes:
response.venice_parameters.web_search_citations = [
    {
        "title": "Source title",
        "url": "https://...",
        "content": "excerpt",
        "date": "2024-08-13T..."
    }
]
# Citations appear as ^1^ or ^i,j^ superscripts in content
```

This is Venice-exclusive. OpenAI doesn't offer web search through the same API format.

**Use case for our project:** Agent researches DeFi protocols, token prices, governance proposals using Venice web search BEFORE executing on-chain actions. The citations become part of the agent's decision audit trail.

### C. Web Scraping ($10/1K calls)

`enable_web_scraping: true` -- Venice auto-detects up to 5 URLs in the user message and scrapes them via Firecrawl. Only charges for successful scrapes.

**Use case:** Agent scrapes DeFi protocol docs, governance forums, or smart contract source code to inform decisions.

### D. Reasoning Control

```python
# Full reasoning with visible thinking:
response_format with reasoning: {"effort": "high", "summary": "detailed"}

# Strip thinking for production (save tokens):
venice_parameters: {"strip_thinking_response": True}

# Disable reasoning entirely for simple queries:
venice_parameters: {"disable_thinking": True}
# OR
reasoning: {"enabled": False}
```

**Use case:** Use high reasoning effort for complex DeFi decisions (swap routing, risk assessment), disable for simple lookups. Log the thinking chain as decision evidence.

### E. Model Suffix Syntax (Unique)

Venice lets you pass parameters IN the model name itself:

```python
model="qwen3-4b:enable_web_search=on&enable_web_citations=true"
```

This is elegant for dynamic parameter selection without changing request structure.

### F. Prompt Caching

Venice supports prompt caching on select models to reduce latency and costs for repeated content. System prompts are automatically cached on supported models with no code changes.

Additionally, you can use `prompt_cache_key` (a string routing hint) to improve cache hit rates by ensuring requests go to the same backend infrastructure:

```python
client.chat.completions.create(
    model="gemini-3-flash-preview",
    messages=[...],
    extra_body={
        "venice_parameters": {
            "prompt_cache_key": "veil-agent-v1"
        }
    }
)
```

You can also manually mark content for caching using the `cache_control` property on message content.

**Source:** Venice OpenAPI spec at `docs.venice.ai/api-reference/api-spec`

**Use case:** Cache the agent's system prompt (DeFi expertise, privacy rules, tool definitions) to reduce latency and cost on repeated calls.

### F2. `enable_x_search`

`enable_x_search: true` — Enable xAI native search (web + X/Twitter) for supported models (e.g. Grok models). Returns real-time social media context.

**Use case:** Agent monitors X/Twitter for breaking DeFi news, sentiment, or protocol announcements before executing trades.

### G. `return_search_results_as_documents`

When true, web search results come back in OpenAI-compatible tool call format. This works with LangChain and other frameworks that expect tool-call-shaped responses.

### H. `include_search_results_in_stream`

Experimental: search results arrive as the first chunk in a streaming response, allowing the UI to show sources before the full answer is generated.

### I. Tool Calling (Function Calling)

Standard OpenAI `tools` parameter supported on `zai-org-glm-4.7` and `mistral-31-24b`. Also supports special tool types:

```python
tools=[
    {"type": "web_search"},   # Venice web search as a tool
    {"type": "x_search"},     # X/Twitter search as a tool
    {"type": "function", "function": {...}}  # Standard function calling
]
```

### J. Structured Responses

`response_format: {"type": "json_schema", ...}` -- ensures output matches a schema. Requires `strict: true` and `additionalProperties: false`.

### K. Vision/Multimodal

Supported on `qwen3-vl-235b-a22b`, `mistral-31-24b`, and proxied models. Accepts base64 and URL images, multiple images per message, plus audio and video input.

### L. Characters API

Venice has a Characters API for creating persistent AI personas. Could be used to give the agent a consistent "personality" with a `character_slug`.

### M. Response Headers (Telemetry)

Venice returns unique headers showing remaining balance:
- `x-venice-balance-usd` -- USD credits remaining
- `x-venice-balance-diem` -- DIEM credits remaining
- `x-venice-model-id` -- Actual model used
- `x-ratelimit-remaining-requests` -- Rate limit status

**Use case:** Agent monitors its own compute budget via these headers. Self-manages inference costs.

### N. End-to-End Encryption (E2EE)

`enable_e2ee: true` -- Available on compatible models. Encrypts the full request/response path.

### O. Billing Balance API

`GET /billing/balance` -- Returns current USD + DIEM balance.
`GET /billing/usage` -- Usage data.

**Use case:** Agent checks its own balance before expensive operations. Self-sustaining compute awareness.

---

## 4. MAKING VENICE USAGE LOOK DEEP AND INTENTIONAL

### The "Decorative vs. Load-Bearing" Test

A Venice judge will ask: "Could this project work exactly the same with OpenAI/Anthropic?" If yes, Venice is decorative.

### Features That Prove Deep Integration:

| Feature | Why It's Venice-Only | How We Use It |
|---------|---------------------|---------------|
| `venice_parameters` | Not in OpenAI API | Every request uses at least 2-3 Venice params |
| Web search + citations | Venice's own implementation | Agent researches before acting, cites sources |
| Web scraping | Firecrawl integration | Agent reads protocol docs/governance pages |
| `strip_thinking_response` | Reasoning control | Show thinking in audit logs, hide in production |
| DIEM balance checking | Venice-exclusive token | Agent monitors compute budget |
| `include_venice_system_prompt: false` | Override Venice defaults | Custom agent personality |
| Model suffix syntax | Venice-unique | Dynamic parameter selection based on task |
| Prompt caching / `prompt_cache_key` | Venice routing hint for cache hits | Cache system prompt for cost savings |
| `enable_x_search` | xAI native search via Venice | X/Twitter social sentiment for DeFi decisions |
| `return_search_results_as_documents` | Venice-specific format | LangChain-compatible search results |
| E2EE | Venice privacy feature | Maximum privacy for sensitive financial reasoning |

### Architecture That Demonstrates Understanding:

1. **Multi-model routing within Venice:** Use `qwen3-4b` for quick lookups, `zai-org-glm-4.7` for complex reasoning, `mistral-31-24b` for vision tasks. Show you understand the model lineup.

2. **Reasoning effort adaptation:** Use `reasoning_effort: "high"` for swap decisions, `"low"` for balance checks, `"none"` for formatting. Show you understand compute economics.

3. **Privacy as architecture, not feature:** Don't just say "we use Venice because it's private." Show that your agent's DeFi reasoning (portfolio analysis, trading strategy) would be DANGEROUS to leak. Treasury analysis, MEV vulnerability assessment, pre-trade intelligence -- these MUST be private.

4. **Web search -> reasoning -> on-chain action pipeline:** Agent uses Venice web search to get real-time data, reasons about it privately, then executes on-chain. The citation trail proves the agent did its homework.

5. **Self-sustaining compute model:** Reference VVV staking / DIEM. Even if we don't implement it fully, showing awareness that the agent could stake VVV for perpetual compute (rather than burning credits) demonstrates product understanding.

---

## 5. WHAT WOULD MAKE A VENICE JUDGE SAY "THIS TEAM GETS IT"

### Top-Tier Signals:

1. **The agent reasons about sensitive financial data using Venice's no-retention guarantee.** The pitch: "Our agent analyzes your DeFi portfolio, identifies MEV-vulnerable positions, and recommends protective actions. This analysis touches your full financial state -- wallet contents, trading patterns, risk exposure. With Venice, none of this data is stored. With OpenAI, it would be logged indefinitely."

2. **Use of Venice-exclusive features throughout the codebase.** Not just `base_url` swap. Web search, citations, web scraping, reasoning control, model suffix syntax, balance monitoring, E2EE.

3. **Multi-model strategy within Venice's lineup.** Show that you chose specific Venice models for specific tasks. GLM 4.7 for agent planning, Mistral 3.1 for vision (reading charts/screenshots), Qwen 3 4B for fast lookups.

4. **Acknowledgment of the VVV/DIEM tokenomics.** Even a comment in the code like "In production, this agent would stake VVV for perpetual compute rather than burning credits" shows product awareness.

5. **Privacy as the REASON the product exists, not a nice-to-have.** The agent couldn't work with a non-private provider because the data it processes is too sensitive. This is the "Private Agents" half of the prize.

6. **On-chain verifiable actions (the "Trusted" half).** The agent's private reasoning leads to public, verifiable on-chain transactions. Anyone can audit WHAT the agent did, but nobody can see WHY (the private reasoning). This is the core tension Venice wants to see resolved.

7. **References to Venice's broader ecosystem.** Mention Fleek for agent deployment, OpenClaw for skills, ElizaOS for framework support, DIEM for compute ownership. Shows you understand Venice isn't just an API -- it's an ecosystem.

### Red Flags That Will Lose:

- Just swapping `base_url` from OpenAI to Venice with no other changes
- Not using any `venice_parameters`
- Privacy mentioned in README but not architecturally load-bearing
- Using only one model (not leveraging Venice's multi-model lineup)
- No on-chain component (missing the "Trusted Actions" half)
- Treating Venice as a commodity LLM provider rather than a privacy infrastructure platform

---

## 6. VVV/DIEM TOKEN ECONOMY (Judge Awareness Points)

### VVV Token
- ERC-20 on Base blockchain
- 100M genesis supply, 42.68% already burned (33M+ tokens)
- Staking model: stake VVV -> get pro-rata share of Venice's total API capacity, perpetually
- "If you stake 1% of staked VVV, you get 1% of Venice's API capacity, perpetually"
- 7-day unstaking period
- Founded by Erik Voorhees (ShapeShift founder)
- Monthly buy-and-burn from protocol revenue

### DIEM Token
- ERC-20 on Base: `0xf4d97f2da56e8c3098f3a8d538db630a2606a024`
- 1 DIEM = $1/day of perpetual API credit
- Minted by locking staked VVV (sVVV)
- Tradeable on Aerodrome DEX
- Can be burned to unlock original VVV
- Min 0.1 DIEM to stake for API credits
- "The first tradeable direct AI compute asset"

### Why This Matters for Judges:
The prizes are paid in VVV tokens. Venice wants winners who UNDERSTAND and VALUE VVV. Mentioning that the agent could self-sustain via VVV staking (zero marginal cost inference) is a strong signal. Showing DIEM balance monitoring via the `/billing/balance` endpoint even stronger.

---

## 7. RATE LIMITS (Practical Considerations)

| Tier | Models | Req/min | Tokens/min |
|------|--------|---------|-----------|
| XS | `qwen3-4b`, `llama-3.2-3b` | 500 | 1,000,000 |
| S | `mistral-31-24b`, `venice-uncensored` | 75 | 750,000 |
| M | `llama-3.3-70b`, `qwen3-next-80b` | 50 | 750,000 |
| L | `deepseek-R1`, `claude-opus-4.6`, `gpt-5.4` | 20 | 500,000 |

Image: 20/min | Audio: 60/min | Embeddings: 500/min

For hackathon demo: Use XS/S tier models for speed. Reserve L tier for complex reasoning moments.

---

## 8. FULL API ENDPOINTS AVAILABLE

### Text
- `POST /chat/completions` -- Chat, vision, streaming, tool calling
- `GET /models` -- List models
- `GET /models/traits` -- Model capabilities
- `GET /models/compatibility_mapping` -- OpenAI name mappings

### Image
- `POST /image/generate` -- Text-to-image (1-4 variants, styles, LoRA)
- `POST /image/upscale` -- 2x/4x resolution
- `POST /image/edit` -- Inpaint/modify
- `POST /image/multi-edit` -- Layered editing
- `POST /image/background-remove` -- Background removal
- `GET /image/styles` -- Available style presets

### Audio
- `POST /audio/speech` -- TTS (50+ voices, multi-language)
- `POST /audio/transcriptions` -- STT
- `POST /audio/queue` -- Async audio generation
- `POST /audio/retrieve` -- Poll async status

### Video
- `POST /video/queue` -- Queue video generation
- `POST /video/retrieve` -- Check status

### Embeddings
- `POST /embeddings` -- Text embeddings (BGE-M3)

### Billing
- `GET /billing/balance` -- Current USD + DIEM balance
- `GET /billing/usage` -- Usage data

### API Keys
- `POST /api_keys` -- Create key
- `GET /api_keys` -- List keys
- `GET /api_keys/rate_limits` -- Rate limits
- `GET /api_keys/generate_web3_key` -- Web3 wallet auth

---

## 9. COMPETITIVE ANALYSIS: What Other Teams Will Do

**Level 0 (Most teams):** Swap base_url to Venice. Mention "privacy" in README. Use one model.

**Level 1 (Better teams):** Use venice_parameters. Enable web search. Use 2-3 models.

**Level 2 (Good teams):** Multi-model routing. Web search + citations in decision pipeline. Structured responses. Reasoning control.

**Level 3 (What we need to do):** All of Level 2, PLUS:
- E2EE for sensitive operations
- DIEM/VVV awareness in agent logic
- Balance monitoring via billing API
- Privacy as architectural requirement (not decorator)
- Private reasoning -> public on-chain action pipeline with verifiable outputs
- Web scraping of DeFi protocol docs
- Prompt caching via `prompt_cache_key` for cost optimization
- `enable_x_search` for social sentiment
- Image generation for visual reports/dashboards
- Model suffix syntax for dynamic parameter selection
- Agent self-manages compute budget

---

## 10. RECOMMENDED INTEGRATION CHECKLIST

Priority order for Venice features to implement:

- [ ] **P0:** Use Venice API with custom base_url + API key
- [ ] **P0:** Use `venice_parameters` in every request (web search, citations, system prompt control)
- [ ] **P0:** Multi-model routing (GLM 4.7 for planning, Mistral 3.1 for vision, Qwen 3 4B for fast ops)
- [ ] **P0:** Privacy-as-architecture (agent processes sensitive financial data that MUST not be logged)
- [ ] **P0:** On-chain actions from private reasoning (the "Trusted Actions" half)
- [ ] **P1:** Web search + citations for real-time DeFi data research
- [ ] **P1:** Web scraping for protocol documentation
- [ ] **P1:** Reasoning effort adaptation per task type
- [ ] **P1:** Structured JSON responses for on-chain action parameters
- [ ] **P1:** Tool/function calling with Venice-supported models
- [ ] **P2:** Billing balance monitoring (agent tracks own compute budget)
- [ ] **P2:** Prompt caching via `prompt_cache_key` for system prompt optimization
- [ ] **P2:** `enable_x_search` for social media sentiment analysis
- [ ] **P2:** E2EE for maximum privacy demonstration
- [ ] **P2:** Image generation for portfolio visualization
- [ ] **P2:** VVV/DIEM references in code comments + documentation
- [ ] **P3:** Model suffix syntax usage
- [ ] **P3:** `return_search_results_as_documents` for framework compatibility
- [ ] **P3:** TTS for agent status announcements (novelty factor)
- [ ] **P3:** Characters API for consistent agent persona

---

## Sources

- Venice API Docs: https://docs.venice.ai
- Venice Pricing: https://docs.venice.ai/overview/pricing
- Venice Privacy Architecture: https://venice.ai/privacy
- Venice About: https://docs.venice.ai/overview/about-venice
- VVV Token: https://venice.ai/vvv
- DIEM Token: https://venice.ai/blog/introducing-diem-as-tokenized-intelligence-the-next-evolution-of-vvv
- Venice x Fleek (Private Agents): https://venice.ai/blog/venice-x-fleek-building-the-first-end-to-end-solution-for-private-agents
- Venice $27M Incentive Fund: https://venice.ai/blog/venice-launches-27m-incentive-fund-to-advance-private-uncensored-ai-apps-agents-infrastructure
- OpenAI vs Venice Comparison: https://venice.ai/blog/openai-api-vs-venice-api-the-uncensored-privacy-first-alternative
- Building Agents with OpenClaw: https://venice.ai/blog/build-ai-agents-openclaw-venice-api
- Building Agents with ElizaOS: https://venice.ai/blog/how-to-build-a-social-media-ai-agent-with-elizaos-venice-api
- CoinMarketCap VVV Explainer: https://coinmarketcap.com/cmc-ai/venice-token/what-is/
- Venice API Spec: https://docs.venice.ai/api-reference/api-spec
- Chat Completions Endpoint: https://docs.venice.ai/api-reference/endpoint/chat/completions
- Reasoning Models Guide: https://docs.venice.ai/overview/guides/reasoning-models
- Structured Responses Guide: https://docs.venice.ai/overview/guides/structured-responses
- AI Agents Guide: https://docs.venice.ai/overview/guides/ai-agents
- Synthesis Hackathon: https://synthesis.md/hack
