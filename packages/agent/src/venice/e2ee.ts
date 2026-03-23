/**
 * Venice E2EE (end-to-end encryption) module.
 * Handles ECDH key exchange, AES-256-GCM encryption/decryption,
 * TEE attestation verification, and encrypted chat completions.
 *
 * Protocol:
 *   ECDH (secp256k1) -> shared x-coordinate -> HKDF-SHA256 -> AES-256-GCM
 *   Wire format: ephemeral_pub (65 bytes) + iv (12 bytes) + ciphertext (includes GCM tag)
 *   All encoded as hex strings on the wire.
 *
 * @module @maw/agent/venice/e2ee
 */
import { randomBytes } from "crypto";
import * as secp from "@noble/secp256k1";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { env } from "../config.js";
import { updateBudget } from "../logging/budget.js";

const HKDF_INFO = new TextEncoder().encode("ecdsa_encryption");
const BASE_URL = env.VENICE_BASE_URL.replace(/\/+$/, "");

/** The Venice E2EE reasoning model running inside an Intel TDX enclave. */
export const E2EE_REASONING_MODEL = "e2ee-qwen3-5-122b-a10b";

// ── Session ────────────────────────────────────────────────────────

/** Represents an authenticated E2EE session with a Venice TEE model. */
export interface E2eeSession {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
  modelPublicKeyHex: string;
  signingAddress: string;
  teeProvider: string;
  model: string;
}

/**
 * Create a new E2EE session by generating a client keypair and fetching
 * the TEE attestation (which provides the model's public key).
 *
 * @param model - The E2EE model to use (default: E2EE_REASONING_MODEL)
 * @returns Verified E2eeSession ready for encrypted chat
 * @throws If attestation fails or nonce verification fails
 */
