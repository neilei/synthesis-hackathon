import { CheckIcon, XIcon, WarningIcon } from "./icons";

type AuditVariant = "allows" | "prevents" | "warning";

const VARIANT_CONFIG = {
  allows: {
    bg: "bg-accent-positive-dim",
    Icon: CheckIcon,
  },
  prevents: {
    bg: "bg-accent-danger-dim",
    Icon: XIcon,
  },
  warning: {
    bg: "bg-accent-warning-dim",
    Icon: WarningIcon,
  },
} as const;

interface AuditListItemProps {
  variant: AuditVariant;
  children: React.ReactNode;
}

export function AuditListItem({ variant, children }: AuditListItemProps) {
  const { bg, Icon } = VARIANT_CONFIG[variant];
  return (
    <li className={`flex items-start gap-2 rounded ${bg} px-3 py-2 text-sm text-text-primary`}>
      <Icon />
      <span>{children}</span>
    </li>
  );
}
