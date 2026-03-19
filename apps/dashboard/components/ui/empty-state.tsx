/**
 * Centered empty state with icon dot, heading, description, and optional CTA.
 * Used for "Connect wallet", "No agents running", error boundary fallback, etc.
 *
 * @module @veil/dashboard/components/ui/empty-state
 */

interface EmptyStateProps {
  /** Dot color for the icon indicator. */
  dotColor?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function EmptyState({
  dotColor = "bg-text-tertiary",
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 sm:p-16 text-center">
      <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
        <div className={`h-3 w-3 rounded-full ${dotColor}`} />
      </div>
      <h2 className="text-lg font-medium text-text-primary">{title}</h2>
      <p className="max-w-md text-sm text-text-secondary">{description}</p>
      {children}
    </div>
  );
}