export async function createE2eeSession(
  model: string = E2EE_REASONING_MODEL,
): Promise<E2eeSession> {
  const privateKey = secp.utils.randomSecretKey();
  const publicKey = secp.getPublicKey(privateKey, false); // 65 bytes uncompressed
  const publicKeyHex = Buffer.from(publicKey).toString("hex");

  // Fetch TEE attestation to get the model's public key
  const nonce = randomBytes(32).toString("hex");
  const res = await fetch(
    `${BASE_URL}/tee/attestation?model=${model}&nonce=${nonce}`,
    { headers: { Authorization: `Bearer ${env.VENICE_API_KEY}` } },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TEE attestation failed (${res.status}): ${body}`);
  }

  const data: {
    verified: boolean;
    nonce: string;
    signing_key: string;
    signing_address: string;
    tee_provider?: string;
  } = await res.json();

  if (!data.verified || data.nonce !== nonce) {
    throw new Error(
      `TEE attestation not verified (verified=${String(data.verified)}, nonce_match=${String(data.nonce === nonce)})`,
    );
  }

  return {
    privateKey,
    publicKey,
    publicKeyHex,
    modelPublicKeyHex: data.signing_key,
    signingAddress: data.signing_address,
    teeProvider: data.tee_provider ?? "unknown",
    model,
  };
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────

/**
 * Derive a 32-byte AES key from the ECDH shared x-coordinate via HKDF-SHA256.
 * Returns a fresh Uint8Array backed by a standard ArrayBuffer (not SharedArrayBuffer)
 * for compatibility with crypto.subtle.importKey's BufferSource parameter.
 */
function deriveAesKey(sharedX: Uint8Array): Uint8Array<ArrayBuffer> {
  const raw = hkdf(sha256, sharedX, undefined, HKDF_INFO, 32);
  return new Uint8Array(raw);
}

/**
 * Encrypt plaintext for a Venice TEE model.
 *
 * @param plaintext - The text to encrypt
 * @param privateKey - Client's secp256k1 private key
 * @param publicKey - Client's secp256k1 uncompressed public key (65 bytes)
 * @param modelPublicKeyHex - Model's public key as hex string (130 hex chars)
 * @returns Hex-encoded ciphertext: ephemeral_pub (65B) + iv (12B) + ciphertext+tag
 */
export async function encryptForTee(
  plaintext: string,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  modelPublicKeyHex: string,
): Promise<string> {
  const modelPubBytes = Uint8Array.from(Buffer.from(modelPublicKeyHex, "hex"));
  const sharedPoint = secp.getSharedSecret(privateKey, modelPubBytes);
  const aesKey = deriveAesKey(sharedPoint.slice(1, 33));

  const iv = randomBytes(12);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );

  return Buffer.concat([
    Buffer.from(publicKey),
    iv,
    Buffer.from(ciphertext),
  ]).toString("hex");
}

/**
 * Decrypt a hex-encoded E2EE response chunk from a Venice TEE model.
 *
 * @param encryptedHex - Hex string: server_ephemeral_pub (65B) + iv (12B) + ciphertext+tag
 * @param privateKey - Client's secp256k1 private key
 * @returns Decrypted plaintext
 * @throws If ciphertext is too short or decryption fails (wrong key, corrupted data)
 */
export async function decryptFromTee(
  encryptedHex: string,
  privateKey: Uint8Array,
): Promise<string> {
  const raw = Buffer.from(encryptedHex, "hex");
  // 65 (ephemeral pub) + 12 (iv) + 16 (min GCM tag) = 93 minimum
  if (raw.length < 93) {
    throw new Error(`Chunk too short for E2EE: ${raw.length} bytes (min 93)`);
  }

  const serverEphPub = raw.slice(0, 65);
  const iv = raw.slice(65, 77);
  const ciphertext = raw.slice(77);

  const sharedPoint = secp.getSharedSecret(privateKey, serverEphPub);
  const aesKey = deriveAesKey(sharedPoint.slice(1, 33));

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuf);
}

// ── JSON extraction ────────────────────────────────────────────────

/**
 * Extract a JSON object from LLM response text. Handles markdown code
 * fences, preamble text before the JSON, and nested objects.
 *
 * @param text - Raw LLM response text (may include preamble, code fences)
 * @returns The extracted JSON string (outermost `{...}`)
 * @throws If no JSON object is found in the text
 */
export function extractJson(text: string): string {
  // Strip markdown code fences if present
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `No JSON object found in E2EE response: ${text.slice(0, 200)}`,
    );
  }
  return match[0];
}

// ── Encrypted chat ─────────────────────────────────────────────────

/** A message to send via E2EE chat. */
interface E2eeChatMessage {
  role: "system" | "user";
  content: string;
}

/** Options for an E2EE chat request. */
interface E2eeChatOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Send an encrypted chat request to a Venice E2EE model and decrypt the
 * streaming response.
 *
 * Each message is individually encrypted with the session's keypair.
 * The response arrives as SSE chunks, each containing hex-encoded
 * ciphertext that is decrypted and concatenated.
 *
 * @param session - An authenticated E2EE session from createE2eeSession()
 * @param messages - Array of system/user messages to encrypt and send
 * @param options - Optional maxTokens and temperature overrides
 * @returns The full decrypted plaintext response
 * @throws If the API request fails or response body is missing
 */
export async function e2eeChat(
  session: E2eeSession,
  messages: E2eeChatMessage[],
  options: E2eeChatOptions = {},
): Promise<string> {
  // Encrypt each message content
  const encryptedMessages = await Promise.all(
    messages.map(async (msg) => ({
      role: msg.role,
      content: await encryptForTee(
        msg.content,
        session.privateKey,
        session.publicKey,
        session.modelPublicKeyHex,
      ),
    })),
  );

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VENICE_API_KEY}`,
      "Content-Type": "application/json",
      "X-Venice-TEE-Client-Pub-Key": session.publicKeyHex,
      "X-Venice-TEE-Model-Pub-Key": session.modelPublicKeyHex,
      "X-Venice-TEE-Signing-Algo": "ecdsa",
    },
    body: JSON.stringify({
      model: session.model,
      messages: encryptedMessages,
      max_tokens: options.maxTokens ?? 3000,
      temperature: options.temperature ?? 0,
      stream: true,
    }),
  });

  // Capture Venice billing header
  const balanceUsd = res.headers.get("x-venice-balance-usd");
  if (balanceUsd) updateBudget({ "x-venice-balance-usd": balanceUsd });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `E2EE chat failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  // Read streaming SSE response and decrypt each chunk
  const reader = res.body?.getReader();
  if (!reader) throw new Error("E2EE: no response body reader");

  const decoder = new TextDecoder();
  let decrypted = "";

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed: {
          choices?: Array<{ delta?: { content?: string } }>;
        } = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          decrypted += await decryptFromTee(delta, session.privateKey);
        }
      } catch {
        // Skip malformed SSE chunks
      }
    }
  }

  return decrypted;
}
