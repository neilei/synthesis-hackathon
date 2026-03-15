/**
 * @file Tests for token metadata — TOKEN_META, getTokenBg, getTokenLabelColor,
 * getTokenLabel.
 */
import { describe, it, expect } from "vitest";
import {
  TOKEN_META,
  getTokenBg,
  getTokenLabelColor,
  getTokenLabel,
} from "./tokens.js";

// ---------------------------------------------------------------------------
// TOKEN_META
// ---------------------------------------------------------------------------

describe("TOKEN_META", () => {
  it("has ETH entry", () => {
    expect(TOKEN_META.ETH).toBeDefined();
    expect(TOKEN_META.ETH.bg).toBe("bg-emerald-500");
    expect(TOKEN_META.ETH.labelColor).toBe("text-emerald-400");
    expect(TOKEN_META.ETH.label).toBe("ETH");
  });

  it("has WETH entry", () => {
    expect(TOKEN_META.WETH).toBeDefined();
    expect(TOKEN_META.WETH.bg).toBe("bg-emerald-500");
    expect(TOKEN_META.WETH.labelColor).toBe("text-emerald-400");
    expect(TOKEN_META.WETH.label).toBe("WETH");
  });

  it("has USDC entry", () => {
    expect(TOKEN_META.USDC).toBeDefined();
    expect(TOKEN_META.USDC.bg).toBe("bg-indigo-500");
    expect(TOKEN_META.USDC.labelColor).toBe("text-indigo-400");
    expect(TOKEN_META.USDC.label).toBe("USDC");
  });
});

// ---------------------------------------------------------------------------
// getTokenBg
// ---------------------------------------------------------------------------

describe("getTokenBg", () => {
  it("returns bg class for known token", () => {
    expect(getTokenBg("ETH")).toBe("bg-emerald-500");
  });

  it("returns bg class for USDC", () => {
    expect(getTokenBg("USDC")).toBe("bg-indigo-500");
  });

  it("normalizes to uppercase", () => {
    expect(getTokenBg("eth")).toBe("bg-emerald-500");
    expect(getTokenBg("usdc")).toBe("bg-indigo-500");
    expect(getTokenBg("Weth")).toBe("bg-emerald-500");
  });

  it("returns fallback bg-zinc-500 for unknown token", () => {
    expect(getTokenBg("DOGE")).toBe("bg-zinc-500");
    expect(getTokenBg("")).toBe("bg-zinc-500");
  });
});

// ---------------------------------------------------------------------------
// getTokenLabelColor
// ---------------------------------------------------------------------------

describe("getTokenLabelColor", () => {
  it("returns label color for known token", () => {
    expect(getTokenLabelColor("ETH")).toBe("text-emerald-400");
  });

  it("returns label color for USDC", () => {
    expect(getTokenLabelColor("USDC")).toBe("text-indigo-400");
  });

  it("normalizes to uppercase", () => {
    expect(getTokenLabelColor("eth")).toBe("text-emerald-400");
    expect(getTokenLabelColor("usdc")).toBe("text-indigo-400");
  });

  it("returns fallback text-zinc-400 for unknown token", () => {
    expect(getTokenLabelColor("DOGE")).toBe("text-zinc-400");
    expect(getTokenLabelColor("")).toBe("text-zinc-400");
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
