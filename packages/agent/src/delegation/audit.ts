/**
 * Generates human-readable audit reports comparing an intent to its compiled
 * delegation. Shows what the delegation allows, prevents, worst-case damage,
 * and warnings. Displayed in the dashboard Audit tab.
 *
 * @module @veil/agent/delegation/audit
 */
import type { IntentParse } from "../venice/schemas.js";
import type { Delegation } from "@metamask/smart-accounts-kit";
import { detectAdversarialIntent } from "./compiler.js";

// ---------------------------------------------------------------------------
// Audit report generation
// ---------------------------------------------------------------------------

export interface AuditReport {
  allows: string[];
  prevents: string[];
  worstCase: string;
  intentMatch: string;
  warnings: string[];
  formatted: string;
}

/**
 * Generate a human-readable audit report comparing an intent to its
 * compiled delegation. Shows what the delegation ALLOWS, what it
 * PREVENTS, the WORST CASE damage, and whether it matches the intent.
 */
export function generateAuditReport(
  intent: IntentParse,
  delegation: Delegation | Record<string, unknown>,
): AuditReport {
  const tokens = Object.keys(intent.targetAllocation);
  const allocDesc = tokens
    .map(
      (t) =>
        `${t}: ${(intent.targetAllocation[t]! * 100).toFixed(0)}%`,
    )
    .join(", ");

  const totalBudget = intent.dailyBudgetUsd * intent.timeWindowDays;
  const totalTrades = intent.maxTradesPerDay * intent.timeWindowDays;
  const expiryDate = new Date(
    Date.now() + intent.timeWindowDays * 86400 * 1000,
  );

  // --- ALLOWS ---
  const allows: string[] = [
    `Trade up to $${intent.dailyBudgetUsd}/day for ${intent.timeWindowDays} days`,
    `Maximum ${intent.maxTradesPerDay} trades per day (${totalTrades} total)`,
    `Slippage up to ${(intent.maxSlippage * 100).toFixed(1)}%`,
    `Rebalance when drift exceeds ${(intent.driftThreshold * 100).toFixed(1)}%`,
    `Target allocation: ${allocDesc}`,
  ];

  // --- PREVENTS ---
  const prevents: string[] = [
    `Spending more than $${totalBudget.toLocaleString()} total`,
    `More than ${totalTrades} trades over the full period`,
    `Any activity after ${expiryDate.toISOString().split("T")[0]}`,
    `Transfers to non-approved contract targets`,
    `Trading tokens outside the delegation scope`,
  ];

  // --- WORST CASE ---
  const slippageLoss = totalBudget * intent.maxSlippage;
  const worstCase =
    `Maximum possible loss: $${totalBudget.toLocaleString()} principal ` +
    `+ $${slippageLoss.toFixed(2)} slippage ` +
    `= $${(totalBudget + slippageLoss).toLocaleString()} over ${intent.timeWindowDays} days`;

  // --- INTENT MATCH ---
  const hasCaveats =
    "caveats" in delegation &&
    Array.isArray(delegation.caveats) &&
    delegation.caveats.length > 0;
  const hasDelegateAndDelegator =
    "delegate" in delegation && "delegator" in delegation;
  const hasSignature =
    "signature" in delegation &&
    typeof delegation.signature === "string" &&
    delegation.signature !== "0x";

  const matchChecks: string[] = [];
  if (hasCaveats) {
    matchChecks.push("Caveats present: YES");
  } else {
    matchChecks.push("Caveats present: NO (UNRESTRICTED - DANGEROUS)");
  }
  if (hasDelegateAndDelegator) {
    matchChecks.push("Delegate/Delegator set: YES");
  } else {
    matchChecks.push("Delegate/Delegator set: NO");
  }
  if (hasSignature) {
    matchChecks.push("Signed: YES");
  } else {
    matchChecks.push("Signed: NO (unsigned delegation)");
  }

  const intentMatch = matchChecks.join("; ");

  // --- WARNINGS ---
  const adversarialWarnings = detectAdversarialIntent(intent);
  const warnings = adversarialWarnings.map((w) => `WARNING: ${w.message}`);

  if (!hasCaveats) {
    warnings.push(
      "CRITICAL: Delegation has no caveats — agent has unrestricted access",
    );
  }

  // --- FORMAT ---
  const sections = [
    "=== DELEGATION AUDIT REPORT ===",
    "",
    "--- ALLOWS ---",
    ...allows.map((a) => `  [+] ${a}`),
    "",
    "--- PREVENTS ---",
    ...prevents.map((p) => `  [-] ${p}`),
    "",
    "--- WORST CASE ---",
    `  ${worstCase}`,
    "",
    "--- INTENT MATCH ---",
    `  ${intentMatch}`,
  ];

  if (warnings.length > 0) {
    sections.push("", "--- WARNINGS ---");
    sections.push(...warnings.map((w) => `  [!] ${w}`));
  }

  sections.push("", "=== END AUDIT REPORT ===");

  return {
    allows,
    prevents,
    worstCase,
    intentMatch,
    warnings,
    formatted: sections.join("\n"),
  };
}
