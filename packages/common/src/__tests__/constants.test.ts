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
  it("has a state path", () => {
    expect(API_PATHS.state).toBe("/api/state");
  });

  it("has a deploy path", () => {
    expect(API_PATHS.deploy).toBe("/api/deploy");
  });

  it("is a frozen object (immutable)", () => {
    expect(Object.isFrozen(API_PATHS)).toBe(true);
  });
});
