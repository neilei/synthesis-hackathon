/**
 * Experiment: Test Venice TEE and E2EE models.
 *
 * Run: pnpm --filter @maw/agent exec tsx ../../scripts/test-venice-tee.ts
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { randomBytes } from "crypto";
import * as secp from "@noble/secp256k1";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

dotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
dotenvConfig({
  path: resolve(process.cwd(), "..", "..", ".env"),
  quiet: true,
});

const API_KEY = process.env.VENICE_API_KEY;
const BASE_URL = "https://api.venice.ai/api/v1";

if (!API_KEY) {
  console.error("VENICE_API_KEY not set");
  process.exit(1);
}

const hdrs = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const MODEL = "e2ee-qwen3-5-122b-a10b";

// ─── Test 1: Plain call — check if response is encrypted ───────────
async function testPlainCall(): Promise<boolean> {
  console.log(`\n=== Test 1: Plain call to ${MODEL} (no E2EE headers) ===`);
  console.log("  Purpose: see if response comes back encrypted or plaintext");
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Say hello world" }],
        max_tokens: 50,
        temperature: 0,
        stream: false,
      }),
    });

    const body = await res.text();
    console.log(`  Status: ${res.status}`);

    // Log all response headers
    console.log("  Response headers:");
    res.headers.forEach((v, k) => {
      if (
        k.includes("venice") ||
        k.includes("tee") ||
        k.includes("privacy")
      ) {
        console.log(`    ${k}: ${v}`);
      }
    });

    // Try to parse as JSON
    try {
      const data = JSON.parse(body);
      const content = data.choices?.[0]?.message?.content ?? "(no content)";
      console.log(`  Content (first 300 chars): ${content.slice(0, 300)}`);
      console.log(`  Content length: ${content.length}`);

      // Check if it looks like hex (encrypted)
      const isHex = /^[0-9a-f]+$/i.test(content.replace(/\s/g, ""));
      console.log(`  Looks like hex/encrypted: ${isHex}`);

      return res.ok;
    } catch {
      console.log(`  Raw body (first 500 chars): ${body.slice(0, 500)}`);
      return false;
    }
  } catch (err) {
    console.log(`  Error: ${err}`);
    return false;
  }
}

// ─── Test 2: TEE Attestation ───────────────────────────────────────
async function testAttestation(): Promise<{
  signingKey: string;
  signingAddress: string;
} | null> {
  console.log(`\n=== Test 2: TEE Attestation for ${MODEL} ===`);
  try {
    const nonce = randomBytes(32).toString("hex");
    const res = await fetch(
      `${BASE_URL}/tee/attestation?model=${MODEL}&nonce=${nonce}`,
      { headers: hdrs },
    );

    const data = await res.json();
    if (!res.ok) {
      console.log(`  Status: ${res.status} — ${JSON.stringify(data)}`);
      return null;
    }

    console.log(`  verified: ${data.verified}`);
    console.log(`  nonce match: ${data.nonce === nonce}`);
    console.log(`  tee_provider: ${data.tee_provider}`);
    console.log(`  signing_address: ${data.signing_address}`);
    console.log(
      `  signing_key (${data.signing_key?.length} chars): ${data.signing_key?.slice(0, 30)}...`,
    );
    console.log(
      `  intel_quote: ${data.intel_quote ? `present (${data.intel_quote.length} chars)` : "absent"}`,
    );

    if (!data.verified || data.nonce !== nonce) {
      console.log("  FAIL: Attestation not verified or nonce mismatch");
      return null;
    }

    return {
      signingKey: data.signing_key,
      signingAddress: data.signing_address,
    };
  } catch (err) {
    console.log(`  Error: ${err}`);
    return null;
  }
}

// ─── Test 3: Full E2EE flow ────────────────────────────────────────
async function testE2EE(): Promise<boolean> {
  console.log(`\n=== Test 3: Full E2EE flow for ${MODEL} ===`);

  // Step 1: Ephemeral keypair
  const privKey = secp.utils.randomSecretKey();
  const pubKey = secp.getPublicKey(privKey, false); // 65 bytes uncompressed
  const clientPubHex = Buffer.from(pubKey).toString("hex");
  console.log(`  Client pubkey: ${clientPubHex.length} hex chars`);

  // Step 2: Attestation
  const nonce = randomBytes(32).toString("hex");
  const attestRes = await fetch(
    `${BASE_URL}/tee/attestation?model=${MODEL}&nonce=${nonce}`,
    { headers: hdrs },
  );
  const attestData = await attestRes.json();

  if (!attestRes.ok || !attestData.verified) {
    console.log(`  Attestation failed: ${JSON.stringify(attestData)}`);
    return false;
  }

  const modelPubHex: string = attestData.signing_key;
  console.log(`  Model pubkey: ${modelPubHex.length} hex chars`);

  // Step 3: Encrypt user message
  const plaintext = "What is 2+2? Reply with just the number.";
  const encryptedMsg = await encryptForTee(
    plaintext,
    privKey,
    pubKey,
    modelPubHex,
  );
  console.log(
    `  Encrypted message: ${encryptedMsg.length} hex chars (min 186 required)`,
  );

  // Step 4: Send E2EE streaming request
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...hdrs,
      "X-Venice-TEE-Client-Pub-Key": clientPubHex,
      "X-Venice-TEE-Model-Pub-Key": modelPubHex,
      "X-Venice-TEE-Signing-Algo": "ecdsa",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: encryptedMsg }],
      max_tokens: 50,
      temperature: 0,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.log(`  Status: ${res.status}`);
    console.log(`  Error: ${errText.slice(0, 500)}`);
    return false;
  }

  console.log(`  Status: ${res.status} OK (streaming E2EE)`);

  // Step 5: Read and decrypt streaming chunks
  const reader = res.body?.getReader();
  if (!reader) return false;

  const decoder = new TextDecoder();
  const encChunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const d = line.slice(6);
      if (d === "[DONE]") continue;
      try {
        const parsed = JSON.parse(d);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) encChunks.push(delta);
      } catch {
        // skip malformed
      }
    }
  }

  console.log(`  Encrypted chunks received: ${encChunks.length}`);
  if (encChunks.length > 0) {
    console.log(
      `  First chunk (${encChunks[0]!.length} chars): ${encChunks[0]!.slice(0, 80)}...`,
    );
  }

  // Step 6: Decrypt chunks
  let decryptedFull = "";
  let decryptedCount = 0;
  let failedCount = 0;

  for (const chunk of encChunks) {
    try {
      const decrypted = await decryptFromTee(chunk, privKey);
      decryptedFull += decrypted;
      decryptedCount++;
    } catch (err) {
      failedCount++;
      if (failedCount <= 3) {
        console.log(
          `  Chunk decrypt error: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `  Decrypted: ${decryptedCount}/${encChunks.length} chunks (${failedCount} failed)`,
  );
  console.log(`  Decrypted text: "${decryptedFull}"`);

  return decryptedFull.length > 0;
}

// ─── Test 4: E2EE with JSON output ────────────────────────────────
async function testE2EEJson(): Promise<boolean> {
  console.log(`\n=== Test 4: E2EE with JSON output for ${MODEL} ===`);

  const privKey = secp.utils.randomSecretKey();
  const pubKey = secp.getPublicKey(privKey, false);
  const clientPubHex = Buffer.from(pubKey).toString("hex");

  const nonce = randomBytes(32).toString("hex");
  const attestRes = await fetch(
    `${BASE_URL}/tee/attestation?model=${MODEL}&nonce=${nonce}`,
    { headers: hdrs },
  );
  const attestData = await attestRes.json();
  if (!attestRes.ok || !attestData.verified) {
    console.log(`  Attestation failed`);
    return false;
  }
  const modelPubHex: string = attestData.signing_key;

  // Encrypt system message
  const systemMsg =
    'You are a JSON-only assistant. Always respond with valid JSON matching this schema: {"decision": "buy"|"sell"|"hold", "confidence": number 0-100, "reasoning": string}. No markdown, no extra text.';
  const userMsg =
    "ETH is at $2000, target is 60% ETH / 40% USDC, current is 50/50. Buy, sell, or hold ETH?";

  const encSystem = await encryptForTee(
    systemMsg,
    privKey,
    pubKey,
    modelPubHex,
  );
  const encUser = await encryptForTee(userMsg, privKey, pubKey, modelPubHex);

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...hdrs,
      "X-Venice-TEE-Client-Pub-Key": clientPubHex,
      "X-Venice-TEE-Model-Pub-Key": modelPubHex,
      "X-Venice-TEE-Signing-Algo": "ecdsa",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: encSystem },
        { role: "user", content: encUser },
      ],
      max_tokens: 300,
      temperature: 0,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.log(`  Status: ${res.status} — ${errText.slice(0, 500)}`);
    return false;
  }

  const reader = res.body?.getReader();
  if (!reader) return false;

  const decoder = new TextDecoder();
  const encChunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n").filter((l) => l.startsWith("data: "))) {
      const d = line.slice(6);
      if (d === "[DONE]") continue;
      try {
        const p = JSON.parse(d);
        const delta = p.choices?.[0]?.delta?.content;
        if (delta) encChunks.push(delta);
      } catch {
        /* skip */
      }
    }
  }

  // Decrypt all chunks
  let fullText = "";
  for (const chunk of encChunks) {
    try {
      fullText += await decryptFromTee(chunk, privKey);
    } catch {
      /* skip */
    }
  }

  console.log(`  Decrypted response: ${fullText.slice(0, 500)}`);

  // Try JSON parse
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`  Parsed JSON:`, parsed);
      return !!parsed.decision;
    } catch {
      console.log(`  JSON parse failed`);
      return false;
    }
  }

  console.log(`  No JSON found in decrypted response`);
  return false;
}

