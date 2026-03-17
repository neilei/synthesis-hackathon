import { describe, it, expect } from "vitest";
import {
  generateNonce,
  createAuthToken,
  verifyAuthToken,
} from "../auth.js";

describe("auth", () => {
  describe("generateNonce", () => {
    it("returns a random string", () => {
      const nonce = generateNonce();
      expect(nonce.length).toBeGreaterThan(10);
    });

    it("returns different values each time", () => {
      const a = generateNonce();
      const b = generateNonce();
      expect(a).not.toBe(b);
    });
  });

  describe("createAuthToken / verifyAuthToken", () => {
    it("creates a token that can be verified", () => {
      const wallet = "0x1234567890abcdef1234567890abcdef12345678";
      const token = createAuthToken(wallet);
      const result = verifyAuthToken(token);
      expect(result).toBe(wallet.toLowerCase());
    });

    it("returns null for invalid token", () => {
      expect(verifyAuthToken("garbage")).toBeNull();
    });

    it("returns null for expired token", () => {
      const wallet = "0x1234567890abcdef1234567890abcdef12345678";
      const token = createAuthToken(wallet, -1);
      expect(verifyAuthToken(token)).toBeNull();
    });

    it("lowercases wallet address", () => {
      const wallet = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
      const token = createAuthToken(wallet);
      const result = verifyAuthToken(token);
      expect(result).toBe(wallet.toLowerCase());
    });
  });
});
