/**
 * Animated loading placeholder components: SkeletonLine, SkeletonCard, SkeletonTable.
 * Used by Monitor and other views during data fetching.
 *
 * @module @veil/dashboard/components/skeleton
 */
interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-border ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-4">
      <SkeletonLine className="h-3 w-20 mb-3" />
      <SkeletonLine className="h-8 w-32" />
    </div>
  );
}

export function SkeletonTable({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
