/**
 * Generates human-readable audit reports from an intent's constraints.
 * Shows what the agent is allowed to do, what it's prevented from doing,
 * worst-case damage, and warnings. Displayed in the dashboard Audit tab.
 *
 * Note: With ERC-7715, delegation is created browser-side. The backend
 * receives permissions but not the full Delegation object, so the audit
 * is now purely intent-based with optional permission metadata.
 *
 * @module @maw/agent/delegation/audit
 */
import type { IntentParse } from "../venice/schemas.js";
import { SECONDS_PER_DAY, detectAdversarialIntent } from "@maw/common";

// ---------------------------------------------------------------------------
// Detailed audit report generation
// ---------------------------------------------------------------------------

export interface DetailedAuditReport {
  allows: string[];
  prevents: string[];
  worstCase: string;
  intentMatch: string;
  warnings: string[];
  formatted: string;
}

/**
 * Generate a detailed audit report from an intent's constraints.
 * Optionally accepts permission metadata for the intent match section.
 */
export function generateDetailedAudit(
  intent: IntentParse,
  permissionInfo?: {
    permissionCount: number;
    types: string[];
    hasDelegationManager: boolean;
  },
): DetailedAuditReport {
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
    Date.now() + intent.timeWindowDays * SECONDS_PER_DAY * 1000,
  );

  // --- ALLOWS ---
  const allows: string[] = [
    `Trade up to $${intent.dailyBudgetUsd}/day for ${intent.timeWindowDays} days`,
    `Maximum ${intent.maxTradesPerDay} trades per day (${totalTrades} total)`,
    ...(intent.maxPerTradeUsd > 0
      ? [`Maximum $${intent.maxPerTradeUsd} per individual trade`]
      : []),
    `Slippage up to ${(intent.maxSlippage * 100).toFixed(1)}%`,
    `Rebalance when drift exceeds ${(intent.driftThreshold * 100).toFixed(1)}%`,
    `Target allocation: ${allocDesc}`,
  ];

  // --- PREVENTS ---
  const prevents: string[] = [
    `Spending more than $${totalBudget.toLocaleString()} total`,
    `More than ${totalTrades} trades over the full period`,
    ...(intent.maxPerTradeUsd > 0
      ? [`Any single trade exceeding $${intent.maxPerTradeUsd}`]
      : []),
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
  const matchChecks: string[] = [];
  if (permissionInfo) {
    matchChecks.push(
      `Permissions granted: ${permissionInfo.permissionCount} (${permissionInfo.types.join(", ")})`,
    );
    matchChecks.push(
      `DelegationManager: ${permissionInfo.hasDelegationManager ? "YES" : "NO"}`,
    );
  } else {
    matchChecks.push("Permissions: pending user grant via MetaMask Flask");
  }

  const intentMatch = matchChecks.join("; ");

  // --- WARNINGS ---
  const adversarialWarnings = detectAdversarialIntent(intent);
  const warnings = adversarialWarnings.map((w) => `WARNING: ${w.message}`);

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
