/**
 * ERC-7710 delegation redemption. Deploys the delegator smart account if needed,
 * funds it with ETH, and sends the redeemDelegations transaction to the
 * DelegationManager from the agent EOA.
 *
 * @module @veil/agent/delegation/redeemer
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../logging/logger.js";
import {
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type Delegation,
  type MetaMaskSmartAccount,
} from "@metamask/smart-accounts-kit";
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedeemParams {
  /** The signed delegation chain (innermost first) */
  delegation: Delegation;
  /** The delegator's smart account (needed to check/trigger deployment) */
  delegatorSmartAccount: MetaMaskSmartAccount;
  /** The call to execute under delegation */
  call: {
    to: Hex;
    data?: Hex;
    value?: bigint;
  };
}

// ---------------------------------------------------------------------------
// deployDelegatorIfNeeded — ensure the delegator smart account is deployed
// ---------------------------------------------------------------------------

export async function deployDelegatorIfNeeded(
  smartAccount: MetaMaskSmartAccount,
  agentPrivateKey: `0x${string}`,
  chain: Chain,
): Promise<Hex | null> {
  const publicClient = createPublicClient({ chain, transport: http() });

  // Check if smart account code exists at the address
  const code = await publicClient.getCode({ address: smartAccount.address });
  if (code && code !== "0x") {
    return null; // Already deployed
  }

  // Deploy the smart account by sending the factory call as a regular tx.
  // The smart account's getFactoryArgs gives us the factory address + calldata.
  const factoryArgs = await smartAccount.getFactoryArgs();
  if (!factoryArgs) {
    throw new Error("Smart account has no factory args for deployment");
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(agentPrivateKey),
    chain,
    transport: http(),
  });

  const txHash = await walletClient.sendTransaction({
    to: factoryArgs.factory,
    data: factoryArgs.factoryData,
    chain,
    account: walletClient.account,
  });

  // Wait for deployment confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Smart account deployment failed: ${txHash}`);
  }

  logger.info(
    `Delegator smart account deployed at ${smartAccount.address} (tx: ${txHash})`,
  );
  return txHash;
}

// ---------------------------------------------------------------------------
// fundDelegatorIfNeeded — ensure the delegator smart account has enough ETH
// for the upcoming swap. Transfers from agent EOA if balance is insufficient.
// ---------------------------------------------------------------------------

export async function fundDelegatorIfNeeded(
  smartAccount: MetaMaskSmartAccount,
  agentPrivateKey: `0x${string}`,
  chain: Chain,
  requiredWei: bigint,
): Promise<Hex | null> {
  const publicClient = createPublicClient({ chain, transport: http() });

  const balance = await publicClient.getBalance({
    address: smartAccount.address,
  });

  // Add 10% buffer for gas that the smart account might need
  const requiredWithBuffer = requiredWei + requiredWei / 10n;

  if (balance >= requiredWithBuffer) {
    return null; // Already has enough
  }

  const deficit = requiredWithBuffer - balance;
  logger.info(
    `Funding delegator smart account with ${formatEther(deficit)} ETH...`,
  );

  const walletClient = createWalletClient({
    account: privateKeyToAccount(agentPrivateKey),
    chain,
    transport: http(),
  });

  const txHash = await walletClient.sendTransaction({
    to: smartAccount.address,
    value: deficit,
    chain,
    account: walletClient.account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Funding delegator smart account failed: ${txHash}`);
  }

  logger.info(
    `Delegator funded: ${formatEther(deficit)} ETH (tx: ${txHash})`,
  );
  return txHash;
}

// ---------------------------------------------------------------------------
// redeemDelegation — execute a transaction under a signed delegation
//
// Uses the DelegationManager.encode.redeemDelegations approach from the
// MetaMask Smart Accounts Kit docs. The agent (EOA) sends a regular tx
// to the DelegationManager, which validates the delegation chain and
// executes the action on the delegator's smart account.
// ---------------------------------------------------------------------------

export async function redeemDelegation(
  agentPrivateKey: `0x${string}`,
  chain: Chain,
  params: RedeemParams,
): Promise<Hex> {
  // 1. Ensure delegator smart account is deployed
  await deployDelegatorIfNeeded(
    params.delegatorSmartAccount,
    agentPrivateKey,
    chain,
  );

  // 2. Fund delegator if the call requires ETH value
  if (params.call.value && params.call.value > 0n) {
    await fundDelegatorIfNeeded(
      params.delegatorSmartAccount,
      agentPrivateKey,
      chain,
      params.call.value,
    );
  }

  // 3. Encode the execution — what we want to do on behalf of the delegator
  const execution = createExecution({
    target: params.call.to,
    callData: params.call.data ?? "0x",
    value: params.call.value ?? 0n,
  });

  // 4. Encode the redeemDelegations calldata
  const redeemCalldata = DelegationManager.encode.redeemDelegations({
    delegations: [[params.delegation]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
  });

  // 5. Send the redeem tx from the agent EOA to the DelegationManager
  const walletClient = createWalletClient({
    account: privateKeyToAccount(agentPrivateKey),
    chain,
    transport: http(),
  });

  const delegationManagerAddr = getSmartAccountsEnvironment(
    chain.id,
  ).DelegationManager as Hex;

  const txHash = await walletClient.sendTransaction({
    to: delegationManagerAddr,
    data: redeemCalldata,
    chain,
    account: walletClient.account,
  });

  return txHash;
}
