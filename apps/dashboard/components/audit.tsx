"use client";

import { SponsorChip } from "./sponsor-chip";
import { Card } from "./ui/card";
import { CardFooter } from "./ui/card-footer";
import { Button } from "./ui/button";
import { SectionHeading } from "./ui/section-heading";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { DelegationDetails } from "./delegation-details";
import { AuditReportSection } from "./audit-report-section";
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

          <CardFooter className="mt-5">
            <SponsorChip sponsor="venice" text="Powered by Venice.ai" />
          </CardFooter>
        </Card>

        {/* RIGHT COLUMN — Permission Report */}
        <Card className="p-5">
          <SectionHeading>Permission Report</SectionHeading>

          {audit ? (
            <div className="mt-5">
              <AuditReportSection audit={audit} />
            </div>
          ) : (
            <p className="mt-5 text-sm text-text-secondary">
              No permission audit available for this strategy. Try adjusting your intent.
            </p>
          )}

          <CardFooter className="mt-5">
            <SponsorChip sponsor="metamask" text="Enforced by MetaMask Delegation" />
          </CardFooter>
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
        <Button variant="outline" size="md" onClick={onViewMonitor} className="bg-accent-positive/10 hover:bg-accent-positive/20 active:bg-accent-positive/25">
          View Monitor
        </Button>
      </Card>
    </div>
  );
}
