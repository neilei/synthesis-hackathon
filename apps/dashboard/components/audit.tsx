"use client";

import { SponsorBadge } from "./sponsor-badge";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { AuditListItem } from "./ui/audit-list-item";
import { WarningIcon } from "./ui/icons";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { DelegationDetails } from "./delegation-details";
import type { ParsedIntent, AuditReport } from "@veil/common";

interface AuditProps {
  data: { parsed: ParsedIntent; audit: AuditReport | null };
  onViewMonitor: () => void;
}

export function Audit({ data, onViewMonitor }: AuditProps) {
  const { parsed, audit } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Two-column grid on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* LEFT COLUMN — Your Strategy */}
        <Card className="p-5">
          <SectionHeading>Your Strategy</SectionHeading>

          <div className="mt-5">
            <AllocationBar allocation={parsed.targetAllocation} size="lg" />
          </div>

          <div className="mt-6">
            <StrategyDetails parsed={parsed} showDriftThreshold />
          </div>

          <div className="mt-5 border-t border-border-subtle pt-3">
            <SponsorBadge text="Powered by Venice" />
          </div>
        </Card>

        {/* RIGHT COLUMN — Delegation Report */}
        <Card className="p-5">
          <SectionHeading>Delegation Report</SectionHeading>

          {audit ? (
            <div className="mt-5 space-y-5">
              {audit.allows.length > 0 && (
                <div>
                  <SectionHeading size="xs" as="h3" className="mb-2 text-accent-positive">
                    Allows
                  </SectionHeading>
                  <ul className="space-y-2">
                    {audit.allows.map((item, i) => (
                      <AuditListItem key={i} variant="allows">
                        {item}
                      </AuditListItem>
                    ))}
                  </ul>
                </div>
              )}

              {audit.prevents.length > 0 && (
                <div>
                  <SectionHeading size="xs" as="h3" className="mb-2 text-accent-danger">
                    Prevents
                  </SectionHeading>
                  <ul className="space-y-2">
                    {audit.prevents.map((item, i) => (
                      <AuditListItem key={i} variant="prevents">
                        {item}
                      </AuditListItem>
                    ))}
                  </ul>
                </div>
              )}

              {audit.worstCase && (
                <div>
                  <SectionHeading size="xs" as="h3" className="mb-2 text-accent-warning">
                    Worst Case
                  </SectionHeading>
                  <div className="flex items-start gap-2 rounded bg-accent-warning-dim px-3 py-2 text-sm text-text-primary">
                    <WarningIcon />
                    <span>{audit.worstCase}</span>
                  </div>
                </div>
              )}

              {audit.warnings.length > 0 && (
                <div>
                  <SectionHeading size="xs" as="h3" className="mb-2 text-accent-warning">
                    Warnings
                  </SectionHeading>
                  <ul className="space-y-2">
                    {audit.warnings.map((item, i) => (
                      <AuditListItem key={i} variant="warning">
                        {item}
                      </AuditListItem>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 text-sm text-text-secondary">
              No delegation audit available for this strategy. Try adjusting your intent.
            </p>
          )}

          <div className="mt-5 border-t border-border-subtle pt-3">
            <SponsorBadge text="Enforced by MetaMask Delegation" />
          </div>
        </Card>
      </div>

      {/* DELEGATION DETAILS — On-chain constraint metadata */}
      <DelegationDetails parsed={parsed} />

      {/* BOTTOM — Status message + View Monitor button */}
      <Card className="flex flex-col items-center justify-between gap-4 px-5 py-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <PulsingDot />
          <span className="text-sm text-text-secondary">
            Agent deployed and monitoring your portfolio
          </span>
        </div>
        <button
          type="button"
          onClick={onViewMonitor}
          className="cursor-pointer rounded-lg border border-accent-positive bg-accent-positive/10 px-5 py-2 min-h-[44px] text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive/20 active:bg-accent-positive/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
        >
          View Monitor
        </button>
      </Card>
    </div>
  );
}
