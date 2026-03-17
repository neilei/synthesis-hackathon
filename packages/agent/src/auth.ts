import { randomBytes, createHmac } from "node:crypto";

export const NONCE_TTL_SECONDS = 300; // 5 minutes
const TOKEN_TTL_SECONDS = 86_400; // 24 hours

// Secret for HMAC token signing — generated per server lifecycle
const TOKEN_SECRET = randomBytes(32).toString("hex");

export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export function createAuthToken(
  walletAddress: string,
  ttlSeconds = TOKEN_TTL_SECONDS,
): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${walletAddress.toLowerCase()}:${expires}`;
  const sig = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyAuthToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64").toString();
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;

    const [wallet, expiresStr, sig] = parts;
    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires)) return null;

    // Check expiry
    if (Math.floor(Date.now() / 1000) > expires) return null;

    // Verify signature
    const payload = `${wallet}:${expiresStr}`;
    const expected = createHmac("sha256", TOKEN_SECRET)
      .update(payload)
      .digest("hex");
    if (sig !== expected) return null;

    return wallet;
  } catch {
    return null;
  }
}
