/**
 * Delegation Details card — shows on-chain constraint metadata computed
 * from a ParsedIntent. Pure computation, no wallet connection needed.
 *
 * @module @veil/dashboard/components/delegation-details
 */
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { SponsorBadge } from "./sponsor-badge";
import type { ParsedIntent } from "@veil/common";
import {
  AGENT_ADDRESS,
  truncateAddress,
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
} from "@veil/common";

interface DelegationDetailsProps {
  parsed: ParsedIntent;
}

export function DelegationDetails({ parsed }: DelegationDetailsProps) {
  return (
    <Card className="p-5">
      <SectionHeading>Delegation Details</SectionHeading>
      <p className="mt-1 text-xs text-text-tertiary">
        ERC-7715 permission scope — the agent cannot exceed these on-chain
        constraints
      </p>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 md:grid-cols-3">
        <div>
          <span className="text-text-secondary">Delegate (Agent)</span>
          <p className="font-mono text-text-primary">
            {truncateAddress(AGENT_ADDRESS)}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Scope Target</span>
          <p className="font-mono text-text-primary">Uniswap Router</p>
        </div>
        <div>
          <span className="text-text-secondary">Function</span>
          <p className="font-mono text-text-primary">execute()</p>
        </div>
        <div>
          <span className="text-text-secondary">Max Value (wei)</span>
          <p className="font-mono text-text-primary">
            {computeMaxValueWei(
              parsed.dailyBudgetUsd,
              parsed.timeWindowDays,
            ).toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Max Calls</span>
          <p className="font-mono text-text-primary">
            {computeMaxCalls(parsed.maxTradesPerDay, parsed.timeWindowDays)}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Expires</span>
          <p className="font-mono text-text-primary">
            {new Date(
              computeExpiryTimestamp(parsed.timeWindowDays) * 1000,
            ).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <SectionHeading size="xs" as="h3" className="text-text-secondary">
          Caveat Enforcers
        </SectionHeading>
        <div className="flex flex-wrap gap-2">
          {["ValueLteEnforcer", "TimestampEnforcer", "LimitedCallsEnforcer"].map(
            (enforcer) => (
              <span
                key={enforcer}
                className="rounded border border-border px-2 py-0.5 font-mono text-xs text-text-secondary"
              >
                {enforcer}
              </span>
            ),
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <SponsorBadge text="Secured by MetaMask ERC-7715 / ERC-7710" />
      </div>
    </Card>
  );
}
