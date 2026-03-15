"use client";

import type { DeployResponse } from "../lib/types";

interface AuditProps {
  data: DeployResponse;
  onViewMonitor: () => void;
}

const TOKEN_COLORS: Record<string, string> = {
  ETH: "bg-emerald-500",
  WETH: "bg-emerald-500",
  USDC: "bg-indigo-500",
};

const TOKEN_LABEL_COLORS: Record<string, string> = {
  ETH: "text-emerald-400",
  WETH: "text-emerald-400",
  USDC: "text-indigo-400",
};

function getTokenColor(token: string): string {
  return TOKEN_COLORS[token.toUpperCase()] ?? "bg-amber-500";
}

function getTokenLabelColor(token: string): string {
  return TOKEN_LABEL_COLORS[token.toUpperCase()] ?? "text-amber-400";
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-accent-positive"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-accent-danger"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4 12 12M12 4 4 12" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-accent-warning"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2 1.5 13.5h13L8 2Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function Audit({ data, onViewMonitor }: AuditProps) {
  const { parsed, audit } = data;
  const allocationEntries = Object.entries(parsed.targetAllocation);

  return (
    <div className="space-y-6">
      {/* Two-column grid on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* LEFT COLUMN — Parsed Intent */}
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-text-secondary">
            Parsed Intent
          </h2>

          {/* Allocation bar */}
          <div className="mt-5">
            <div className="flex h-8 w-full overflow-hidden rounded">
              {allocationEntries.map(([token, pct]) => (
                <div
                  key={token}
                  className={`${getTokenColor(token)} flex items-center justify-center text-xs font-semibold text-white transition-all`}
                  style={{ width: `${(pct * 100).toFixed(0)}%` }}
                  title={`${token} ${(pct * 100).toFixed(0)}%`}
                >
                  {pct >= 0.12 ? `${token} ${(pct * 100).toFixed(0)}%` : ""}
                </div>
              ))}
            </div>
            {/* Labels below the bar for narrow segments */}
            <div className="mt-2 flex gap-4">
              {allocationEntries.map(([token, pct]) => (
                <div key={token} className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-sm ${getTokenColor(token)}`}
                  />
                  <span className={getTokenLabelColor(token)}>{token}</span>
                  <span className="font-mono text-text-secondary">{(pct * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key-value grid */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <span className="text-text-secondary">Daily Budget</span>
              <p className="font-mono text-text-primary">
                ${parsed.dailyBudgetUsd.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Time Window</span>
              <p className="font-mono text-text-primary">
                {parsed.timeWindowDays} days
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Max Slippage</span>
              <p className="font-mono text-text-primary">
                {(parsed.maxSlippage * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Drift Threshold</span>
              <p className="font-mono text-text-primary">
                {(parsed.driftThreshold * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-text-secondary">Max Trades/Day</span>
              <p className="font-mono text-text-primary">
                {parsed.maxTradesPerDay}
              </p>
            </div>
          </div>

          {/* Sponsor badge */}
          <p className="mt-6 text-xs text-text-tertiary">
            Powered by Venice
          </p>
        </div>

        {/* RIGHT COLUMN — Delegation Report */}
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-text-secondary">
            Delegation Report
          </h2>

          {audit ? (
            <div className="mt-5 space-y-5">
              {/* ALLOWS */}
              {audit.allows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-positive">
                    Allows
                  </h3>
                  <ul className="space-y-2">
                    {audit.allows.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded bg-accent-positive-dim px-3 py-2 text-sm text-text-primary"
                      >
                        <CheckIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* PREVENTS */}
              {audit.prevents.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-danger">
                    Prevents
                  </h3>
                  <ul className="space-y-2">
                    {audit.prevents.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded bg-accent-danger-dim px-3 py-2 text-sm text-text-primary"
                      >
                        <XIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* WORST CASE */}
              {audit.worstCase && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-warning">
                    Worst Case
                  </h3>
                  <div className="flex items-start gap-2 rounded bg-accent-warning-dim px-3 py-2 text-sm text-text-primary">
                    <WarningIcon />
                    <span>{audit.worstCase}</span>
                  </div>
                </div>
              )}

              {/* WARNINGS */}
              {audit.warnings.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-warning">
                    Warnings
                  </h3>
                  <ul className="space-y-2">
                    {audit.warnings.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded bg-accent-warning-dim px-3 py-2 text-sm text-text-primary"
                      >
                        <WarningIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 text-sm text-text-secondary">
              No delegation audit available.
            </p>
          )}

          {/* Sponsor badge */}
          <p className="mt-6 text-xs text-text-tertiary">
            Enforced by MetaMask Delegation
          </p>
        </div>
      </div>

      {/* BOTTOM — Status message + View Monitor button */}
      <div className="flex flex-col items-center justify-between gap-4 rounded-lg border border-border bg-bg-surface px-6 py-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-positive opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-positive" />
          </span>
          <span className="text-sm text-text-secondary">
            Agent is now monitoring your portfolio...
          </span>
        </div>
        <button
          type="button"
          onClick={onViewMonitor}
          className="rounded-lg border border-accent-positive bg-accent-positive/10 px-5 py-2 text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive/20"
        >
          View Monitor
        </button>
      </div>
    </div>
  );
}
