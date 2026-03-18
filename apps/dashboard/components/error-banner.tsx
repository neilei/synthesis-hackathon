/**
 * Error display banner with optional retry button. Used throughout the dashboard
 * for API failures and connection errors.
 *
 * @module @veil/dashboard/components/error-banner
 */
interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div role="alert" className="rounded-lg border border-accent-danger/30 bg-accent-danger-dim p-4 flex items-center justify-between gap-4">
      <p className="text-sm text-accent-danger">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-accent-danger/30 px-3 py-2 min-h-[44px] text-xs font-medium text-accent-danger transition-colors hover:bg-accent-danger/10 active:bg-accent-danger/15 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-danger"
        >
          Retry
        </button>
      )}
    </div>
  );
}
