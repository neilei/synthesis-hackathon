"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { useIntents } from "@/hooks/use-intents";
import { useIntentDetail } from "@/hooks/use-intent-detail";
import { useIntentFeed } from "@/hooks/use-intent-feed";
import { deleteIntent, getIntentLogsUrl, safeParseParsedIntent, type IntentRecord } from "@/lib/api";
import { ActivityFeed } from "./activity-feed";
import { Audit } from "./audit";
import { StatsCard } from "./stats-card";
import { SponsorBadge } from "./sponsor-badge";
import { ErrorBanner } from "./error-banner";
import { SkeletonCard, SkeletonTable } from "./skeleton";
import { CycleCountdown } from "./cycle-countdown";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { SectionHeading } from "./ui/section-heading";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { Spinner } from "./ui/icons";
import { generateAuditReport } from "@veil/common";
import {
  truncateAddress,
  formatCurrency,
} from "@veil/common";


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
  const parsed = safeParseParsedIntent(intent.parsedIntent);

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
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
        <span>Cycle {intent.cycle}</span>
        <span>{intent.tradesExecuted} trades</span>
        <span>{formatCurrency(intent.totalSpentUsd)} spent</span>
        <span className="sm:ml-auto">
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
  const { entries: feedEntries, sseError } = useIntentFeed(intentId, token);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!confirm("Stop this agent? This action cannot be undone.")) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteIntent(intentId, token);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop agent");
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
      setActionError(err instanceof Error ? err.message : "Failed to download logs");
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
        <button onClick={onBack} className="mb-4 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm">
          &larr; Back to intents
        </button>
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!data) return null;

  const parsed = safeParseParsedIntent(data.parsedIntent);

  // Derive active state from both DB status and live worker status.
  // If the worker has stopped but DB hasn't caught up yet, treat as inactive.
  const workerRunning = data.workerStatus === "running" || data.workerStatus === "queued";
  const isActive = data.status === "active" && workerRunning;
  const dbStatusActive = data.status === "active";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={onBack} className="self-start text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm min-h-[44px] flex items-center">
          &larr; Back to intents
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAudit(!showAudit)}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive min-h-[44px]"
          >
            {showAudit ? "Hide Audit" : "View Audit"}
          </button>
          <button
            onClick={handleDownloadLogs}
            disabled={downloadingLogs}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive min-h-[44px]"
          >
            {downloadingLogs ? "Downloading..." : "Download Logs"}
          </button>
          {dbStatusActive && (
            <button
              onClick={handleDelete}
              disabled={deleting || !workerRunning}
              className="rounded-md border border-accent-danger/30 px-3 py-2 text-xs font-medium text-accent-danger transition-colors hover:bg-accent-danger/10 cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-danger min-h-[44px]"
            >
              {deleting ? "Stopping..." : "Stop Agent"}
            </button>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Inline Audit */}
      {showAudit && parsed && (
        <Audit
          data={{ parsed, audit: generateAuditReport(parsed) }}
          onViewMonitor={() => setShowAudit(false)}
        />
      )}

      {/* Intent text */}
      <Card className="px-5 py-3">
        <p className="font-mono text-sm text-text-primary">{data.intentText}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          <Badge variant={STATUS_BADGE[data.status] ?? "warning"}>
            {data.status}
          </Badge>
          <span>Cycle {data.cycle}</span>
          <span className="hidden sm:inline">Created {new Date(data.createdAt * 1000).toLocaleDateString()}</span>
          <span>Expires {new Date(data.expiresAt * 1000).toLocaleDateString()}</span>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Trades Executed" value={String(data.tradesExecuted)} />
        <StatsCard label="Total Spent" value={formatCurrency(data.totalSpentUsd)} />
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            Next Cycle
          </p>
          <div className="mt-1">
            <CycleCountdown
              lastCycleAt={data.lastCycleAt}
              intervalMs={20_000}
              isActive={isActive && data.workerStatus === "running"}
            />
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            Worker Status
          </p>
          <p className={`mt-1 font-mono text-2xl tabular-nums ${data.workerStatus === "running" ? "text-accent-positive" : "text-text-secondary"}`}>
            {data.workerStatus ?? "unknown"}
          </p>
          {data.workerStatus === "queued" && data.queuePosition != null && (
            <p className="mt-0.5 text-xs text-text-tertiary">
              Position {data.queuePosition} in queue
            </p>
          )}
        </Card>
      </div>

      {/* Allocation */}
      {parsed && (
        <Card className="p-5">
          <SectionHeading className="mb-4">Target Allocation</SectionHeading>
          <AllocationBar allocation={parsed.targetAllocation} size="lg" />
          <div className="mt-4">
            <StrategyDetails parsed={parsed} compact />
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
            <span aria-hidden="true" className="inline-flex h-2 w-2 rounded-full bg-accent-danger" />
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
      {sseError && <ErrorBanner message={sseError} />}
      <ActivityFeed feed={feedEntries} />
    </div>
  );
}

function getInitialIntentId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("intent");
}

export function Monitor({ onNavigateConfigure }: MonitorProps) {
  const { isConnected, address } = useAccount();
  const { token, isAuthenticated, authenticating } = useAuth();
  const { intents, error, loading, refresh } = useIntents(address, token);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(getInitialIntentId);

  const selectIntent = useCallback((id: string | null) => {
    if (id) {
      window.history.pushState({ intentId: id }, "", `?intent=${id}`);
    } else {
      window.history.pushState(null, "", window.location.pathname);
    }
    setSelectedIntentId(id);
  }, []);

  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      const intentId = (e.state as { intentId?: string } | null)?.intentId ?? null;
      setSelectedIntentId(intentId);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 sm:p-16 text-center">
        <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
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
      <div className="flex flex-col items-center justify-center gap-4 p-8 sm:p-16 text-center">
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
        onBack={() => selectIntent(null)}
        onDeleted={() => {
          selectIntent(null);
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
      <div className="flex flex-col items-center justify-center gap-4 p-8 sm:p-16 text-center">
        <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
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
          className="mt-2 cursor-pointer rounded-lg bg-accent-positive px-5 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-positive/90 active:bg-accent-positive/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
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
            onSelect={selectIntent}
          />
        ))}
      </div>
    </div>
  );
}
