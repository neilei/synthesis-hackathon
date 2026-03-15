/**
 * @file Barrel export for @veil/common — shared schemas, constants, and utilities.
 */

export {
  ParsedIntentSchema,
  SwapRecordSchema,
  AuditReportSchema,
  AgentLogEntrySchema,
  AgentStateResponseSchema,
  DeployResponseSchema,
  type ParsedIntent,
  type SwapRecord,
  type AuditReport,
  type AgentLogEntry,
  type AgentStateResponse,
  type DeployResponse,
} from "./schemas.js";

export {
  AGENT_ADDRESS,
  DEFAULT_AGENT_PORT,
  API_PATHS,
} from "./constants.js";

export {
  truncateAddress,
  truncateHash,
  formatCurrency,
  formatTimestamp,
  formatPercentage,
} from "./format.js";

export {
  TOKEN_META,
  getTokenBg,
  getTokenLabelColor,
  getTokenLabel,
  type TokenMeta,
} from "./tokens.js";
