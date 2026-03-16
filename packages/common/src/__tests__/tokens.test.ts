/**
 * @file Tests for token metadata — TOKEN_META, getTokenBg, getTokenLabelColor,
 * getTokenLabel.
 */
import { describe, it, expect } from "vitest";
import {
  getTokenBg,
  getTokenLabelColor,
  getTokenLabel,
} from "../tokens.js";

// ---------------------------------------------------------------------------
// getTokenBg / getTokenLabelColor
// ---------------------------------------------------------------------------

describe.each([
  ["getTokenBg", getTokenBg, { ETH: "bg-emerald-500", USDC: "bg-indigo-500" }, "bg-zinc-500"],
  ["getTokenLabelColor", getTokenLabelColor, { ETH: "text-emerald-400", USDC: "text-indigo-400" }, "text-zinc-400"],
] as const)("%s", (_name, fn, expected, fallback) => {
  it("returns correct value for ETH", () => {
    expect(fn("ETH")).toBe(expected.ETH);
  });

  it("returns correct value for USDC", () => {
    expect(fn("USDC")).toBe(expected.USDC);
  });

  it("normalizes to uppercase", () => {
    expect(fn("eth")).toBe(expected.ETH);
  });

  it("returns fallback for unknown token", () => {
    expect(fn("DOGE")).toBe(fallback);
    expect(fn("")).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// getTokenLabel
// ---------------------------------------------------------------------------

describe("getTokenLabel", () => {
  it("returns label for known token", () => {
    expect(getTokenLabel("ETH")).toBe("ETH");
    expect(getTokenLabel("WETH")).toBe("WETH");
    expect(getTokenLabel("USDC")).toBe("USDC");
  });

  it("normalizes to uppercase", () => {
    expect(getTokenLabel("eth")).toBe("ETH");
    expect(getTokenLabel("weth")).toBe("WETH");
  });

  it("returns the input (uppercased) for unknown token", () => {
    expect(getTokenLabel("doge")).toBe("DOGE");
    expect(getTokenLabel("SHIB")).toBe("SHIB");
  });
});
