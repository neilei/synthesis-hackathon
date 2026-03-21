/**
 * @file Formatting utilities shared across the Maw monorepo — addresses,
 * hashes, currency, timestamps, and percentages.
 */

/**
 * Truncate an Ethereum address to `0x1234...abcd` form.
 * Returns the input unchanged if it's shorter than 12 characters.
 */
export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Truncate a transaction hash to `0x1234...abcd` form.
 * Returns the input unchanged if it's shorter than 12 characters.
 */
export function truncateHash(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

/**
 * Format a number as USD currency string with commas and 2 decimal places.
 * Uses `en-US` locale for consistent formatting across environments.
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format an ISO timestamp string as a relative time string.
 *
 * - Less than 60 seconds: "Xs ago"
 * - Less than 60 minutes: "Xm ago"
 * - Less than 24 hours: "Xh ago"
 * - Less than 7 days: "Xd ago"
 * - Older: "Mar 15" style date
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format a decimal ratio as a percentage string.
 *
 * @param value - The decimal value (e.g. 0.05 for 5%)
 * @param decimals - Number of decimal places (default: 1)
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a token allocation record as a human-readable summary.
 *
 * @param allocation - Map of token symbol to decimal ratio (e.g. { ETH: 0.6, USDC: 0.4 })
 * @param decimals - Number of decimal places for percentages (default: 0)
 * @returns String like "60% ETH / 40% USDC"
 */
export function formatAllocationSummary(
  allocation: Record<string, number>,
  decimals = 0,
): string {
  return Object.entries(allocation)
    .map(([token, pct]) => `${formatPercentage(pct, decimals)} ${token}`)
    .join(" / ");
}
