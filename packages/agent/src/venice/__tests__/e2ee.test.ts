/**
 * Unit tests for Venice E2EE crypto module — encrypt/decrypt round-trips,
 * wrong-key rejection, truncated ciphertext handling, and JSON extraction.
 *
 * @module @maw/agent/venice/e2ee.test
 */
import { describe, it, expect, vi } from "vitest";
import * as secp from "@noble/secp256k1";

// Mock config and budget so the module loads without real env vars
vi.mock("../../config.js", () => ({
  env: {
    VENICE_API_KEY: "test-key",
    VENICE_BASE_URL: "https://api.venice.ai/api/v1",
  },
}));

vi.mock("../../logging/budget.js", () => ({
  updateBudget: vi.fn(),
}));

// Import after mocks are set up
const { encryptForTee, decryptFromTee, extractJson } = await import(
  "../e2ee.js"
);

describe("e2ee crypto", () => {
  // Generate a stable keypair for tests
  const privKey = secp.utils.randomSecretKey();
  const pubKey = secp.getPublicKey(privKey, false);

  describe("encryptForTee", () => {
    it("produces hex output >= 186 chars (93 bytes minimum)", async () => {
      // Use our own pubkey as "model pubkey" for round-trip test
      const modelPubHex = Buffer.from(pubKey).toString("hex");
      const encrypted = await encryptForTee(
        "hello",
        privKey,
        pubKey,
        modelPubHex,
      );
      expect(encrypted.length).toBeGreaterThanOrEqual(186);
      expect(/^[0-9a-f]+$/.test(encrypted)).toBe(true);
    });

    it("starts with the ephemeral public key (130 hex chars = 65 bytes)", async () => {
      const modelPubHex = Buffer.from(pubKey).toString("hex");
      const encrypted = await encryptForTee(
        "test",
        privKey,
        pubKey,
        modelPubHex,
      );
      const pubKeyHex = Buffer.from(pubKey).toString("hex");
      expect(encrypted.startsWith(pubKeyHex)).toBe(true);
    });
  });

  describe("decryptFromTee", () => {
    it("round-trips encrypt then decrypt with same keypair", async () => {
      // When we encrypt targeting our own pubkey, decryptFromTee with
      // the same privkey produces the same shared secret via ECDH
      const modelPubHex = Buffer.from(pubKey).toString("hex");
      const plaintext = "The answer is 42";
      const encrypted = await encryptForTee(
        plaintext,
        privKey,
        pubKey,
        modelPubHex,
      );
      const decrypted = await decryptFromTee(encrypted, privKey);
      expect(decrypted).toBe(plaintext);
    });

    it("fails with wrong private key", async () => {
      const modelPubHex = Buffer.from(pubKey).toString("hex");
      const encrypted = await encryptForTee(
        "secret",
        privKey,
        pubKey,
        modelPubHex,
      );
      const wrongKey = secp.utils.randomSecretKey();
      await expect(decryptFromTee(encrypted, wrongKey)).rejects.toThrow();
    });

    it("fails with truncated ciphertext", async () => {
      await expect(decryptFromTee("aabbcc", privKey)).rejects.toThrow(
        /too short/i,
      );
    });
  });

  describe("extractJson", () => {
    it("extracts JSON object from clean response", () => {
      const text = '{"shouldRebalance": true, "reasoning": "test"}';
      expect(JSON.parse(extractJson(text))).toEqual({
        shouldRebalance: true,
        reasoning: "test",
      });
    });

    it("extracts JSON from response with preamble", () => {
      const text =
        'Here is the analysis:\n\n{"shouldRebalance": false, "reasoning": "drift low"}';
      expect(
        (JSON.parse(extractJson(text)) as { shouldRebalance: boolean })
          .shouldRebalance,
      ).toBe(false);
    });

    it("extracts JSON from markdown code block", () => {
      const text =
        '```json\n{"shouldRebalance": true, "reasoning": "high drift"}\n```';
      expect(
        (JSON.parse(extractJson(text)) as { shouldRebalance: boolean })
          .shouldRebalance,
      ).toBe(true);
    });

    it("handles nested objects", () => {
      const text =
        '{"shouldRebalance": true, "reasoning": "x", "targetSwap": {"sellToken": "ETH", "buyToken": "USDC", "sellAmount": "0.01", "maxSlippage": "0.005"}, "marketContext": null}';
      const parsed = JSON.parse(extractJson(text)) as {
        targetSwap: { sellToken: string };
      };
      expect(parsed.targetSwap.sellToken).toBe("ETH");
    });

    it("throws on no JSON found", () => {
      expect(() => extractJson("no json here")).toThrow(/no json/i);
    });
  });
});
