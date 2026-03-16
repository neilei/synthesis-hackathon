"use client";

import { SponsorBadge } from "./sponsor-badge";
import { Card } from "./ui/card";
import { SectionHeading } from "./ui/section-heading";
import { AuditListItem } from "./ui/audit-list-item";
import { WarningIcon } from "./ui/icons";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import type { DeployResponse } from "@veil/common";

interface AuditProps {
  data: DeployResponse;
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

          {/* Key-value grid */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <span className="text-text-secondary">Daily Budget</span>
              <p className="font-mono text-text-primary">
                ${parsed.dailyBudgetUsd.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Time Window</span>
              <p className="font-mono text-text-primary">
                {parsed.timeWindowDays} days
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Max Slippage</span>
              <p className="font-mono text-text-primary">
                {(parsed.maxSlippage * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Drift Threshold</span>
              <p className="font-mono text-text-primary">
                {(parsed.driftThreshold * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Max Trades/Day</span>
              <p className="font-mono text-text-primary">
                {parsed.maxTradesPerDay}
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-border-subtle pt-3">
            <SponsorBadge text="Private reasoning via Venice (no data retention)" />
          </div>
        </Card>

        {/* RIGHT COLUMN — Delegation Report */}
        <Card className="p-5">
          <SectionHeading>Delegation Report</SectionHeading>

          {audit ? (
            <div className="mt-5 space-y-5">
              {audit.allows.length > 0 && (
                <div>
                  <SectionHeading size="xs" className="mb-2 text-accent-positive">
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
                  <SectionHeading size="xs" className="mb-2 text-accent-danger">
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
                  <SectionHeading size="xs" className="mb-2 text-accent-warning">
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
                  <SectionHeading size="xs" className="mb-2 text-accent-warning">
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
          className="cursor-pointer rounded-lg border border-accent-positive bg-accent-positive/10 px-5 py-2 text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive/20 active:bg-accent-positive/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
        >
          View Monitor
        </button>
      </Card>
    </div>
  );
}
