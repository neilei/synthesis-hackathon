"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import type { ParsedIntent } from "@veil/common";
import { computeMaxValueWei, computeExpiryTimestamp, computeMaxCalls } from "@veil/common";

interface DelegationResult {
  signedDelegation: string;
  delegatorSmartAccount: string;
  permissionsContext?: string;
  delegationManager?: string;
}

export function useDelegation() {
  const { address } = useAccount();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signDelegation = useCallback(
    async (parsed: ParsedIntent): Promise<DelegationResult | null> => {
      if (!address) {
        setError("Wallet not connected");
        return null;
      }

      setSigning(true);
      setError(null);

      try {
        // Compute delegation parameters from intent
        const maxValueWei = computeMaxValueWei(
          parsed.dailyBudgetUsd,
          parsed.timeWindowDays,
        );
        const expiryTimestamp = computeExpiryTimestamp(parsed.timeWindowDays);
        const maxCalls = computeMaxCalls(
          parsed.maxTradesPerDay,
          parsed.timeWindowDays,
        );

        // Build delegation object with computed parameters
        // In production, this would use MetaMask's createDelegation + signDelegation
        // via @metamask/smart-accounts-kit. For now, we create a structured delegation
        // that the agent backend can use for ERC-7710 redemption.
        const delegation = {
          delegator: address,
          delegate: "0xf13021F02E23a8113C1bD826575a1682F6Fac927", // Agent EOA
          authority: "0x0000000000000000000000000000000000000000000000000000000000000000",
          caveats: [
            {
              enforcer: "functionCall",
              maxValueWei: maxValueWei.toString(),
              expiryTimestamp,
              maxCalls,
              maxSlippage: parsed.maxSlippage,
            },
          ],
          salt: BigInt(Date.now()).toString(),
          signature: "0x", // Placeholder — real signing requires MetaMask smart account
        };

        return {
          signedDelegation: JSON.stringify(delegation),
          delegatorSmartAccount: address,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delegation signing failed";
        setError(msg);
        return null;
      } finally {
        setSigning(false);
      }
    },
    [address],
  );

  return {
    signDelegation,
    signing,
    error,
  };
}
