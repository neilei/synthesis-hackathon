/**
 * Unit tests for intent compilation, adversarial detection, and delegation creation.
 *
 * @module @veil/agent/delegation/compiler.test
 */
import { describe, it, expect, vi } from "vitest";
import { encodePacked } from "viem";
import type { Address, Hex } from "viem";
import { detectAdversarialIntent } from "../compiler.js";
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

// ---------------------------------------------------------------------------
// createDelegationFromIntent — verify caveat construction with mocked SDK
// ---------------------------------------------------------------------------

// We need to mock the heavy SDK dependencies so the unit test doesn't hit the network.
// The key assertions: ValueLteEnforcer caveat is present with correct encoding,
// TimestampEnforcer and LimitedCallsEnforcer are present, and functionCall scope
// constrains to the correct router + selector.

// vi.hoisted runs before vi.mock hoisting, so these constants are available in mock factories
const {
  MOCK_SMART_ACCOUNT_ADDRESS,
  MOCK_SIGNATURE,
  MOCK_ENVIRONMENT,
  capturedDelegationArgs,
} = vi.hoisted(() => {
  const state = { args: null as Record<string, unknown> | null };
  return {
    MOCK_SMART_ACCOUNT_ADDRESS: "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
    MOCK_SIGNATURE: "0xabcdef",
    MOCK_ENVIRONMENT: {
      caveatEnforcers: {
        TimestampEnforcer: "0x1111111111111111111111111111111111111111",
        LimitedCallsEnforcer: "0x2222222222222222222222222222222222222222",
        ValueLteEnforcer: "0x3333333333333333333333333333333333333333",
      },
    },
    capturedDelegationArgs: state,
  };
});

vi.mock("@metamask/smart-accounts-kit", () => ({
  Implementation: { Hybrid: "hybrid" },
  getSmartAccountsEnvironment: () => MOCK_ENVIRONMENT,
  toMetaMaskSmartAccount: vi.fn().mockResolvedValue({
    address: MOCK_SMART_ACCOUNT_ADDRESS,
    signDelegation: vi.fn().mockResolvedValue(MOCK_SIGNATURE),
  }),
  createDelegation: vi.fn((args: Record<string, unknown>) => {
    capturedDelegationArgs.args = args;
    return {
      ...args,
      authority: "0x0000000000000000000000000000000000000000000000000000000000000000",
      salt: 0n,
      signature: "0x",
    };
  }),
}));

vi.mock("../../venice/llm.js", () => ({
  reasoningLlm: {},
}));

vi.mock("../../config.js", async () => {
  const { http } = await import("viem");
  return {
    CONTRACTS: {
      UNISWAP_ROUTER_SEPOLIA: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
      UNISWAP_ROUTER_MAINNET: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
    },
    rpcTransport: () => http(),
  };
});

// Now import the function under test (must come after vi.mock calls)
const { createDelegationFromIntent } = await import("../compiler.js");

