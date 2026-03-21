/**
 * Generic retry wrapper with exponential backoff.
 * Only retries on retryable errors (network, 429, 500-503).
 *
 * @module @maw/agent/utils/retry
 */
import { logger } from "../logging/logger.js";

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && "status" in err) {
    // Safe to access .status — we just confirmed it exists via the `in` operator.
    // The cast is needed because Error doesn't declare `status` in its type.
    const status = (err as Error & { status: number }).status;
    return !NON_RETRYABLE_STATUSES.has(status);
  }
  return true; // network errors, timeouts, etc. are retryable
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; baseDelayMs?: number; label?: string },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const label = opts?.label ?? "unknown";

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          { attempt: attempt + 1, maxRetries, delay, label, err },
          "Retrying after error",
        );
        await new Promise((r) => setTimeout(r, delay));
      } else if (!isRetryable(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}
