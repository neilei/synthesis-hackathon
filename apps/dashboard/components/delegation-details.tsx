/**
 * Permission Details card — shows on-chain constraint metadata computed
 * from a ParsedIntent. Pure computation, no wallet connection needed.
 *
 * @module @veil/dashboard/components/delegation-details
 */
import { Card } from "./ui/card";
import { CardFooter } from "./ui/card-footer";
import { SectionHeading } from "./ui/section-heading";
import { SponsorChip } from "./sponsor-chip";
import type { ParsedIntent } from "@veil/common";
import {
  AGENT_ADDRESS,
  truncateAddress,
  computeExpiryTimestamp,
  computePeriodAmount,
} from "@veil/common";
import { CONTRACTS } from "@/lib/contracts";

interface DelegationDetailsProps {
  parsed: ParsedIntent;
}

export function DelegationDetails({ parsed }: DelegationDetailsProps) {
  const hasEth = parsed.targetAllocation["ETH"] != null;
  const hasUsdc = parsed.targetAllocation["USDC"] != null;
  const expiry = computeExpiryTimestamp(parsed.timeWindowDays);

  return (
    <Card className="p-5">
      <SectionHeading>Permission Details</SectionHeading>
      <p className="mt-1 text-xs text-text-tertiary">
        ERC-7715 permission scope — the agent cannot exceed these on-chain
        constraints
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 md:grid-cols-3">
        <div>
          <dt className="text-text-secondary">Delegate (Agent)</dt>
          <dd className="font-mono text-text-primary">
            {truncateAddress(AGENT_ADDRESS)}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">Period Duration</dt>
          <dd className="font-mono text-text-primary">24 hours</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Expires</dt>
          <dd className="font-mono text-text-primary">
            {new Date(expiry * 1000).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </dd>
        </div>
      </dl>

      {/* Permission types */}
      <div className="mt-4 space-y-3">
        <SectionHeading size="xs" as="h3" className="text-text-secondary">
          Requested Permissions
        </SectionHeading>

        {hasEth && (
          <div className="rounded border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-accent-positive/10 px-1.5 py-0.5 font-mono text-xs text-accent-positive">
                native-token-periodic
              </span>
              <span className="text-xs text-text-secondary">ETH</span>
            </div>
            <p className="mt-1 font-mono text-xs text-text-tertiary">
              Up to {computePeriodAmount(parsed.dailyBudgetUsd, "ETH")} wei per day
            </p>
          </div>
        )}

        {hasUsdc && (
          <div className="rounded border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-accent-secondary/10 px-1.5 py-0.5 font-mono text-xs text-accent-secondary">
                erc20-token-periodic
              </span>
              <span className="text-xs text-text-secondary">USDC</span>
              <span className="font-mono text-xs text-text-tertiary">
                {truncateAddress(CONTRACTS.USDC_SEPOLIA)}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-text-tertiary">
              Up to {computePeriodAmount(parsed.dailyBudgetUsd, "USDC")} units per day
            </p>
          </div>
        )}
      </div>

      <CardFooter>
        <SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />
      </CardFooter>
    </Card>
  );
}
