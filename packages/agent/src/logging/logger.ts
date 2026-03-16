import pino from "pino";

// Reads process.env directly (not via Zod config) because the logger must
// initialize before config.ts validation runs. Both vars have safe defaults.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});
