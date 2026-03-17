/**
 * @file Tests for shared constants — AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS.
 */
import { describe, it, expect } from "vitest";
import { AGENT_ADDRESS, DEFAULT_AGENT_PORT, API_PATHS } from "../constants.js";

describe("AGENT_ADDRESS", () => {
  it("is the correct checksummed Ethereum address", () => {
    expect(AGENT_ADDRESS).toBe("0xf13021F02E23a8113C1bD826575a1682F6Fac927");
  });

});

describe("DEFAULT_AGENT_PORT", () => {
  it("is 3147", () => {
    expect(DEFAULT_AGENT_PORT).toBe(3147);
  });

});

describe("API_PATHS", () => {
  it("has auth and intent paths", () => {
    expect(API_PATHS.authNonce).toBe("/api/auth/nonce");
    expect(API_PATHS.authVerify).toBe("/api/auth/verify");
    expect(API_PATHS.parseIntent).toBe("/api/parse-intent");
    expect(API_PATHS.intents).toBe("/api/intents");
  });

  it("is a frozen object (immutable)", () => {
    expect(Object.isFrozen(API_PATHS)).toBe(true);
  });
});
