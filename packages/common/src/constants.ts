/**
 * @file Shared constants used across the Veil monorepo — addresses, ports, API paths.
 */

/** The Veil agent's Ethereum address (EOA). */
export const AGENT_ADDRESS = "0xf13021F02E23a8113C1bD826575a1682F6Fac927";

/** Default port for the agent API server. */
export const DEFAULT_AGENT_PORT = 3147;

/** Seconds in a day (for delegation expiry calculations). */
export const SECONDS_PER_DAY = 86400;

/** Canonical API route paths used by both the agent server and dashboard client. */
export const API_PATHS = Object.freeze({
  authNonce: "/api/auth/nonce",
  authVerify: "/api/auth/verify",
  parseIntent: "/api/parse-intent",
  intents: "/api/intents",
} as const);
