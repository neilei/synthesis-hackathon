"use client";

import { useState, useCallback, useEffect, useMemo, memo } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { useIntents } from "@/hooks/use-intents";
import { useIntentDetail } from "@/hooks/use-intent-detail";
import { useIntentFeed } from "@/hooks/use-intent-feed";
import { usePublicIntents } from "@/hooks/use-public-intents";
import { usePublicIntentDetail } from "@/hooks/use-public-intent-detail";
import { usePublicIntentFeed } from "@/hooks/use-public-intent-feed";
import { deleteIntent, getIntentLogsUrl, safeParseParsedIntent, type IntentRecord } from "@/lib/api";
import { ActivityFeed } from "./activity-feed";
import { Audit } from "./audit";
import { StatsCard } from "./stats-card";
import { ErrorBanner } from "./error-banner";
import { SkeletonCard, SkeletonTable } from "./skeleton";
import { CycleCountdown } from "./cycle-countdown";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { AnimatedNumber } from "./ui/animated-number";

import { SectionHeading } from "./ui/section-heading";
import { PulsingDot } from "./ui/pulsing-dot";
import { AllocationBar } from "./allocation-bar";
import { StrategyDetails } from "./strategy-details";
import { AuthPrompt } from "./auth-prompt";
import { SponsorChip } from "./sponsor-chip";
import {
  generateAuditReport,
  formatCurrency,
} from "@maw/common";
import { getScoreColor } from "@/lib/score-color";
import type { ParsedIntent } from "@maw/common";

/** Wraps Audit with memoized audit report generation to avoid recomputing on every render. */
function MemoizedAudit({ parsed, onViewMonitor }: { parsed: ParsedIntent; onViewMonitor: () => void }) {
  const audit = useMemo(() => generateAuditReport(parsed), [parsed]);
  return <Audit data={{ parsed, audit }} onViewMonitor={onViewMonitor} />;
}

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

