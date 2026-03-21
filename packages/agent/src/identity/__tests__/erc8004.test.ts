/**
 * Unit tests for ERC-8004 identity registration and reputation feedback.
 *
 * @module @maw/agent/identity/erc8004.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Mock dependencies — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockReadContract = vi.fn();
const mockWriteContract = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: mockWriteContract,
      chain: { id: 84532, name: "baseSepolia" },
      account: { address: "0xAgentAddress" as Address },
    })),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0xAgentAddress" as Address,
    type: "local" as const,
  })),
}));

vi.mock("../../config.js", () => ({
  env: {
    AGENT_PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
    JUDGE_PRIVATE_KEY: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as `0x${string}`,
  },
  CONTRACTS: {
    IDENTITY_BASE_SEPOLIA: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
    IDENTITY_BASE_MAINNET: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
    REPUTATION_BASE_SEPOLIA: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
    REPUTATION_BASE_MAINNET: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
    VALIDATION_BASE_SEPOLIA: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as Address,
    VALIDATION_BASE_MAINNET: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58" as Address,
  },
  rpcTransport: vi.fn().mockReturnValue("http-transport"),
}));

import { giveFeedback, getReputationSummary, registerAgent } from "../erc8004.js";

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockReadContract.mockReset();
  mockWriteContract.mockReset();
  mockWaitForTransactionReceipt.mockReset();
});

// ---------------------------------------------------------------------------
// giveFeedback
// ---------------------------------------------------------------------------

describe("giveFeedback", () => {
  it("calls writeContract on the reputation registry with correct args", async () => {
    const txHash = "0xfeedbackhash" as Hex;
    mockWriteContract.mockResolvedValue(txHash);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const result = await giveFeedback(42n, 4.5, "accuracy", "defi");

    expect(result).toBe(txHash);
    expect(mockWriteContract).toHaveBeenCalledTimes(1);

    const call = mockWriteContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713"); // REPUTATION_BASE_SEPOLIA
    expect(call.functionName).toBe("giveFeedback");

    // args: [agentId, scaledValue, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash]
    const args = call.args;
    expect(args[0]).toBe(42n); // agentId
    expect(args[1]).toBe(450n); // 4.5 * 10^2 = 450
    expect(args[2]).toBe(2); // valueDecimals
    expect(args[3]).toBe("accuracy"); // tag1
    expect(args[4]).toBe("defi"); // tag2
    expect(args[5]).toBe(""); // endpoint
    expect(args[6]).toBe(""); // feedbackURI
    expect(args[7]).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ); // feedbackHash
  });

  it.each([
    [3, 300n, "integer"],
    [-2.5, -250n, "negative"],
    [4.555, 456n, "fractional with rounding"],
  ] as const)(
    "scales value %f to %s (%s)",
    async (input, expected, _label) => {
      mockWriteContract.mockResolvedValue("0xhash" as Hex);
      mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
      await giveFeedback(1n, input, "tag");
      const args = mockWriteContract.mock.calls[0][0].args;
      expect(args[1]).toBe(expected);
    },
  );

  it("defaults tag2 to empty string", async () => {
    mockWriteContract.mockResolvedValue("0xhash" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    await giveFeedback(1n, 5, "speed");

    const args = mockWriteContract.mock.calls[0][0].args;
    expect(args[4]).toBe(""); // tag2 default
  });

  it("waits for transaction receipt", async () => {
    const txHash = "0xwaitforme" as Hex;
    mockWriteContract.mockResolvedValue(txHash);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    await giveFeedback(10n, 1, "test");

    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: txHash,
    });
  });

  it("uses base-mainnet reputation contract when target is 'base'", async () => {
    mockWriteContract.mockResolvedValue("0xhash" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    await giveFeedback(1n, 5, "tag", "", "base");

    const call = mockWriteContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"); // REPUTATION_BASE_MAINNET
  });

});

// ---------------------------------------------------------------------------
// getReputationSummary
// ---------------------------------------------------------------------------

describe("getReputationSummary", () => {
  it("calls readContract with correct args and returns correct shape", async () => {
    mockReadContract.mockResolvedValue([5n, 2250n, 2]);

    const result = await getReputationSummary(
      42n,
      ["0xClient1" as Address, "0xClient2" as Address],
      "accuracy",
      "defi",
    );

    expect(mockReadContract).toHaveBeenCalledTimes(1);

    const call = mockReadContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713"); // REPUTATION_BASE_SEPOLIA
    expect(call.functionName).toBe("getSummary");
    expect(call.args[0]).toBe(42n); // agentId
    expect(call.args[1]).toEqual(["0xClient1", "0xClient2"]); // clientAddresses
    expect(call.args[2]).toBe("accuracy"); // tag1
    expect(call.args[3]).toBe("defi"); // tag2

    // Return shape
    expect(result).toEqual({
      count: 5n,
      summaryValue: 2250n,
      summaryValueDecimals: 2,
    });
  });

  it("defaults tag1 and tag2 to empty strings", async () => {
    mockReadContract.mockResolvedValue([0n, 0n, 0]);

    await getReputationSummary(1n, []);

    const call = mockReadContract.mock.calls[0][0];
    expect(call.args[2]).toBe(""); // tag1 default
    expect(call.args[3]).toBe(""); // tag2 default
  });

  it("handles empty client addresses", async () => {
    mockReadContract.mockResolvedValue([0n, 0n, 2]);

    const result = await getReputationSummary(99n, []);

    const call = mockReadContract.mock.calls[0][0];
    expect(call.args[1]).toEqual([]);
    expect(result.count).toBe(0n);
  });

  it("uses base-mainnet reputation contract when target is 'base'", async () => {
    mockReadContract.mockResolvedValue([1n, 500n, 2]);

    await getReputationSummary(1n, [], "", "", "base");

    const call = mockReadContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"); // REPUTATION_BASE_MAINNET
  });

  it("returns bigint types for count and summaryValue", async () => {
    mockReadContract.mockResolvedValue([10n, 4500n, 2]);

    const result = await getReputationSummary(5n, []);

    expect(typeof result.count).toBe("bigint");
    expect(typeof result.summaryValue).toBe("bigint");
    expect(typeof result.summaryValueDecimals).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// registerAgent
// ---------------------------------------------------------------------------

describe("registerAgent", () => {
  it("calls writeContract on the identity registry", async () => {
    const txHash = "0xregisterhash" as Hex;
    mockWriteContract.mockResolvedValue(txHash);
    // Registered(uint256 indexed agentId, string agentURI, address indexed owner)
    const REGISTERED_EVENT_SIG =
      "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [
        // ERC-721 Transfer event (should be skipped)
        { topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0", "0xowner", "0x7"] },
        // Registered event (should be matched)
        { topics: [REGISTERED_EVENT_SIG, "0x7", "0xowner"] },
      ],
    });

    const result = await registerAgent("ipfs://QmAgentURI");

    expect(mockWriteContract).toHaveBeenCalledTimes(1);

    const call = mockWriteContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004A818BFB912233c491871b3d84c89A494BD9e"); // IDENTITY_BASE_SEPOLIA
    expect(call.functionName).toBe("register");
    expect(call.args[0]).toBe("ipfs://QmAgentURI");

    expect(result.txHash).toBe(txHash);
    expect(result.agentId).toBe(7n);
  });

  it("returns undefined agentId when no topics in logs", async () => {
    mockWriteContract.mockResolvedValue("0xhash" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [],
    });

    const result = await registerAgent("ipfs://test");

    expect(result.agentId).toBeUndefined();
  });

  it("uses base-mainnet identity contract when target is 'base'", async () => {
    mockWriteContract.mockResolvedValue("0xhash" as Hex);
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [],
    });

    await registerAgent("ipfs://test", "base");

    const call = mockWriteContract.mock.calls[0][0];
    expect(call.address).toBe("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"); // IDENTITY_BASE_MAINNET
  });
});
