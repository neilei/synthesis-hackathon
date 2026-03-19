/**
 * Delegation Details card — shows on-chain constraint metadata computed
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

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 md:grid-cols-3">
        <div>
          <dt className="text-text-secondary">Delegate (Agent)</dt>
          <dd className="font-mono text-text-primary">
            {truncateAddress(AGENT_ADDRESS)}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">Scope Target</dt>
          <dd className="font-mono text-text-primary">Uniswap Router</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Function</dt>
          <dd className="font-mono text-text-primary">execute()</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Max Value (wei)</dt>
          <dd className="font-mono text-text-primary">
            {computeMaxValueWei(
              parsed.dailyBudgetUsd,
              parsed.timeWindowDays,
            ).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">Max Calls</dt>
          <dd className="font-mono text-text-primary">
            {computeMaxCalls(parsed.maxTradesPerDay, parsed.timeWindowDays)}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">Expires</dt>
          <dd className="font-mono text-text-primary">
            {new Date(
              computeExpiryTimestamp(parsed.timeWindowDays) * 1000,
            ).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </dd>
        </div>
      </dl>

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

      <CardFooter>
        <SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />
      </CardFooter>
    </Card>
  );
}
