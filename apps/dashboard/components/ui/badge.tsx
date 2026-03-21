/**
 * Status badge with semantic color variants: positive (emerald), danger (red),
 * warning (amber). Used in Monitor tab for transaction outcomes.
 *
 * @module @maw/dashboard/components/ui/badge
 */
type BadgeVariant = "positive" | "danger" | "warning";

const VARIANT_COLORS: Record<BadgeVariant, string> = {
  positive: "bg-accent-positive-dim text-accent-positive",
  danger: "bg-accent-danger-dim text-accent-danger",
  warning: "bg-accent-warning-dim text-accent-warning",
};

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${VARIANT_COLORS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
