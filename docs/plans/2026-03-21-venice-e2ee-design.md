# Venice E2EE Integration — Design

**Date:** 2026-03-21
**Status:** Approved

---

## Problem

The current Venice integration sets `enable_e2ee: true` in `venice_parameters`, but this is not a real Venice API parameter — it's silently ignored. All three LLM tiers run in Venice's "Private" mode (zero-data-retention by contract, not by cryptography). The privacy claim in the demo script and README is technically inaccurate.

Venice offers real E2EE via `e2ee-*` model prefixes + client-side ECDH encryption. Prompts are encrypted before leaving our server and only decrypted inside an Intel TDX hardware enclave on NEAR AI Cloud. This is provable via TEE attestation.

## Solution

Integrate real E2EE on the **reasoning tier only**. The reasoning tier makes the most sensitive decisions (should I trade? how much? what's the portfolio drift?) and doesn't need web search, function calling, or response schemas — all features disabled under E2EE.

### What changes

| Component | Before | After |
|-----------|--------|-------|
| Reasoning model | `gemini-3-flash-preview` (Private mode) | `e2ee-qwen3-5-122b-a10b` (E2EE mode, Qwen 3.5 122B) |
| Crypto | None (`enable_e2ee: true` is a no-op) | ECDH secp256k1 + HKDF-SHA256 + AES-256-GCM |
| Attestation | None | Intel TDX quote via NEAR AI Cloud, verified per session |
| Structured output | LangChain `withStructuredOutput(zodSchema)` | System prompt engineering + manual JSON extraction + `safeParse()` |
| Fast tier | `qwen3-5-9b` | No change |
| Research tier | `qwen3-5-9b` with web search | No change |

### What doesn't change

- Fast and research tiers stay on their current models and LangChain flow
- The agent loop structure is unchanged
- Dashboard, API server, delegation flow — all untouched

## Architecture

### New module: `packages/agent/src/venice/e2ee.ts`

```
E2eeSession {
  privateKey: Uint8Array        // ephemeral secp256k1 private key
  publicKey: Uint8Array         // corresponding uncompressed public key (65 bytes)
  publicKeyHex: string          // hex-encoded public key (130 chars)
  modelPublicKeyHex: string     // model's public key from attestation
  signingAddress: string        // Ethereum address of TEE enclave
  teeProvider: string           // "near-ai"
  model: string                 // "e2ee-qwen3-5-122b-a10b"
}

createE2eeSession(model: string): Promise<E2eeSession>
  1. Generate ephemeral secp256k1 keypair
  2. Fetch TEE attestation with random 32-byte nonce
  3. Verify: attestation.verified === true, nonce matches
  4. Return session with model's public key

encryptMessage(session, plaintext): Promise<string>
  1. ECDH shared secret (our privkey × model pubkey)
  2. HKDF-SHA256 derive AES-256 key
  3. AES-256-GCM encrypt with random 12-byte IV
  4. Return hex: ephemeral_pub (65B) + iv (12B) + ciphertext

decryptChunk(session, encryptedHex): Promise<string>
  1. Parse: server_ephemeral_pub (65B) + iv (12B) + ciphertext
  2. ECDH shared secret (our privkey × server ephemeral pubkey)
  3. HKDF-SHA256 derive AES-256 key
  4. AES-256-GCM decrypt
  5. Return plaintext string

e2eeChat(session, messages, options): Promise<string>
  1. Encrypt each message content
  2. POST /chat/completions with E2EE headers + stream: true
  3. Read SSE chunks, decrypt each
  4. Concatenate and return full plaintext response
```

### Dependencies

- `@noble/secp256k1` — ECDH key exchange (already installed in experiment)
- `@noble/hashes` — HKDF-SHA256 key derivation (already installed in experiment)
- `crypto.subtle` — AES-256-GCM (built into Node.js)

### Changes to `packages/agent/src/venice/llm.ts`

- Remove `enable_e2ee: true` from `baseVeniceParams` (it's a no-op)
- Add `E2EE_REASONING_MODEL` export
- Keep `reasoningLlm` export for any non-E2EE uses (e.g., tests with VENICE_MODEL_OVERRIDE)

### Changes to agent loop call sites

The reasoning LLM is invoked via `reasoningLlm.withStructuredOutput(schema).invoke(messages)`. With E2EE:

```typescript
// Before
const result = await reasoningLlm.withStructuredOutput(schema).invoke(messages);

// After
const rawText = await e2eeChat(session, messages, { maxTokens: 3000 });
const jsonStr = extractJson(rawText);  // regex to find {...} in response
const result = schema.safeParse(JSON.parse(jsonStr));
```

A helper `extractJson(text: string): string` handles extracting JSON from model output that may include preamble text.

### Error handling

No fallback. If E2EE fails (attestation unreachable, decryption error, model unavailable), the error propagates up. The agent loop's existing retry/error handling deals with it. This prevents silent degradation to unencrypted mode.

### Session lifecycle

- One `E2eeSession` created per `AgentWorker` at startup
- Reused across all reasoning calls for that worker's lifetime
- If a call fails due to a stale session (attestation expired), the worker creates a new session and retries once

### Logging

The agent loop already logs every LLM call. E2EE calls add:
- `e2ee: true` field on reasoning log entries
- `teeProvider` and `signingAddress` fields
- Encrypted payload size (proves the content was actually encrypted)
- These naturally appear in the dashboard activity feed

The startup `privacy_guarantee` log entry is updated to reference E2EE + TEE attestation.

## Testing

| Test | Type | What it proves |
|------|------|---------------|
| `e2ee.test.ts` — encrypt/decrypt round-trip | Unit | Crypto helpers work correctly |
| `e2ee.test.ts` — wrong key fails | Unit | Crypto is real, not passthrough |
| `e2ee.test.ts` — session creation with mocked attestation | Unit | Session setup logic |
| `e2ee.e2e.test.ts` — real E2EE call | E2E | Full flow works against Venice API |
| `e2ee.e2e.test.ts` — JSON output from E2EE model | E2E | Structured output via prompt engineering works |

## Documentation updates

- `CLAUDE.md` — Venice multi-model section: add E2EE reasoning model, remove `enable_e2ee` reference
- `docs/sponsor-prize-audit.md` — Venice section: E2EE is now real, score update
- `README.md` — privacy section: mention TEE attestation, hardware enclave

## Experiment proof

All crypto verified in `scripts/test-venice-tee.ts`:
- Plain call to E2EE model → response is empty without crypto headers (proves encryption is mandatory)
- TEE attestation → verified by NEAR AI, Intel TDX quote present (10K chars)
- Full E2EE simple call → encrypted, decrypted successfully ("4" for 2+2)
- Full E2EE JSON call → structured JSON output works via prompt engineering
- Wrong key test → correct key decrypts, wrong key fails 100% (proves crypto is real)
