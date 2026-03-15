/**
 * Base card wrapper with zinc-900 surface, 1px border, and 8px radius.
 * Foundation component used by StatsCard, SkeletonCard, and content sections.
 *
 * @module @veil/dashboard/components/ui/card
 */
interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-lg border border-border bg-bg-surface ${className}`}>
      {children}
    </div>
  );
}
