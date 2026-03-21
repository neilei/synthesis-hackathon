/**
 * Error display banner with optional retry button. Used throughout the dashboard
 * for API failures and connection errors.
 *
 * @module @maw/dashboard/components/error-banner
 */
import { Button } from "./ui/button";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div role="alert" className="rounded-lg border border-accent-danger/30 bg-accent-danger-dim p-4 flex items-center justify-between gap-4">
      <p className="text-sm text-accent-danger">{message}</p>
      {onRetry && (
        <Button variant="danger" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      )}
    </div>
  );
}
