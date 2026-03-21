"use client";

import { useState, useCallback } from "react";
import { useWalletClient } from "wagmi";
import { erc7715ProviderActions, type PermissionRequestParameter } from "@metamask/smart-accounts-kit/actions";
import type { ParsedIntent } from "@veil/common";
import { AGENT_ADDRESS, computePeriodAmount, computeExpiryTimestamp } from "@veil/common";
import { CONTRACTS } from "@/lib/contracts";

export interface GrantedPermission {
  type: string;
  context: string;
  token: string;
}

export interface PermissionResult {
  permissions: GrantedPermission[];
  delegationManager: string;
  dependencies: { factory: string; factoryData: string }[];
}

export function usePermissions() {
  const { data: walletClient } = useWalletClient();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPermissions = useCallback(
    async (parsed: ParsedIntent): Promise<PermissionResult | null> => {
      if (!walletClient) {
        setError("Wallet not connected");
        return null;
      }

      setRequesting(true);
      setError(null);

      try {
        const client = walletClient.extend(erc7715ProviderActions());
        const expiry = computeExpiryTimestamp(parsed.timeWindowDays);

        // Build permission requests based on intent allocation
        const permissionRequests: PermissionRequestParameter[] = [];
        const hasEth = parsed.targetAllocation["ETH"] != null;
        const hasUsdc = parsed.targetAllocation["USDC"] != null;

        if (hasEth) {
          const ethPeriodAmount = computePeriodAmount(
            parsed.dailyBudgetUsd,
            "ETH",
          );
          permissionRequests.push({
            chainId: walletClient.chain.id,
            expiry,
            to: AGENT_ADDRESS as `0x${string}`,
            isAdjustmentAllowed: true,
            permission: {
              type: "native-token-periodic" as const,
              data: {
                periodAmount: ethPeriodAmount,
                periodDuration: 86400, // 1 day
                justification: `Rebalance: up to ${ethPeriodAmount} wei ETH per day for portfolio management`,
              },
            },
          });
        }

        if (hasUsdc) {
          const usdcPeriodAmount = computePeriodAmount(
            parsed.dailyBudgetUsd,
            "USDC",
          );
          permissionRequests.push({
            chainId: walletClient.chain.id,
            expiry,
            to: AGENT_ADDRESS as `0x${string}`,
            isAdjustmentAllowed: true,
            permission: {
              type: "erc20-token-periodic" as const,
              data: {
                tokenAddress: CONTRACTS.USDC_SEPOLIA,
                periodAmount: usdcPeriodAmount,
                periodDuration: 86400,
                justification: `Rebalance: up to ${usdcPeriodAmount} USDC units per day for portfolio management`,
              },
            },
          });
        }

        const grantedPermissions =
          await client.requestExecutionPermissions(permissionRequests);

        // Map response to our GrantedPermission shape
        const permissions: GrantedPermission[] = grantedPermissions.map(
          (gp: { context: string; delegationManager?: string; dependencies?: { factory: string; factoryData: string }[] }, i: number) => ({
            type: permissionRequests[i]!.permission.type,
            context: gp.context,
            token:
              permissionRequests[i]!.permission.type ===
              "native-token-periodic"
                ? "ETH"
                : "USDC",
          }),
        );

        return {
          permissions,
          delegationManager: grantedPermissions[0]?.delegationManager ?? "",
          dependencies: grantedPermissions[0]?.dependencies ?? [],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Permission request failed";
        if (msg.includes("User rejected") || msg.includes("denied")) {
          setError("Permission request was rejected in MetaMask.");
        } else {
          setError(msg);
        }
        return null;
      } finally {
        setRequesting(false);
      }
    },
    [walletClient],
  );

  return {
    requestPermissions,
    requesting,
    error,
  };
}
