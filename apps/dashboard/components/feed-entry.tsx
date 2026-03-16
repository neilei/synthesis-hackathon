import type { AgentLogEntry } from "@veil/common";
import { Badge } from "./ui/badge";
import { truncateHash } from "@veil/common";

interface FeedEntryProps {
  entry: AgentLogEntry;
}

function getEntryLabel(action: string): string {
  const labels: Record<string, string> = {
    rebalance_decision: "Rebalance",
    swap_executed: "Swap",
    swap_failed: "Swap Failed",
    cycle_error: "Cycle Error",
    safety_block: "Safety Block",
    delegation_redeem_failed: "Delegation Failed",
    permit2_approval: "Permit2 Approval",
    quote_received: "Quote",
    price_fetch: "Price Fetch",
    portfolio_check: "Portfolio",
    pool_data_fetch: "Pool Data",
    budget_check: "Budget Check",
    cycle_complete: "Cycle Complete",
    erc8004_feedback: "ERC-8004 Feedback",
    agent_start: "Agent Start",
    agent_stop: "Agent Stop",
    audit_report: "Audit Report",
    delegation_created: "Delegation Created",
    delegation_failed: "Delegation Failed",
    adversarial_check: "Safety Check",
    erc8004_register: "Identity Registered",
    erc8004_register_failed: "Identity Failed",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

export function FeedEntry({ entry }: FeedEntryProps) {
  const isError = !!entry.error;
  const isRebalance = entry.action === "rebalance_decision";
  const isSwap = entry.action === "swap_executed";

  // Error entries
  if (isError) {
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-danger" />
        <div className="min-w-0">
          <span className="font-medium text-accent-danger">
            {getEntryLabel(entry.action)}
          </span>
          <span className="ml-2 text-text-tertiary">{entry.error}</span>
        </div>
      </div>
    );
  }

  // Rebalance decision
  if (isRebalance && entry.result) {
    const r = entry.result as Record<string, unknown>;
    const shouldRebalance = r.shouldRebalance as boolean;
    const reasoning = r.reasoning as string;
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-positive" />
        <div className="min-w-0">
          <Badge variant={shouldRebalance ? "positive" : "warning"}>
            {shouldRebalance ? "Rebalance" : "Hold"}
          </Badge>
          <span className="ml-2 text-text-secondary">{reasoning}</span>
        </div>
      </div>
    );
  }

  // Swap executed
  if (isSwap && entry.result) {
    const r = entry.result as Record<string, unknown>;
    const txHash = r.txHash as string;
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-secondary" />
        <div className="min-w-0">
          <span className="font-medium text-text-primary">Swap</span>
          <span className="ml-2 text-text-secondary">
            {r.sellAmount as string} {r.sellToken as string} →{" "}
            {r.buyToken as string}
          </span>
          {txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 font-mono text-xs text-accent-secondary hover:underline"
            >
              {truncateHash(txHash)}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Default: muted entry
  return (
    <div className="flex items-start gap-2 py-1 text-sm">
      <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
      <div className="min-w-0">
        <span className="text-text-tertiary">{getEntryLabel(entry.action)}</span>
        {entry.duration_ms != null && (
          <span className="ml-2 font-mono text-xs tabular-nums text-text-tertiary">
            {entry.duration_ms}ms
          </span>
        )}
      </div>
    </div>
  );
}
