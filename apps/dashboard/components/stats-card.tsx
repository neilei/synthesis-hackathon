/**
 * Reusable stat display card with label, monospace value, and loading state.
 * Used in the Monitor tab for portfolio metrics.
 *
 * @module @veil/dashboard/components/stats-card
 */
interface StatsCardProps {
  label: string;
  value: string;
  loading?: boolean;
  valueColor?: string;
}

export function StatsCard({
  label,
  value,
  loading,
  valueColor = "text-text-primary",
}: StatsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-border" />
      ) : (
        <p className={`mt-1 font-mono text-2xl tabular-nums ${valueColor}`}>
          {value}
        </p>
      )}
    </div>
  );
}
