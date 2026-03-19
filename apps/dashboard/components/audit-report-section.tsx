/**
 * Shared audit report rendering — used by both Configure (inline preview)
 * and Audit (full-page post-deploy view).
 *
 * @module @veil/dashboard/components/audit-report-section
 */
import { SectionHeading } from "./ui/section-heading";
import { AuditListItem } from "./ui/audit-list-item";
import { WarningIcon } from "./ui/icons";
import type { AuditReport } from "@veil/common";

interface AuditReportSectionProps {
  audit: AuditReport;
}

export function AuditReportSection({ audit }: AuditReportSectionProps) {
  return (
    <div className="space-y-4">
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
  );
}
