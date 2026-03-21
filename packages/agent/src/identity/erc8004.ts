/**
 * ERC-8004 on-chain agent identity (NFT registration), reputation feedback,
 * and validation registry interactions on Base. Called at agent startup for
 * registration, and after each swap for judge-driven validation + feedback.
 *
 * @module @maw/agent/identity/erc8004
 */
import {
  createPublicClient,
  createWalletClient,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  IDENTITY_REGISTRY_ABI_HUMAN,
  REPUTATION_REGISTRY_ABI_HUMAN,
  VALIDATION_REGISTRY_ABI_HUMAN,
} from "@maw/common";
import { env, CONTRACTS, rpcTransport } from "../config.js";

// ---------------------------------------------------------------------------
// ABI fragments for ERC-8004 registries (sourced from @maw/common)
// ---------------------------------------------------------------------------

const identityRegistryAbi = parseAbi(IDENTITY_REGISTRY_ABI_HUMAN);
const reputationRegistryAbi = parseAbi(REPUTATION_REGISTRY_ABI_HUMAN);
const validationRegistryAbi = parseAbi(VALIDATION_REGISTRY_ABI_HUMAN);

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

type ChainTarget = "base-sepolia" | "base";

function getChainConfig(target: ChainTarget) {
  const chain = target === "base" ? base : baseSepolia;
  const identity =
    target === "base"
      ? CONTRACTS.IDENTITY_BASE_MAINNET
      : CONTRACTS.IDENTITY_BASE_SEPOLIA;
  const reputation =
    target === "base"
      ? CONTRACTS.REPUTATION_BASE_MAINNET
      : CONTRACTS.REPUTATION_BASE_SEPOLIA;
  const validation =
    target === "base"
      ? CONTRACTS.VALIDATION_BASE_MAINNET
      : CONTRACTS.VALIDATION_BASE_SEPOLIA;

  return { chain, identity, reputation, validation };
}

function getClients(target: ChainTarget) {
  const { chain } = getChainConfig(target);
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain,
    transport: rpcTransport(target),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: rpcTransport(target),
  });

  return { publicClient, walletClient, account };
}

// ---------------------------------------------------------------------------
// Register agent identity (mint NFT)
// ---------------------------------------------------------------------------

export async function registerAgent(
  agentURI: string,
  target: ChainTarget = "base-sepolia",
): Promise<{ txHash: Hex; agentId?: bigint }> {
  const config = getChainConfig(target);
  const { publicClient, walletClient, account } = getClients(target);

  const hash = await walletClient.writeContract({
    address: config.identity,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [agentURI],
    chain: walletClient.chain,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract agentId from the Registered event (not Transfer or other events).
  // Registered(uint256 indexed agentId, string agentURI, address indexed owner)
  // Event sig: keccak256("Registered(uint256,string,address)")
  const REGISTERED_EVENT_SIG =
    "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
  let agentId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.topics[0] === REGISTERED_EVENT_SIG && log.topics[1]) {
      agentId = BigInt(log.topics[1]);
      break;
    }
  }

  return { txHash: hash, agentId };
}

// ---------------------------------------------------------------------------
// Give feedback to another agent
// ---------------------------------------------------------------------------

export async function giveFeedback(
  agentId: bigint,
  value: number,
  tag1: string,
  tag2: string = "",
  target: ChainTarget = "base-sepolia",
  feedbackURI: string = "",
  feedbackHash: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000",
): Promise<Hex> {
  const config = getChainConfig(target);
  // Use judge wallet — agent wallet owns the agentId and the reputation
  // registry rejects self-feedback ("Self-feedback not allowed").
  const { publicClient, walletClient, account } = getJudgeClients(target);

  // Convert value to int128 with 2 decimals (e.g. 4.5 → 450)
  const valueDecimals = 2;
  const scaledValue = BigInt(Math.round(value * 10 ** valueDecimals));

  const hash = await walletClient.writeContract({
    address: config.reputation,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      scaledValue,
      valueDecimals,
      tag1,
      tag2,
      "", // endpoint
      feedbackURI,
      feedbackHash,
    ],
    chain: walletClient.chain,
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------------------
// Judge wallet client (uses JUDGE_PRIVATE_KEY for validation responses)
// ---------------------------------------------------------------------------

function getJudgeClients(target: ChainTarget) {
  if (!env.JUDGE_PRIVATE_KEY) {
    throw new Error("JUDGE_PRIVATE_KEY is required for validation operations");
  }
  const { chain } = getChainConfig(target);
  const account = privateKeyToAccount(env.JUDGE_PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain,
    transport: rpcTransport(target),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: rpcTransport(target),
  });

  return { publicClient, walletClient, account };
}

// ---------------------------------------------------------------------------
// Submit validation request (agent wallet — requests evaluation)
// ---------------------------------------------------------------------------

export async function submitValidationRequest(
  agentId: bigint,
  validatorAddress: Address,
  requestURI: string,
  requestHash: Hex,
  target: ChainTarget = "base-sepolia",
): Promise<Hex> {
  const config = getChainConfig(target);
  const { publicClient, walletClient, account } = getClients(target);

  const hash = await walletClient.writeContract({
    address: config.validation,
    abi: validationRegistryAbi,
    functionName: "validationRequest",
    args: [validatorAddress, agentId, requestURI, requestHash],
    chain: walletClient.chain,
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------------------
// Submit validation response (judge wallet — responds to request)
// ---------------------------------------------------------------------------

export async function submitValidationResponse(
  requestHash: Hex,
  response: number,
  responseURI: string,
  responseHash: Hex,
  tag: string,
  target: ChainTarget = "base-sepolia",
): Promise<Hex> {
  const config = getChainConfig(target);
  const { publicClient, walletClient, account } = getJudgeClients(target);

  const hash = await walletClient.writeContract({
    address: config.validation,
    abi: validationRegistryAbi,
    functionName: "validationResponse",
    args: [requestHash, response, responseURI, responseHash, tag],
    chain: walletClient.chain,
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------------------
// Read reputation summary
// ---------------------------------------------------------------------------

export async function getReputationSummary(
  agentId: bigint,
  clientAddresses: Address[],
  tag1: string = "",
  tag2: string = "",
  target: ChainTarget = "base-sepolia",
): Promise<{ count: bigint; summaryValue: bigint; summaryValueDecimals: number }> {
  const config = getChainConfig(target);
  const { publicClient } = getClients(target);

  const [count, summaryValue, summaryValueDecimals] =
    await publicClient.readContract({
      address: config.reputation,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentId, clientAddresses, tag1, tag2],
    });

  return {
    count,
    summaryValue,
    summaryValueDecimals,
  };
}