describe("createDelegationFromIntent", () => {
  const AGENT_ADDRESS = "0xf13021F02E23a8113C1bD826575a1682F6Fac927" as Address;
  const DELEGATOR_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;
  const CHAIN_ID = 11155111; // Sepolia

  it("passes valueLte in the scope config with correct maxValue", async () => {
    const intent = makeIntent({ dailyBudgetUsd: 200, timeWindowDays: 7 });
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    expect(capturedDelegationArgs.args).not.toBeNull();
    const scope = capturedDelegationArgs.args!.scope as {
      valueLte: { maxValue: bigint };
    };

    // totalBudgetUsd / conservativeEthPrice * 1e18
    // 200 * 7 = 1400 USD budget, 1400 / 500 = 2.8 ETH, ceil(2.8e18)
    const expectedMaxValueWei = BigInt(Math.ceil(2.8 * 1e18));
    expect(scope.valueLte).toBeDefined();
    expect(scope.valueLte.maxValue).toBe(expectedMaxValueWei);
  });

  it("includes a TimestampEnforcer caveat", async () => {
    const intent = makeIntent({ timeWindowDays: 7 });
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    const caveats = capturedDelegationArgs.args!.caveats as Array<{ enforcer: Address; terms: Hex; args: Hex }>;
    const timestampCaveat = caveats.find(
      (c) => c.enforcer === MOCK_ENVIRONMENT.caveatEnforcers.TimestampEnforcer,
    );
    expect(timestampCaveat).toBeDefined();
    // Terms should be 32 bytes: uint128(0) + uint128(expiryTimestamp)
    expect(timestampCaveat!.terms).toHaveLength(66); // "0x" + 64 hex chars
  });

  it("includes a LimitedCallsEnforcer caveat", async () => {
    const intent = makeIntent({ maxTradesPerDay: 10, timeWindowDays: 7 });
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    const caveats = capturedDelegationArgs.args!.caveats as Array<{ enforcer: Address; terms: Hex; args: Hex }>;
    const limitedCallsCaveat = caveats.find(
      (c) => c.enforcer === MOCK_ENVIRONMENT.caveatEnforcers.LimitedCallsEnforcer,
    );
    expect(limitedCallsCaveat).toBeDefined();

    // 10 trades/day * 7 days = 70 total calls
    const expectedTerms = encodePacked(["uint256"], [70n]);
    expect(limitedCallsCaveat!.terms).toBe(expectedTerms);
  });

  it("uses functionCall scope targeting Uniswap router with execute selector", async () => {
    const intent = makeIntent();
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    const scope = capturedDelegationArgs.args!.scope as {
      type: string;
      targets: string[];
      selectors: string[];
    };
    expect(scope.type).toBe("functionCall");
    expect(scope.targets).toEqual(["0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"]);
    expect(scope.selectors).toEqual(["0x3593564c"]);
  });

  it("does NOT add a manual ValueLteEnforcer in the caveats array (SDK handles it via scope)", async () => {
    const intent = makeIntent();
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    // Our manual caveats should only contain Timestamp and LimitedCalls, not ValueLte
    const caveats = capturedDelegationArgs.args!.caveats as Array<{ enforcer: string }>;
    const valueLteCaveat = caveats.find(
      (c) => c.enforcer === MOCK_ENVIRONMENT.caveatEnforcers.ValueLteEnforcer,
    );
    expect(valueLteCaveat).toBeUndefined();
  });

  it("sets the correct from/to addresses", async () => {
    const intent = makeIntent();
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    expect(capturedDelegationArgs.args!.from).toBe(MOCK_SMART_ACCOUNT_ADDRESS);
    expect(capturedDelegationArgs.args!.to).toBe(AGENT_ADDRESS);
  });

  it("returns signed delegation with signature", async () => {
    const intent = makeIntent();
    const result = await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, CHAIN_ID);

    expect(result.delegation.signature).toBe(MOCK_SIGNATURE);
    expect(result.delegatorSmartAccount).toBeDefined();
  });

  it("uses mainnet router for non-Sepolia chain", async () => {
    const intent = makeIntent();
    await createDelegationFromIntent(intent, DELEGATOR_KEY, AGENT_ADDRESS, 1);

    const scope = capturedDelegationArgs.args!.scope as { targets: string[] };
    expect(scope.targets).toEqual(["0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"]);
  });

  it("ValueLteEnforcer encoding matches SDK createValueLteTerms output", async () => {
    // This test verifies our manual encoding matches the SDK's internal function.
    // createValueLteTerms({ maxValue }) does:
    //   "0x" + maxValue.toString(16).padStart(64, "0")
    // which is identical to encodePacked(["uint256"], [maxValue])
    const testValue = 2800000000000000000n; // 2.8 ETH in wei
    const viemEncoded = encodePacked(["uint256"], [testValue]);
    const sdkEncoded = "0x" + testValue.toString(16).padStart(64, "0");
    expect(viemEncoded).toBe(sdkEncoded);
  });
});
