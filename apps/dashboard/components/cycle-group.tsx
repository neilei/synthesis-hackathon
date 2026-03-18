"use client";

import { useState } from "react";
import type { CycleGroup as CycleGroupData } from "@/lib/group-feed";
import { FeedEntry } from "./feed-entry";
import { formatCurrency, formatPercentage, formatAllocationSummary } from "@veil/common";
import { Spinner } from "./ui/icons";

interface CycleGroupProps {
  group: CycleGroupData;
  defaultExpanded?: boolean;
}

export function CycleGroup({ group, defaultExpanded = false }: CycleGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { completed, total, pendingLabel } = group.progress;
  const hasError = group.hasError;
  const stepCountColor = hasError
    ? "text-accent-danger"
    : group.isComplete
      ? "text-accent-positive"
      : "text-text-tertiary";

  const panelId = `cycle-panel-${group.cycle ?? "init"}`;

  // Init group (no cycle number)
  if (group.cycle === null) {
    const initTotal = group.entries.length;
    const initSuccess = group.entries.filter((e) => !e.error).length;
    const initColor = initTotal === 0
      ? "text-text-tertiary"
      : initSuccess === initTotal
        ? "text-accent-positive"
        : "text-accent-danger";
    return (
      <div className="border-b border-border-subtle pb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2.5 min-h-[44px] text-left text-xs font-medium uppercase tracking-wider text-text-tertiary hover:bg-bg-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
        >
          <span
            aria-hidden="true"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          Initialization
          <span className={`ml-auto font-mono tabular-nums ${initColor}`}>
            {initSuccess}/{initTotal} steps
          </span>
        </button>
        {expanded && (
          <div id={panelId} className="mt-1 space-y-0 pl-4">
            {group.entries.map((entry) => (
              <FeedEntry key={entry.sequence} entry={entry} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const snap = group.snapshot;
  const driftPct = snap ? snap.drift * 100 : null;
  const allocSummary = snap
    ? formatAllocationSummary(snap.allocation)
    : null;

  return (
    <div className="border-b border-border-subtle pb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={`flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2.5 min-h-[44px] text-left text-sm hover:bg-bg-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive ${hasError ? "text-accent-danger" : "text-text-secondary"}`}
      >
        <span
          aria-hidden="true"
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="font-medium text-text-primary">
          Cycle {group.cycle}
        </span>
        {!group.isComplete && (
          <span className="flex items-center gap-1.5 text-accent-positive">
            <Spinner className="h-3 w-3 animate-spin" />
            {pendingLabel && (
              <span className="text-text-tertiary">{pendingLabel}</span>
            )}
          </span>
        )}
        {snap && (
          <>
            <span className="font-mono tabular-nums">
              {formatCurrency(snap.totalValue)}
            </span>
            <span
              className={`font-mono tabular-nums ${driftPct != null && driftPct > 5 ? "text-accent-danger" : "text-accent-positive"}`}
            >
              {driftPct != null ? formatPercentage(snap.drift) : "---"}
            </span>
            <span className="hidden text-text-tertiary sm:inline">
              {allocSummary}
            </span>
          </>
        )}
        {hasError && (
          <>
            <span aria-hidden="true" className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-danger" />
            <span className="sr-only">Error in cycle</span>
          </>
        )}
        {group.isComplete && !group.didRebalance && group.cycle !== null && (
          <span className={group.wasSafetyBlocked ? "text-amber-400" : "text-text-tertiary"}>
            {group.wasSafetyBlocked ? "blocked" : "hold"}
          </span>
        )}
        <span className={`ml-auto font-mono tabular-nums ${stepCountColor}`}>
          {completed}/{total}
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="mt-1 space-y-0 pl-4">
          {group.entries.map((entry) => (
            <FeedEntry key={entry.sequence} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
