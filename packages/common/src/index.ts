/**
 * @file Barrel export for @veil/common — shared schemas, constants, and utilities.
 */

export {
  ParsedIntentSchema,
  SwapRecordSchema,
  AuditReportSchema,
  AgentLogEntrySchema,
  IntentRecordSchema,
  type ParsedIntent,
  type SwapRecord,
  type AuditReport,
  type AgentLogEntry,
  type IntentRecord,
} from "./schemas.js";

export {
  AGENT_ADDRESS,
  DEFAULT_AGENT_PORT,
  API_PATHS,
  SECONDS_PER_DAY,
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

export {
  IDENTITY_REGISTRY_ABI_HUMAN,
  REPUTATION_REGISTRY_ABI_HUMAN,
} from "./erc8004-abi.js";

export {
  computeMaxValueWei,
  computeExpiryTimestamp,
  computeMaxCalls,
  detectAdversarialIntent,
  generateAuditReport,
  type AdversarialWarning,
} from "./delegation.js";
