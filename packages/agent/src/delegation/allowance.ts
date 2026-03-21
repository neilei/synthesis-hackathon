/**
 * On-chain delegation allowance queries using MetaMask Smart Accounts Kit.
 * Queries the caveat enforcer contracts to determine how much the agent
 * can still pull from the user's smart account in the current period.
 *
 * @module @maw/agent/delegation/allowance
 */
import { createPublicClient, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import {
  getSmartAccountsEnvironment,
  createCaveatEnforcerClient,
} from "@metamask/smart-accounts-kit";
import { rpcTransport } from "../config.js";
import { logger } from "../logging/logger.js";

export interface DelegationAllowance {
  /** Remaining amount in smallest unit (wei for ETH, raw for ERC-20) */
  availableAmount: bigint;
  /** Whether this is a fresh period (no prior spending) */
  isNewPeriod: boolean;
  /** Current period index */
  currentPeriod: bigint;
}

/**
 * Query remaining ERC-20 periodic transfer allowance from on-chain enforcer.
 * Returns null if the query fails (e.g., no matching enforcer caveat).
 */
export async function getErc20Allowance(
  permissionContext: Hex,
  chainId: number,
): Promise<DelegationAllowance | null> {
  try {
    const environment = getSmartAccountsEnvironment(chainId);
    const chain = sepolia; // Only Sepolia supported for now
    const publicClient = createPublicClient({
      chain,
      transport: rpcTransport(chain),
    });
    const client = createCaveatEnforcerClient({
      client: publicClient,
      environment,
    });

    const delegations = decodeDelegations(permissionContext);
    if (delegations.length === 0) {
      logger.warn("No delegations decoded from permission context");
      return null;
    }

    const result = await client.getErc20PeriodTransferEnforcerAvailableAmount({
      delegation: delegations[0]!,
    });

    return {
      availableAmount: result.availableAmount,
      isNewPeriod: result.isNewPeriod,
      currentPeriod: result.currentPeriod,
    };
  } catch (err) {
    logger.warn(
      { err, chainId },
      "Failed to query ERC-20 delegation allowance",
    );
    return null;
  }
}

/**
 * Query remaining native token (ETH) periodic transfer allowance.
 * Returns null if the query fails.
 */
export async function getNativeAllowance(
  permissionContext: Hex,
  chainId: number,
): Promise<DelegationAllowance | null> {
  try {
    const environment = getSmartAccountsEnvironment(chainId);
    const chain = sepolia; // Only Sepolia supported for now
    const publicClient = createPublicClient({
      chain,
      transport: rpcTransport(chain),
    });
    const client = createCaveatEnforcerClient({
      client: publicClient,
      environment,
    });

    const delegations = decodeDelegations(permissionContext);
    if (delegations.length === 0) {
      logger.warn("No delegations decoded from permission context");
      return null;
    }

    const result =
      await client.getNativeTokenPeriodTransferEnforcerAvailableAmount({
        delegation: delegations[0]!,
      });

    return {
      availableAmount: result.availableAmount,
      isNewPeriod: result.isNewPeriod,
      currentPeriod: result.currentPeriod,
    };
  } catch (err) {
    logger.warn(
      { err, chainId },
      "Failed to query native token delegation allowance",
    );
    return null;
  }
}
