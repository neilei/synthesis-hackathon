"use client";

import { useAgentState } from "@/hooks/use-agent-state";
import { StatsCard } from "./stats-card";
import { SponsorBadge } from "./sponsor-badge";
import { ErrorBanner } from "./error-banner";
import { SkeletonCard, SkeletonTable } from "./skeleton";
import type { AgentLogEntry, SwapRecord } from "@/lib/types";

const AGENT_ADDRESS = "0xf13021F02E23a8113C1bD826575a1682F6Fac927";

const TOKEN_COLORS: Record<string, { bg: string; label: string }> = {
  ETH: { bg: "bg-emerald-500", label: "ETH" },
  WETH: { bg: "bg-emerald-500", label: "WETH" },
  USDC: { bg: "bg-indigo-500", label: "USDC" },
};

function getTokenColor(token: string): string {
  return TOKEN_COLORS[token]?.bg ?? "bg-zinc-500";
}

function getTokenLabel(token: string): string {
  return TOKEN_COLORS[token]?.label ?? token;
}

function truncateHash(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

function AllocationBar({
  allocation,
  label,
  ghost,
}: {
  allocation: Record<string, number>;
  label: string;
  ghost?: boolean;
}) {
  const entries = Object.entries(allocation);
  const total = entries.reduce((sum, [, val]) => sum + val, 0);

  return (
    <div>
      <p className="mb-1.5 text-xs text-text-secondary">{label}</p>
      <div
        className={`flex h-6 w-full overflow-hidden rounded ${ghost ? "border border-dashed border-border" : ""}`}
      >
        {entries.map(([token, value]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={token}
              className={`${getTokenColor(token)} ${ghost ? "opacity-25" : "opacity-90"} flex items-center justify-center text-[10px] font-medium text-white transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${getTokenLabel(token)}: ${pct.toFixed(1)}%`}
            >
              {pct >= 12 ? `${getTokenLabel(token)} ${pct.toFixed(0)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-3">
        {entries.map(([token, value]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <span key={token} className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <span className={`inline-block h-2 w-2 rounded-sm ${getTokenColor(token)}`} />
              {getTokenLabel(token)} {pct.toFixed(1)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TransactionRow({ tx }: { tx: SwapRecord }) {
  const statusColor =
    tx.status === "confirmed"
      ? "bg-accent-positive-dim text-accent-positive"
      : "bg-accent-warning-dim text-accent-warning";

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
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusColor}`}
        >
          {tx.status}
        </span>
      </td>
      <td className="py-2.5 text-xs text-text-tertiary">
        {formatTimestamp(tx.timestamp)}
      </td>
    </tr>
  );
}

function TransactionCard({ tx }: { tx: SwapRecord }) {
  const statusColor =
    tx.status === "confirmed"
      ? "bg-accent-positive-dim text-accent-positive"
      : "bg-accent-warning-dim text-accent-warning";

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
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusColor}`}
        >
          {tx.status}
        </span>
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
          <div className="rounded-lg border border-border bg-bg-surface p-5">
            <SkeletonTable rows={2} />
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-5">
            <SkeletonTable rows={3} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-bg-surface p-5">
          <SkeletonTable rows={3} />
        </div>
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
          Agent not deployed
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          No agent is currently running. Configure your portfolio intent and
          deploy the agent to start monitoring.
        </p>
        <button
          onClick={onNavigateConfigure}
          className="mt-2 cursor-pointer rounded-lg bg-accent-positive px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
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
        <div className="rounded-lg border border-border bg-bg-surface p-5">
          <h3 className="mb-4 text-sm font-medium text-text-primary">
            Allocation
          </h3>
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
        </div>

        {/* AI Reasoning card */}
        <div className="flex flex-col rounded-lg border border-border bg-bg-surface p-5">
          <h3 className="mb-4 text-sm font-medium text-text-primary">
            AI Reasoning
          </h3>
          {latestReasoning ? (
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">Decision:</span>
                {latestReasoning.shouldRebalance ? (
                  <span className="inline-flex items-center rounded-full bg-accent-positive-dim px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-positive">
                    Rebalance
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-accent-danger-dim px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-danger">
                    Hold
                  </span>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs text-text-secondary">Reasoning</p>
                <p className="text-sm leading-relaxed text-text-primary">
                  {latestReasoning.reasoning}
                </p>
              </div>
              {latestReasoning.marketContext && (
                <div>
                  <p className="mb-1 text-xs text-text-secondary">
                    Market Context
                  </p>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {latestReasoning.marketContext}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-text-tertiary">
                Waiting for first analysis cycle...
              </p>
            </div>
          )}
          <div className="mt-4 border-t border-border-subtle pt-3">
            <SponsorBadge text="Powered by Venice" />
          </div>
        </div>
      </div>

      {/* Bottom row — Transactions */}
      <div className="rounded-lg border border-border bg-bg-surface p-5">
        <h3 className="mb-4 text-sm font-medium text-text-primary">
          Transactions
        </h3>
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
              No trades yet — agent is monitoring for drift
            </p>
          </div>
        )}
        <div className="mt-4 border-t border-border-subtle pt-3">
          <SponsorBadge text="Trades via Uniswap" />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-bg-surface px-4 py-3 text-xs">
        {data.running ? (
          <span className="flex items-center gap-2 text-text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-positive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-positive" />
            </span>
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
      </div>
    </div>
  );
}
