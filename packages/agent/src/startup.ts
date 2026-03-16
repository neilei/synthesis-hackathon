import type { IntentRepository } from "./db/repository.js";
import { logger } from "./logging/logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resumeActiveIntents(
  repo: IntentRepository,
  startFn: (intentId: string) => Promise<void>,
  staggerMs = 2500,
): Promise<{ expired: number; resumed: number }> {
  // Mark expired intents
  const expired = repo.markExpiredIntents();
  if (expired > 0) {
    logger.info({ expired }, "Marked expired intents on startup");
  }

  // Get remaining active intents
  const active = repo.getActiveIntents();
  let resumed = 0;

  for (const intent of active) {
    try {
      logger.info(
        { intentId: intent.id, wallet: intent.walletAddress, cycle: intent.cycle },
        "Resuming intent",
      );
      await startFn(intent.id);
      resumed++;

      if (staggerMs > 0 && resumed < active.length) {
        await sleep(staggerMs);
      }
    } catch (err) {
      logger.error({ intentId: intent.id, err }, "Failed to resume intent");
    }
  }

  return { expired, resumed };
}
