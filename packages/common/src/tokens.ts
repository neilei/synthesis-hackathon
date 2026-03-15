/**
 * @file Token metadata and styling helpers for the Veil dashboard.
 *
 * All lookups normalize the token symbol to uppercase before matching.
 * Unknown tokens receive neutral fallback styles.
 */

/** Per-token visual metadata for dashboard rendering. */
export interface TokenMeta {
  bg: string;
  labelColor: string;
  label: string;
}

/**
 * Known token metadata. Keys are uppercase token symbols.
 * Add entries here when new tokens are supported.
 */
export const TOKEN_META: Record<string, TokenMeta> = {
  ETH: { bg: "bg-emerald-500", labelColor: "text-emerald-400", label: "ETH" },
  WETH: { bg: "bg-emerald-500", labelColor: "text-emerald-400", label: "WETH" },
  USDC: { bg: "bg-indigo-500", labelColor: "text-indigo-400", label: "USDC" },
};

/** Fallback background class for unknown tokens. */
const FALLBACK_BG = "bg-zinc-500";

/** Fallback label color class for unknown tokens. */
const FALLBACK_LABEL_COLOR = "text-zinc-400";

/**
 * Get the Tailwind background class for a token's allocation bar segment.
 * Returns `bg-zinc-500` for unknown tokens.
 */
export function getTokenBg(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.bg ?? FALLBACK_BG;
}

/**
 * Get the Tailwind text color class for a token's label.
 * Returns `text-zinc-400` for unknown tokens.
 */
export function getTokenLabelColor(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.labelColor ?? FALLBACK_LABEL_COLOR;
}

/**
 * Get the display label for a token. Returns the known label or
 * the input uppercased for unknown tokens.
 */
export function getTokenLabel(token: string): string {
  return TOKEN_META[token.toUpperCase()]?.label ?? token.toUpperCase();
}
