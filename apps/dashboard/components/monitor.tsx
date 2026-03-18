"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { useIntents } from "@/hooks/use-intents";
import { useIntentDetail } from "@/hooks/use-intent-detail";
import { useIntentFeed } from "@/hooks/use-intent-feed";
import { deleteIntent, getIntentLogsUrl, type IntentRecord } from "@/lib/api";
import { ActivityFeed } from "./activity-feed";
import { StatsCard } from "./stats-card";
import { SponsorBadge } from "./sponsor-badge";
import { ErrorBanner } from "./error-banner";
import { SkeletonCard, SkeletonTable } from "./skeleton";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { SectionHeading } from "./ui/section-heading";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import { Spinner } from "./ui/icons";
import {
  truncateAddress,
  formatCurrency,
} from "@veil/common";
import type { ParsedIntent } from "@veil/common";

interface MonitorProps {
  onNavigateConfigure: () => void;
}

const STATUS_BADGE: Record<string, "positive" | "danger" | "warning"> = {
  active: "positive",
  paused: "warning",
  completed: "positive",
  expired: "danger",
  cancelled: "danger",
  failed: "danger",
};

function IntentListItem({
  intent,
  onSelect,
}: {
  intent: IntentRecord;
  onSelect: (id: string) => void;
}) {
  let parsed: ParsedIntent | null = null;
  try {
    parsed = JSON.parse(intent.parsedIntent) as ParsedIntent;
  } catch {
    // ignore parse failures
  }

  const isActive = intent.status === "active";
  const expiresDate = new Date(intent.expiresAt * 1000);

  return (
    <button
      onClick={() => onSelect(intent.id)}
      className="w-full text-left rounded-lg border border-border bg-bg-surface p-4 transition-colors hover:border-text-tertiary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isActive && <PulsingDot size="sm" />}
          <span className="text-sm text-text-primary truncate">
            {intent.intentText}
          </span>
        </div>
        <Badge variant={STATUS_BADGE[intent.status] ?? "warning"}>
          {intent.status}
        </Badge>
      </div>
      {parsed && (
        <div className="mt-3">
          <AllocationBar allocation={parsed.targetAllocation} size="sm" />
        </div>
      )}
      <div className="mt-2 flex items-center gap-4 text-xs text-text-tertiary">
        <span>Cycle {intent.cycle}</span>
        <span>{intent.tradesExecuted} trades</span>
        <span>{formatCurrency(intent.totalSpentUsd)} spent</span>
        <span className="ml-auto">
          Expires {expiresDate.toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

function IntentDetailView({
  intentId,
  token,
  onBack,
  onDeleted,
}: {
  intentId: string;
  token: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { data, error, loading } = useIntentDetail(intentId, token);
  const { entries: feedEntries } = useIntentFeed(intentId, token);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!confirm("Stop this agent? This action cannot be undone.")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteIntent(intentId, token);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setDeleting(false);
    }
  }, [intentId, token, onDeleted]);

  const [downloadingLogs, setDownloadingLogs] = useState(false);
  const handleDownloadLogs = useCallback(async () => {
    setDownloadingLogs(true);
    try {
      const url = getIntentLogsUrl(intentId);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to download logs");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${intentId}.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to download logs");
    } finally {
      setDownloadingLogs(false);
    }
  }, [intentId, token]);

  if (loading && !data) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <Card className="p-5"><SkeletonTable rows={3} /></Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="mb-4 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          &larr; Back to intents
        </button>
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!data) return null;

  let parsed: ParsedIntent | null = null;
  try {
    parsed = JSON.parse(data.parsedIntent) as ParsedIntent;
  } catch {
    // ignore
  }

  const isActive = data.status === "active";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          &larr; Back to intents
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadLogs}
            disabled={downloadingLogs}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary cursor-pointer disabled:opacity-50"
          >
            {downloadingLogs ? "Downloading..." : "Download Logs"}
          </button>
          {isActive && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md border border-accent-danger/30 px-3 py-1.5 text-xs font-medium text-accent-danger transition-colors hover:bg-accent-danger/10 cursor-pointer disabled:opacity-50"
            >
              {deleting ? "Stopping..." : "Stop Agent"}
            </button>
          )}
        </div>
      </div>

      {deleteError && <ErrorBanner message={deleteError} />}

      {/* Intent text */}
      <Card className="px-5 py-3">
        <p className="font-mono text-sm text-text-primary">{data.intentText}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary">
          <Badge variant={STATUS_BADGE[data.status] ?? "warning"}>
            {data.status}
          </Badge>
          <span>Cycle {data.cycle}</span>
          <span>Created {new Date(data.createdAt * 1000).toLocaleDateString()}</span>
          <span>Expires {new Date(data.expiresAt * 1000).toLocaleDateString()}</span>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Trades Executed" value={String(data.tradesExecuted)} />
        <StatsCard label="Total Spent" value={formatCurrency(data.totalSpentUsd)} />
        <StatsCard label="Cycle" value={String(data.cycle)} />
        <StatsCard
          label="Worker Status"
          value={data.workerStatus ?? "unknown"}
          valueColor={
            data.workerStatus === "running" ? "text-accent-positive" : "text-text-secondary"
          }
        />
      </div>

      {/* Allocation */}
      {parsed && (
        <Card className="p-5">
          <SectionHeading className="mb-4">Target Allocation</SectionHeading>
          <AllocationBar allocation={parsed.targetAllocation} size="lg" />
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-text-secondary">Daily Budget</span>
              <p className="font-mono text-text-primary">${parsed.dailyBudgetUsd.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-text-secondary">Time Window</span>
              <p className="font-mono text-text-primary">{parsed.timeWindowDays} days</p>
            </div>
            <div>
              <span className="text-text-secondary">Max Slippage</span>
              <p className="font-mono text-text-primary">{(parsed.maxSlippage * 100).toFixed(1)}%</p>
            </div>
            <div>
              <span className="text-text-secondary">Max Trades/Day</span>
              <p className="font-mono text-text-primary">{parsed.maxTradesPerDay}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Status bar */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs">
        {isActive ? (
          <span className="flex items-center gap-2 text-text-primary">
            <PulsingDot size="sm" />
            Active
          </span>
        ) : (
          <span className="flex items-center gap-2 text-text-secondary">
            <span className="inline-flex h-2 w-2 rounded-full bg-accent-danger" />
            {data.status}
          </span>
        )}
        <span className="font-mono text-text-tertiary tabular-nums">
          {truncateAddress(data.walletAddress)}
        </span>
        <span className="text-text-tertiary">Ethereum Sepolia</span>
        <span className="ml-auto hidden sm:inline-flex">
          <SponsorBadge text="Identity via ERC-8004" />
        </span>
      </Card>

      {/* Activity Feed (live via SSE) */}
      <ActivityFeed feed={feedEntries} />
    </div>
  );
}

export function Monitor({ onNavigateConfigure }: MonitorProps) {
  const { isConnected, address } = useAccount();
  const { token, isAuthenticated, authenticating } = useAuth();
  const { intents, error, loading, refresh } = useIntents(address, token);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);

  // Not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="rounded-full bg-bg-surface p-4">
          <div className="h-3 w-3 rounded-full bg-text-tertiary" />
        </div>
        <h2 className="text-lg font-medium text-text-primary">
          Connect your wallet
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          Connect your wallet to view your active agents and monitor their performance.
        </p>
      </div>
    );
  }

  // Authenticating
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        {authenticating ? (
          <>
            <Spinner className="h-6 w-6 animate-spin text-text-tertiary" />
            <p className="text-sm text-text-secondary">Authenticating wallet...</p>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary">Wallet authentication required.</p>
          </>
        )}
      </div>
    );
  }

  // Intent detail view
  if (selectedIntentId && token) {
    return (
      <IntentDetailView
        intentId={selectedIntentId}
        token={token}
        onBack={() => setSelectedIntentId(null)}
        onDeleted={() => {
          setSelectedIntentId(null);
          refresh();
        }}
      />
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="space-y-4 p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <ErrorBanner message={error} onRetry={refresh} />
      </div>
    );
  }

  // No intents
  if (intents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="rounded-full bg-bg-surface p-4">
          <div className="h-3 w-3 rounded-full bg-accent-danger" />
        </div>
        <h2 className="text-lg font-medium text-text-primary">
          No agents running
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

  // Intent list
  const activeCount = intents.filter((i) => i.status === "active").length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <SectionHeading>Your Agents</SectionHeading>
        <span className="text-xs text-text-tertiary">
          {activeCount} active / {intents.length} total
        </span>
      </div>
      <div className="space-y-3">
        {intents.map((intent) => (
          <IntentListItem
            key={intent.id}
            intent={intent}
            onSelect={setSelectedIntentId}
          />
        ))}
      </div>
    </div>
  );
}
