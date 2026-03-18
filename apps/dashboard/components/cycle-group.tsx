"use client";

import { useState } from "react";
import type { CycleGroup as CycleGroupData } from "@/lib/group-feed";
import { FeedEntry } from "./feed-entry";
import { formatCurrency, formatPercentage } from "@veil/common";

interface CycleGroupProps {
  group: CycleGroupData;
  defaultExpanded?: boolean;
}

export function CycleGroup({ group, defaultExpanded = false }: CycleGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const total = group.entries.length;
  const successCount = group.entries.filter((e) => !e.error).length;
  const stepCountColor =
    total === 0
      ? "text-text-tertiary"
      : successCount === total
        ? "text-accent-positive"
        : "text-accent-danger";

  // Init group (no cycle number)
  if (group.cycle === null) {
    return (
      <div className="border-b border-border-subtle pb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary hover:bg-bg-primary"
        >
          <span
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          Initialization
          <span className={`ml-auto font-mono tabular-nums ${stepCountColor}`}>
            {successCount}/{total} steps
          </span>
        </button>
        {expanded && (
          <div className="mt-1 space-y-0 pl-4">
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
    ? Object.entries(snap.allocation)
        .map(([token, pct]) => `${(pct * 100).toFixed(0)}% ${token}`)
        .join(" / ")
    : null;

  return (
    <div className="border-b border-border-subtle pb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-bg-primary ${group.hasError ? "text-accent-danger" : "text-text-secondary"}`}
      >
        <span
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="font-medium text-text-primary">
          Cycle {group.cycle}
        </span>
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
        {group.hasError && (
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-danger" />
        )}
        {!group.didRebalance && group.cycle !== null && (
          <span className="text-text-tertiary">hold</span>
        )}
        <span className={`ml-auto font-mono tabular-nums ${stepCountColor}`}>
          {successCount}/{total} steps
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0 pl-4">
          {group.entries.map((entry) => (
            <FeedEntry key={entry.sequence} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