// ─── Crypto helpers ────────────────────────────────────────────────

async function encryptForTee(
  plaintext: string,
  _privKey: Uint8Array,
  pubKey: Uint8Array,
  modelPubHex: string,
): Promise<string> {
  // ECDH shared secret with model's public key
  const modelPubBytes = Uint8Array.from(Buffer.from(modelPubHex, "hex"));
  const sharedPoint = secp.getSharedSecret(_privKey, modelPubBytes);
  const sharedX = sharedPoint.slice(1, 33); // x-coordinate only

  // HKDF to derive AES key
  const aesKeyBytes = hkdf(
    sha256,
    sharedX,
    undefined,
    new TextEncoder().encode("ecdsa_encryption"),
    32,
  );

  // AES-256-GCM encrypt
  const iv = randomBytes(12);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );

  // Format: ephemeral_pub (65 bytes) + iv (12 bytes) + ciphertext+tag
  return Buffer.concat([
    Buffer.from(pubKey),
    iv,
    Buffer.from(ciphertext),
  ]).toString("hex");
}

async function decryptFromTee(
  encryptedHex: string,
  privKey: Uint8Array,
): Promise<string> {
  const raw = Buffer.from(encryptedHex, "hex");
  if (raw.length < 93) {
    // 65 (pub) + 12 (iv) + 16 (min GCM tag) = 93 minimum
    throw new Error(`Chunk too short: ${raw.length} bytes`);
  }

  const serverEphPub = raw.slice(0, 65);
  const iv = raw.slice(65, 77);
  const ciphertext = raw.slice(77);

  // ECDH with server's ephemeral public key
  const sharedPoint = secp.getSharedSecret(privKey, serverEphPub);
  const sharedX = sharedPoint.slice(1, 33);

  const aesKeyBytes = hkdf(
    sha256,
    sharedX,
    undefined,
    new TextEncoder().encode("ecdsa_encryption"),
    32,
  );

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKeyBytes,
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

// ─── Test 5: Prove crypto is real — wrong key must fail ────────────
async function testWrongKeyFails(): Promise<boolean> {
  console.log(`\n=== Test 5: Prove E2EE is real — wrong key MUST fail ===`);

  // Do a real E2EE call, get encrypted chunks, then try decrypting
  // with a DIFFERENT private key. If decryption succeeds, the crypto is fake.

  const realPrivKey = secp.utils.randomSecretKey();
  const realPubKey = secp.getPublicKey(realPrivKey, false);
  const clientPubHex = Buffer.from(realPubKey).toString("hex");

  const wrongPrivKey = secp.utils.randomSecretKey();
  console.log(`  Real privkey:  ${Buffer.from(realPrivKey).toString("hex").slice(0, 16)}...`);
  console.log(`  Wrong privkey: ${Buffer.from(wrongPrivKey).toString("hex").slice(0, 16)}...`);
  console.log(`  Keys differ: ${Buffer.from(realPrivKey).toString("hex") !== Buffer.from(wrongPrivKey).toString("hex")}`);

  // Attestation
  const nonce = randomBytes(32).toString("hex");
  const attestRes = await fetch(
    `${BASE_URL}/tee/attestation?model=${MODEL}&nonce=${nonce}`,
    { headers: hdrs },
  );
  const attestData = await attestRes.json();
  if (!attestRes.ok || !attestData.verified) {
    console.log(`  Attestation failed`);
    return false;
  }
  const modelPubHex: string = attestData.signing_key;

  // Encrypt and send with real key
  const encMsg = await encryptForTee(
    "What is 7 times 6? Reply with just the number.",
    realPrivKey,
    realPubKey,
    modelPubHex,
  );

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...hdrs,
      "X-Venice-TEE-Client-Pub-Key": clientPubHex,
      "X-Venice-TEE-Model-Pub-Key": modelPubHex,
      "X-Venice-TEE-Signing-Algo": "ecdsa",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: encMsg }],
      max_tokens: 50,
      temperature: 0,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.log(`  Request failed: ${res.status} — ${errText.slice(0, 300)}`);
    return false;
  }

  // Collect encrypted chunks
  const reader = res.body?.getReader();
  if (!reader) return false;

  const decoder = new TextDecoder();
  const encChunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n").filter((l) => l.startsWith("data: "))) {
      const d = line.slice(6);
      if (d === "[DONE]") continue;
      try {
        const p = JSON.parse(d);
        const delta = p.choices?.[0]?.delta?.content;
        if (delta) encChunks.push(delta);
      } catch { /* skip */ }
    }
  }

  console.log(`  Encrypted chunks: ${encChunks.length}`);

  // Try decrypt with CORRECT key
  let correctDecrypt = "";
  let correctOk = 0;
  for (const chunk of encChunks) {
    try {
      correctDecrypt += await decryptFromTee(chunk, realPrivKey);
      correctOk++;
    } catch { /* expected */ }
  }
  console.log(`  Correct key decrypt: ${correctOk}/${encChunks.length} chunks — "${correctDecrypt}"`);

  // Try decrypt with WRONG key — this MUST fail
  let wrongDecrypt = "";
  let wrongOk = 0;
  let wrongFail = 0;
  for (const chunk of encChunks) {
    try {
      wrongDecrypt += await decryptFromTee(chunk, wrongPrivKey);
      wrongOk++;
    } catch {
      wrongFail++;
    }
  }
  console.log(`  Wrong key decrypt: ${wrongOk}/${encChunks.length} succeeded, ${wrongFail} failed`);
  if (wrongDecrypt) {
    console.log(`  Wrong key produced: "${wrongDecrypt}" (THIS SHOULD NOT HAPPEN)`);
  }

  const cryptoIsReal = correctOk > 0 && wrongOk === 0;
  console.log(`  Crypto is real: ${cryptoIsReal ? "YES — wrong key fails, correct key works" : "NO — SUSPICIOUS"}`);
  return cryptoIsReal;
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log("Venice TEE/E2EE Experiment");
  console.log("=".repeat(60));

  const t1 = await testPlainCall();
  const attest = await testAttestation();
  const t3 = await testE2EE();
  const t4 = await testE2EEJson();
  const t5 = await testWrongKeyFails();

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Plain call (no headers):  ${t1 ? "PASS" : "FAIL"}`);
  console.log(`  TEE Attestation:          ${attest ? "PASS" : "FAIL"}`);
  console.log(`  Full E2EE (simple):       ${t3 ? "PASS" : "FAIL"}`);
  console.log(`  Full E2EE (JSON output):  ${t4 ? "PASS" : "FAIL"}`);
  console.log(`  Wrong key fails:          ${t5 ? "PASS" : "FAIL"}`);
}

main().catch(console.error);
