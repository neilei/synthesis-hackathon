import { DEFAULT_AGENT_PORT } from "@maw/common";

export const AGENT_API_URL =
  (process.env.AGENT_API_URL?.trim()) || `http://localhost:${DEFAULT_AGENT_PORT}`;