const IntentListItem = memo(function IntentListItem({
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
});

function IntentDetailView({
  intentId,
  token,
  isOwner,
  onBack,
  onDeleted,
}: {
  intentId: string;
  token: string | null;
  isOwner: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  // Use auth'd hooks when owner, public hooks otherwise
  const authDetail = useIntentDetail(isOwner ? intentId : null, token);
  const publicDetail = usePublicIntentDetail(!isOwner ? intentId : null);
  const { data, error, loading } = isOwner ? authDetail : publicDetail;

  const authFeed = useIntentFeed(isOwner ? intentId : null, token);
  const publicFeed = usePublicIntentFeed(!isOwner ? intentId : null);
  const { entries: feedEntries, sseError, liveSeqs } = isOwner ? authFeed : publicFeed;
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    setConfirmingDelete(false);
    setActionError(null);
    try {
      if (!token) return;
      await deleteIntent(intentId, token);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setDeleting(false);
    }
  }, [intentId, token, onDeleted, confirmingDelete]);

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

  const reputation = useMemo(() => {
    const judgeEntries = feedEntries.filter(
      (e) => e.action === "judge_completed" && e.result
    );
    if (judgeEntries.length === 0) return null;
    const scores = judgeEntries
      .map((e) => (e.result as Record<string, unknown>)?.composite as number | undefined)
      .filter((s): s is number => s != null);
    if (scores.length === 0) return null;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { average: avg, count: scores.length };
  }, [feedEntries]);

  if (loading && !data) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} index={i} />
          ))}
        </div>
        <Card className="p-5"><SkeletonTable rows={3} /></Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <Button variant="text" size="sm" onClick={onBack} className="mb-4">
          &larr; Back to agents
        </Button>
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!data) return null;

  const parsed = safeParseParsedIntent(data.parsedIntent);
  const ls = data.liveState as Record<string, unknown> | null;
  const agentId = ls?.agentId as string | undefined;
  const currentAllocation = ls?.allocation as Record<string, number> | undefined;
  const currentTotalValue = ls?.totalValue as number | undefined;
  const currentDrift = ls?.drift as number | undefined;
  const hasLiveAllocation = currentAllocation && Object.keys(currentAllocation).length > 0;

  // Derive active state from both DB status and live worker status.
  // If the worker has stopped but DB hasn't caught up yet, treat as inactive.
  const workerRunning = data.workerStatus === "running" || data.workerStatus === "queued";
  const isActive = data.status === "active" && workerRunning;
  const dbStatusActive = data.status === "active";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="text" size="sm" onClick={onBack} className="self-start">
          &larr; Back to agents
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setShowAudit(!showAudit)}>
            {showAudit ? "Hide Audit" : "View Audit"}
          </Button>
          {isOwner && (
            <Button onClick={handleDownloadLogs} disabled={downloadingLogs}>
              {downloadingLogs ? "Downloading..." : "Download agent_log.jsonl"}
            </Button>
          )}
          {isOwner && dbStatusActive && (
            <>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleting || !workerRunning}
                className={confirmingDelete ? "border-accent-danger bg-accent-danger/10" : ""}
              >
                {deleting ? "Stopping..." : confirmingDelete ? "Confirm Stop" : "Stop Agent"}
              </Button>
              {confirmingDelete && (
                <Button onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Inline Audit */}
      {showAudit && parsed && (
        <MemoizedAudit
          parsed={parsed}
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
          <span className="font-mono">Ethereum Sepolia</span>
          <span>Cycle {data.cycle}</span>
          <span className="hidden sm:inline">Created {new Date(data.createdAt * 1000).toLocaleDateString()}</span>
          <span>Expires {new Date(data.expiresAt * 1000).toLocaleDateString()}</span>
          {agentId && (
            <a
              href={`https://8004agents.ai/base-sepolia/agent/${agentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline transition-colors"
            >
              <SponsorChip sponsor="protocol-labs" text={`Agent #${agentId}`} />
            </a>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatsCard
          label="Trades Executed"
          value={String(data.tradesExecuted)}
          numericValue={data.tradesExecuted}
        />
        <StatsCard
          label="Total Spent"
          value={formatCurrency(data.totalSpentUsd)}
          numericValue={data.totalSpentUsd}
          formatValue={formatCurrency}
        />
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            Reputation
          </p>
          {reputation ? (
            <div className="mt-1">
              <span className={`font-mono text-2xl tabular-nums font-medium ${getScoreColor(reputation.average)}`}>
                {reputation.average.toFixed(0)}/100
              </span>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {reputation.count} evaluation{reputation.count !== 1 ? "s" : ""}
              </p>
            </div>
          ) : (
            <p className="mt-1 font-mono text-2xl tabular-nums text-text-secondary">
              —
            </p>
          )}
        </Card>
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

      {/* Portfolio Progress */}
      {parsed && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading>Portfolio Progress</SectionHeading>
            {currentTotalValue != null && currentTotalValue > 0 && (
              <span className="font-mono text-lg tabular-nums text-text-primary">
                <AnimatedNumber value={currentTotalValue} format={formatCurrency} />
              </span>
            )}
          </div>
          {hasLiveAllocation ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-text-secondary">Current</p>
                <AllocationBar allocation={currentAllocation} size="lg" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Target</p>
                  {currentDrift != null && (
                    <span className={`font-mono text-xs tabular-nums transition-colors duration-300 ease-out-data ${currentDrift > 0.05 ? "text-accent-danger" : "text-accent-positive"}`}>
                      <AnimatedNumber
                        value={currentDrift * 100}
                        format={(n) => `${n.toFixed(1)}% drift`}
                      />
                    </span>
                  )}
                </div>
                <AllocationBar allocation={parsed.targetAllocation} size="lg" ghost />
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-text-secondary">Target</p>
              <AllocationBar allocation={parsed.targetAllocation} size="lg" />
            </div>
          )}
          <div className="mt-4">
            <StrategyDetails parsed={parsed} compact />
          </div>
        </Card>
      )}

      {/* Activity Feed (live via SSE) */}
      {sseError && <ErrorBanner message={sseError} />}
      <ActivityFeed feed={feedEntries} liveSeqs={liveSeqs} />
    </div>
  );
}

function getInitialIntentId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("intent");
}

export function Monitor({ onNavigateConfigure }: MonitorProps) {
  const { isConnected, address } = useAccount();
  const { token, isAuthenticated, authenticating, authenticate, error: authError } = useAuth();
  const { intents: ownedIntents, error: ownedError, refresh: refreshOwned } = useIntents(address, token);
  const [showInactive, setShowInactive] = useState(false);
  const { intents: publicIntents, error: publicError, loading: publicLoading } = usePublicIntents(showInactive);
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

  // Determine if the selected intent is owned by the connected wallet
  const ownedIntentIds = useMemo(
    () => new Set(ownedIntents.map((i) => i.id)),
    [ownedIntents],
  );
  const isOwner = selectedIntentId ? ownedIntentIds.has(selectedIntentId) : false;

  // Detail view — owner gets full controls, others get read-only redacted view
  if (selectedIntentId) {
    return (
      <IntentDetailView
        intentId={selectedIntentId}
        token={token}
        isOwner={isOwner}
        onBack={() => selectIntent(null)}
        onDeleted={() => {
          selectIntent(null);
          refreshOwned();
        }}
      />
    );
  }

  // List view — loading state
  if (publicLoading) {
    return (
      <div className="space-y-4 p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  const activePublicCount = publicIntents.filter((i) => i.status === "active").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="sr-only">Monitor</h1>

      {/* Auth prompt — only if wallet connected but not authenticated */}
      {isConnected && !isAuthenticated && (
        <Card className="p-4">
          <AuthPrompt authenticating={authenticating} error={authError} onAuthenticate={authenticate} />
        </Card>
      )}

      {/* Owned intents — only when authenticated and has intents */}
      {isAuthenticated && ownedIntents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Your Agents</SectionHeading>
            <span className="text-xs text-text-tertiary">
              {ownedIntents.filter((i) => i.status === "active").length} active / {ownedIntents.length} total
            </span>
          </div>
          {ownedError && <ErrorBanner message={ownedError} />}
          {ownedIntents.map((intent) => (
            <IntentListItem key={intent.id} intent={intent} onSelect={selectIntent} />
          ))}
        </div>
      )}

      {/* Public intents — always visible */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeading>
            {isAuthenticated && ownedIntents.length > 0 ? "All Agents" : "Active Agents"}
          </SectionHeading>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">
              {activePublicCount} active / {publicIntents.length} total
            </span>
            <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-border bg-bg-surface text-accent-positive focus:ring-accent-positive h-3.5 w-3.5 cursor-pointer"
              />
              Show stopped
            </label>
          </div>
        </div>
        {publicError && <ErrorBanner message={publicError} />}
        {publicIntents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
              <div className="h-3 w-3 rounded-full bg-text-tertiary" />
            </div>
            <p className="max-w-md text-sm text-text-secondary">
              No agents are currently running.{!isConnected ? " Connect your wallet and deploy one from the Configure tab." : ""}
            </p>
            {isConnected && isAuthenticated && (
              <Button variant="solid" size="md" onClick={onNavigateConfigure} className="mt-2">
                Go to Configure
              </Button>
            )}
          </div>
        ) : (
          publicIntents.map((intent) => (
            <IntentListItem key={intent.id} intent={intent} onSelect={selectIntent} />
          ))
        )}
      </div>
    </div>
  );
}
