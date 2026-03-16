"use client";

import { useAgentState } from "@/hooks/use-agent-state";
import { StatsCard } from "./stats-card";
import { SponsorBadge } from "./sponsor-badge";
import { ErrorBanner } from "./error-banner";
import { SkeletonCard, SkeletonTable } from "./skeleton";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { SectionHeading } from "./ui/section-heading";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import type { AgentLogEntry, SwapRecord } from "@veil/common";
import {
  AGENT_ADDRESS,
  truncateHash,
  truncateAddress,
  formatCurrency,
  formatTimestamp,
} from "@veil/common";

function parseBudgetMax(budgetTier: string): number | null {
  const match = budgetTier.match(/\$?([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

interface RebalanceResult {
  shouldRebalance: boolean;
  reasoning: string;
  marketContext: string;
}

function findLatestRebalanceEntry(
  feed: AgentLogEntry[]
): RebalanceResult | null {
  for (let i = feed.length - 1; i >= 0; i--) {
    const entry = feed[i];
    if (entry.action.toLowerCase().includes("rebalance") && entry.result) {
      const result = entry.result as Record<string, unknown>;
      if (
        typeof result.shouldRebalance === "boolean" &&
        typeof result.reasoning === "string"
      ) {
        return {
          shouldRebalance: result.shouldRebalance,
          reasoning: result.reasoning,
          marketContext:
            typeof result.marketContext === "string"
              ? result.marketContext
              : "",
        };
      }
    }
  }
  return null;
}

interface MonitorProps {
  onNavigateConfigure: () => void;
}

function TransactionRow({ tx }: { tx: SwapRecord }) {
  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="py-2.5 pr-4">
        <a
          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-accent-secondary hover:underline"
        >
          {truncateHash(tx.txHash)}
        </a>
      </td>
      <td className="py-2.5 pr-4 text-sm text-text-primary">
        {tx.sellToken} → {tx.buyToken}
      </td>
      <td className="py-2.5 pr-4 font-mono text-sm tabular-nums text-text-primary">
        {tx.sellAmount}
      </td>
      <td className="py-2.5 pr-4">
        <Badge variant={tx.status === "confirmed" ? "positive" : "warning"}>
          {tx.status}
        </Badge>
      </td>
      <td className="py-2.5 text-xs text-text-tertiary">
        {formatTimestamp(tx.timestamp)}
      </td>
    </tr>
  );
}

function TransactionCard({ tx }: { tx: SwapRecord }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-primary p-3">
      <div className="flex items-center justify-between">
        <a
          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-accent-secondary hover:underline"
        >
          {truncateHash(tx.txHash)}
        </a>
        <Badge variant={tx.status === "confirmed" ? "positive" : "warning"}>
          {tx.status}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-text-primary">
          {tx.sellToken} → {tx.buyToken}
        </span>
        <span className="font-mono tabular-nums text-text-primary">
          {tx.sellAmount}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-tertiary">
        {formatTimestamp(tx.timestamp)}
      </p>
    </div>
  );
}

export function Monitor({ onNavigateConfigure }: MonitorProps) {
  const { data, error, loading, refresh } = useAgentState(true);

  // Loading state
  if (loading && !data) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <SkeletonTable rows={2} />
          </Card>
          <Card className="p-5">
            <SkeletonTable rows={3} />
          </Card>
        </div>
        <Card className="p-5">
          <SkeletonTable rows={3} />
        </Card>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <ErrorBanner message={error} onRetry={refresh} />
      </div>
    );
  }

  // Not running / not deployed state
  if (data && !data.running && data.cycle === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="rounded-full bg-bg-surface p-4">
          <div className="h-3 w-3 rounded-full bg-accent-danger" />
        </div>
        <h2 className="text-lg font-medium text-text-primary">
          No agent running
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          Deploy an agent from the Configure tab to start autonomous portfolio monitoring.
        </p>
        <button
          onClick={onNavigateConfigure}
          className="mt-2 cursor-pointer rounded-lg bg-accent-positive px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 active:bg-emerald-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
        >
          Go to Configure
        </button>
      </div>
    );
  }

  // Data is available
  if (!data) return null;

  const driftPct = data.drift * 100;
  const driftColor =
    driftPct <= 5 ? "text-accent-positive" : "text-accent-danger";
  const budgetMax = parseBudgetMax(data.budgetTier);
  const budgetDisplay = budgetMax
    ? `${formatCurrency(data.totalSpent)} / ${formatCurrency(budgetMax)}`
    : formatCurrency(data.totalSpent);

  const latestReasoning = findLatestRebalanceEntry(data.feed);

  return (
    <div className="space-y-6 p-6">
      {/* Error banner (non-fatal, shown with stale data) */}
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {/* Top stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard
          label="Portfolio Value"
          value={formatCurrency(data.totalValue)}
        />
        <StatsCard
          label="Current Drift"
          value={`${driftPct.toFixed(1)}%`}
          valueColor={driftColor}
        />
        <StatsCard
          label="Trades Executed"
          value={String(data.trades)}
        />
        <StatsCard label="Budget Spent" value={budgetDisplay} />
      </div>

      {/* Middle row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Allocation card */}
        <Card className="p-5">
          <SectionHeading className="mb-4">Allocation</SectionHeading>
          <div className="space-y-4">
            <AllocationBar
              allocation={data.allocation}
              label="Current"
            />
            <AllocationBar
              allocation={data.target}
              label="Target"
              ghost
            />
          </div>
        </Card>

        {/* AI Reasoning card */}
        <Card className="flex flex-col p-5">
          <SectionHeading className="mb-4">AI Reasoning</SectionHeading>
          {latestReasoning ? (
            <div className="flex flex-1 flex-col gap-3">
              <div>
                {latestReasoning.shouldRebalance ? (
                  <Badge variant="positive">Rebalance</Badge>
                ) : (
                  <Badge variant="danger">Hold</Badge>
                )}
              </div>
              <p className="text-sm leading-relaxed text-text-primary">
                {latestReasoning.reasoning}
              </p>
              {latestReasoning.marketContext && (
                <p className="text-sm leading-relaxed text-text-tertiary">
                  {latestReasoning.marketContext}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-text-tertiary">
                Waiting for the agent&apos;s first decision...
              </p>
            </div>
          )}
          <div className="mt-5 border-t border-border-subtle pt-3">
            <SponsorBadge text="Powered by Venice" />
          </div>
        </Card>
      </div>

      {/* Bottom row — Transactions */}
      <Card className="p-5">
        <SectionHeading className="mb-4">Transactions</SectionHeading>
        {data.transactions.length > 0 ? (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Hash
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Pair
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Amount
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Status
                    </th>
                    <th className="pb-2 text-xs font-medium uppercase tracking-wider text-text-secondary">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((tx) => (
                    <TransactionRow key={tx.txHash} tx={tx} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-2 sm:hidden">
              {data.transactions.map((tx) => (
                <TransactionCard key={tx.txHash} tx={tx} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-text-tertiary">
              No trades yet — watching for rebalance opportunities
            </p>
          </div>
        )}
        <div className="mt-5 border-t border-border-subtle pt-3">
          <SponsorBadge text="Trades via Uniswap" />
        </div>
      </Card>

      {/* Status bar */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs">
        {data.running ? (
          <span className="flex items-center gap-2 text-text-primary">
            <PulsingDot size="sm" />
            Cycle {data.cycle}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-text-secondary">
            <span className="inline-flex h-2 w-2 rounded-full bg-accent-danger" />
            Agent stopped
          </span>
        )}
        <span className="font-mono text-text-tertiary tabular-nums">
          {truncateAddress(AGENT_ADDRESS)}
        </span>
        <span className="text-text-tertiary">Ethereum Sepolia</span>
        <span className="ml-auto hidden sm:inline-flex">
          <SponsorBadge text="Identity via ERC-8004" />
        </span>
      </Card>
    </div>
  );
}
