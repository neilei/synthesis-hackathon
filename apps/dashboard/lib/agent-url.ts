import { DEFAULT_AGENT_PORT } from "@veil/common";

export const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;
