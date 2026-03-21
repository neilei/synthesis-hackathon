/**
 * Unit tests for intent compilation and adversarial detection.
 *
 * Note: createDelegationFromIntent was removed — delegation creation now
 * happens browser-side via ERC-7715 (MetaMask Flask). See redeemer.test.ts
 * for ERC-7710 pull-token tests.
 *
 * @module @maw/agent/delegation/compiler.test
 */
import { describe, it, expect } from "vitest";
import { detectAdversarialIntent } from "@maw/common";
import { makeIntent } from "../../__tests__/fixtures.js";

// ---------------------------------------------------------------------------
// Adversarial intent detection
// ---------------------------------------------------------------------------

describe("detectAdversarialIntent", () => {
  it("returns no warnings for a safe intent", () => {
    const intent = makeIntent();
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(0);
  });

  it("warns when dailyBudgetUsd exceeds $1,000", () => {
    const intent = makeIntent({ dailyBudgetUsd: 5000 });
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe("dailyBudgetUsd");
    expect(warnings[0]!.value).toBe(5000);
    expect(warnings[0]!.threshold).toBe(1000);
    expect(warnings[0]!.message).toContain("$5000");
    expect(warnings[0]!.message).toContain("$1,000");
  });

  it("warns when timeWindowDays exceeds 30", () => {
    const intent = makeIntent({ timeWindowDays: 90 });
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe("timeWindowDays");
    expect(warnings[0]!.value).toBe(90);
    expect(warnings[0]!.threshold).toBe(30);
    expect(warnings[0]!.message).toContain("90 days");
  });

  it("warns when maxSlippage exceeds 2%", () => {
    const intent = makeIntent({ maxSlippage: 0.05 });
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe("maxSlippage");
    expect(warnings[0]!.value).toBe(0.05);
    expect(warnings[0]!.threshold).toBe(0.02);
    expect(warnings[0]!.message).toContain("5.0%");
    expect(warnings[0]!.message).toContain("2%");
  });

  it("returns multiple warnings for multiple violations", () => {
    const intent = makeIntent({
      dailyBudgetUsd: 2000,
      timeWindowDays: 60,
      maxSlippage: 0.1,
    });
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(3);
    const fields = warnings.map((w) => w.field);
    expect(fields).toContain("dailyBudgetUsd");
    expect(fields).toContain("timeWindowDays");
    expect(fields).toContain("maxSlippage");
  });

  it("does not warn at exact threshold boundaries", () => {
    const intent = makeIntent({
      dailyBudgetUsd: 1000,
      timeWindowDays: 30,
      maxSlippage: 0.02,
    });
    const warnings = detectAdversarialIntent(intent);
    expect(warnings).toHaveLength(0);
  });
});
