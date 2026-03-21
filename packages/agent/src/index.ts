/**
 * CLI entry point. Parses --intent and --cycles args, then starts the agent loop.
 *
 * @module @maw/agent/index
 */
import { env } from "./config.js";
import { privateKeyToAccount } from "viem/accounts";
import { startFromCli } from "./agent-loop/index.js";
import { logger } from "./logging/logger.js";

const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

logger.info("=".repeat(60));
logger.info("  MAW — Intent-Compiled Private DeFi Agent");
logger.info("=".repeat(60));
logger.info(`  Agent address:  ${agentAccount.address}`);
logger.info(`  Venice API:     ${env.VENICE_BASE_URL}`);
logger.info(`  Uniswap API:    configured`);
if (env.VENICE_MODEL_OVERRIDE) {
  logger.info(`  Model override: ${env.VENICE_MODEL_OVERRIDE}`);
}
logger.info("=".repeat(60));

// Parse CLI args
const args = process.argv.slice(2);
const intentIdx = args.indexOf("--intent");
const cyclesIdx = args.indexOf("--cycles");

if (intentIdx !== -1 && args[intentIdx + 1]) {
  const intentText = args[intentIdx + 1]!;
  const maxCycles =
    cyclesIdx !== -1 && args[cyclesIdx + 1]
      ? parseInt(args[cyclesIdx + 1]!, 10)
      : undefined;

  startFromCli(intentText, maxCycles).catch((err) => {
    logger.error({ err }, "Agent loop failed");
    process.exit(1);
  });
} else {
  logger.info(
    'Usage: tsx src/index.ts --intent "60/40 ETH/USDC, $200/day, 7 days" [--cycles 3]',
  );
  logger.info("Maw agent ready. Provide --intent to start autonomous loop.");
}
