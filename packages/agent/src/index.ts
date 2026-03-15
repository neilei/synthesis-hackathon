/**
 * CLI entry point. Parses --intent and --cycles args, then starts the agent loop.
 *
 * @module @veil/agent/index
 */
import { env } from "./config.js";
import { privateKeyToAccount } from "viem/accounts";
import { startFromCli } from "./agent-loop.js";

const agentAccount = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

console.log("=".repeat(60));
console.log("  VEIL — Intent-Compiled Private DeFi Agent");
console.log("=".repeat(60));
console.log(`  Agent address:  ${agentAccount.address}`);
console.log(`  Venice API:     ${env.VENICE_BASE_URL}`);
console.log(`  Uniswap API:    configured`);
if (env.VENICE_MODEL_OVERRIDE) {
  console.log(`  Model override: ${env.VENICE_MODEL_OVERRIDE}`);
}
console.log("=".repeat(60));
console.log("");

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
    console.error("Agent loop failed:", err);
    process.exit(1);
  });
} else {
  console.log(
    'Usage: tsx src/index.ts --intent "60/40 ETH/USDC, $200/day, 7 days" [--cycles 3]',
  );
  console.log("");
  console.log("Veil agent ready. Provide --intent to start autonomous loop.");
}
