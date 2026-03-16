/**
 * E2E tests for ERC-8004 ABI correctness against live Base Sepolia contracts.
 *
 * Tests every function in our handwritten ABI fragments against the deployed
 * Identity and Reputation registries. Sequential — later tests depend on
 * state created by earlier ones (e.g. register → setAgentURI → setMetadata).
 *
 * Hits real Base Sepolia RPC — no mocks. Wallet must be funded with ETH on
 * Base Sepolia for write operations.
 *
 * @module @veil/agent/identity/erc8004.e2e.test
 */
import { describe, it, expect } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  toEventSelector,
  toHex,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  IDENTITY_REGISTRY_ABI_HUMAN,
  REPUTATION_REGISTRY_ABI_HUMAN,
} from "@veil/common";
import { env, CONTRACTS } from "../../config.js";

// ---------------------------------------------------------------------------
// Parse the shared ABI fragments — this is what we're validating
// ---------------------------------------------------------------------------

const identityRegistryAbi = parseAbi(IDENTITY_REGISTRY_ABI_HUMAN);
const reputationRegistryAbi = parseAbi(REPUTATION_REGISTRY_ABI_HUMAN);

// ERC-721 Transfer event: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
const TRANSFER_EVENT_SIG = toEventSelector(
  "Transfer(address,address,uint256)",
);

/** Extract the minted tokenId (agentId) from an ERC-721 Transfer event in receipt logs. */
function extractMintedAgentId(logs: Log[]): bigint {
  for (const log of logs) {
    if (
      log.topics[0] === TRANSFER_EVENT_SIG &&
      log.topics[1] ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      // topics[3] is the tokenId for Transfer(from, to, tokenId)
      return BigInt(log.topics[3]!);
    }
  }
  throw new Error("No ERC-721 Transfer (mint) event found in logs");
}

// ---------------------------------------------------------------------------
// Shared clients
// ---------------------------------------------------------------------------

const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

const identityAddress = CONTRACTS.IDENTITY_BASE_SEPOLIA;
const reputationAddress = CONTRACTS.REPUTATION_BASE_SEPOLIA;

// ---------------------------------------------------------------------------
// Shared state across sequential tests
// ---------------------------------------------------------------------------

let registeredAgentId: bigint;
let noUriAgentId: bigint;
let feedbackIndex: bigint;

// ---------------------------------------------------------------------------
// All tests in a single describe to guarantee sequential execution.
// Write transactions share a wallet, so nonce ordering matters.
// ---------------------------------------------------------------------------

describe("ERC-8004 ABI E2E (Base Sepolia)", () => {
  // --- Identity Registry ---

  it("register(string) mints an NFT and returns a valid agentId", async () => {
    const testUri = `https://example.com/e2e-test-${Date.now()}.json`;

    const hash = await walletClient.writeContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [testUri],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    registeredAgentId = extractMintedAgentId(receipt.logs);
    expect(registeredAgentId).toBeGreaterThan(0n);
  });

  it("register() mints an NFT without a URI", async () => {
    const hash = await walletClient.writeContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    noUriAgentId = extractMintedAgentId(receipt.logs);
    expect(noUriAgentId).toBeGreaterThan(0n);
    expect(noUriAgentId).not.toBe(registeredAgentId);
  });

  it("setAgentURI updates the URI on an agent we own", async () => {
    const newUri = `https://example.com/updated-${Date.now()}.json`;

    const hash = await walletClient.writeContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "setAgentURI",
      args: [registeredAgentId, newUri],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });

  it("setMetadata writes a key-value pair on an agent we own", async () => {
    const metadataValue = toHex("veil-e2e-test");

    const hash = await walletClient.writeContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "setMetadata",
      args: [registeredAgentId, "e2e-test-key", metadataValue],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });

  it("getMetadata returns bytes without reverting", async () => {
    const result = await publicClient.readContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "getMetadata",
      args: [registeredAgentId, "e2e-test-key"],
    });

    // ABI correctness: returns a hex string (bytes), doesn't revert
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^0x/);
  });

  // --- Reputation Registry ---

  it("giveFeedback writes feedback on-chain", async () => {
    // Give feedback to agentId 1 (not our own agent — contract forbids self-feedback)
    const hash = await walletClient.writeContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [
        1n,
        450n, // value: 4.50 with 2 decimals
        2, // valueDecimals
        "abi-e2e",
        "test",
        "", // endpoint
        "", // feedbackURI
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      ],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });

  it("getLastIndex returns the latest feedback index for our address", async () => {
    const result = await publicClient.readContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "getLastIndex",
      args: [1n, account.address],
    });

    expect(typeof result).toBe("bigint");
    expect(result).toBeGreaterThanOrEqual(1n);
    feedbackIndex = result;
  });

  it("readFeedback returns the feedback we just submitted", async () => {
    const [value, valueDecimals, tag1, tag2, isRevoked] =
      await publicClient.readContract({
        address: reputationAddress,
        abi: reputationRegistryAbi,
        functionName: "readFeedback",
        args: [1n, account.address, feedbackIndex],
      });

    expect(value).toBe(450n);
    expect(valueDecimals).toBe(2);
    expect(tag1).toBe("abi-e2e");
    expect(tag2).toBe("test");
    expect(isRevoked).toBe(false);
  });

  it("getClients returns an array that includes our address", async () => {
    const clients = await publicClient.readContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [1n],
    });

    expect(Array.isArray(clients)).toBe(true);
    const lowered = clients.map((a) => a.toLowerCase());
    expect(lowered).toContain(account.address.toLowerCase());
  });

  it("getSummary returns aggregated feedback stats", async () => {
    const [count, summaryValue, summaryValueDecimals] =
      await publicClient.readContract({
        address: reputationAddress,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [1n, [account.address], "", ""],
      });

    expect(typeof count).toBe("bigint");
    expect(count).toBeGreaterThanOrEqual(1n);
    expect(typeof summaryValue).toBe("bigint");
    expect(typeof summaryValueDecimals).toBe("number");
  });

  it("revokeFeedback succeeds on-chain", async () => {
    const hash = await walletClient.writeContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "revokeFeedback",
      args: [1n, feedbackIndex],
      chain: baseSepolia,
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });
});
