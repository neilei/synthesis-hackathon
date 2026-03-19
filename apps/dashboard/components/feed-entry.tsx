"use client";

import { memo, useState, useRef, useEffect } from "react";
import Image from "next/image";
import type { AgentLogEntry } from "@veil/common";
import { Badge } from "./ui/badge";
import { SponsorChip } from "./sponsor-chip";
import { truncateHash, formatCurrency, formatPercentage, formatAllocationSummary } from "@veil/common";
import { getScoreColor } from "@/lib/score-color";
import { PrivacyNotice } from "./privacy-notice";

interface FeedEntryProps {
  entry: AgentLogEntry;
}

const EXPLORER_URLS: Record<string, string> = {
  "ethereum-sepolia": "https://sepolia.etherscan.io/tx/",
  "base-sepolia": "https://sepolia.basescan.org/tx/",
};

// ── Reusable sub-components ──────────────────────────────────────────────

/** Status dot — vertically centered to the first line of text via flex centering. */
function StatusDot({ color }: { color: "green" | "red" | "blue" | "gray" }) {
  const cls: Record<string, string> = {
    green: "bg-accent-positive",
    red: "bg-accent-danger",
    blue: "bg-accent-secondary",
    gray: "bg-border",
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${cls[color]}`}
    />
  );
}

/** Block explorer tx link. */
function TxLink({ hash, chain = "ethereum-sepolia", label }: { hash: string | undefined; chain?: string; label?: string }) {
  if (!hash || hash === "0x0") return null;
  const base = EXPLORER_URLS[chain] ?? EXPLORER_URLS["ethereum-sepolia"];
  return (
    <a
      href={`${base}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-accent-secondary hover:underline"
    >
      {label ? `${label} ` : ""}{truncateHash(hash)}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

/** Model name in metadata slot. */
function ModelTag({ model }: { model: string | undefined }) {
  if (!model) return null;
  return (
    <span className="font-mono text-[10px] text-text-tertiary/60">{model}</span>
  );
}

/** Runtime duration in metadata slot. */
function RuntimeTag({ ms }: { ms: number | undefined }) {
  if (ms == null) return null;
  return (
    <span className="font-mono text-[10px] tabular-nums text-text-tertiary/60">
      {ms}ms
    </span>
  );
}

/** Venice DIEM token usage — shows total tokens with DIEM logo. */
function TokenUsageTag({ usage, showSymbol = true }: { usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined; showSymbol?: boolean }) {
  if (!usage?.totalTokens) return null;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-accent-secondary">
      <Image src="/sponsors/diem.png" alt="DIEM" width={12} height={12} className="shrink-0 rounded-full" />
      {usage.totalTokens.toLocaleString()}{showSymbol ? " DIEM" : ""}
    </span>
  );
}

/**
 * Consistent entry row layout. All feed entries use this wrapper.
 *
 * Layout: [dot] [content]
 * The dot is vertically centered to the first line height (20px for text-sm).
 * Padding is consistent: py-1.5 for all entries.
 */
function EntryRow({
  dot,
  children,
}: {
  dot: "green" | "red" | "blue" | "gray";
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5 py-1.5 text-sm">
      {/* Dot container: h-5 matches the line-height of text-sm (20px), centers the dot */}
      <div className="flex h-5 w-1.5 shrink-0 items-center">
        <StatusDot color={dot} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Primary line of a feed entry. Enforces consistent element ordering:
 * [Label] [Key Data] [Badges] [Brand] [Model] [Tx Links] [Runtime]
 *
 * All elements are inline with consistent gap spacing.
 */
function EntryLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {children}
    </div>
  );
}

/** Primary label — for significant actions (swaps, decisions, delegation). */
function EntryLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-medium text-text-primary">{children}</span>
  );
}

/** Secondary label — for routine/background actions (price fetch, portfolio check). */
function EntryLabelMuted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-text-tertiary">{children}</span>
  );
}

/** Monospace data value. */
function DataValue({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`font-mono tabular-nums text-text-secondary ${className}`}>
      {children}
    </span>
  );
}

/** Expandable reasoning text — only shows "show more" when text actually overflows. */
function ExpandableReasoning({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // scrollHeight > clientHeight when line-clamp truncates content
    setHasOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className={`text-text-tertiary text-xs leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
      >
        {text}
      </p>
      {!expanded && hasOverflow && (
        <button
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="text-accent-secondary text-[10px] hover:underline cursor-pointer mt-0.5 min-h-[44px] min-w-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm"
        >
          show more
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="text-text-tertiary/50 text-[10px] hover:underline cursor-pointer mt-0.5 min-h-[44px] min-w-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive rounded-sm"
        >
          hide
        </button>
      )}
    </div>
  );
}

/** Expandable detail row (used in Decision reasoning, Judge dimensions). */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-1">
      <div className="text-text-tertiary text-xs w-24 shrink-0">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Safely read a nested value from the untyped result record. */
function r(result: Record<string, unknown> | undefined, key: string): unknown {
  return result?.[key];
}

function getEntryLabel(action: string): string {
  const labels: Record<string, string> = {
    rebalance_decision: "Decision",
    swap_executed: "Swap",
    swap_failed: "Swap Failed",
    cycle_error: "Cycle Error",
    safety_block: "Safety Block",
    delegation_redeem_failed: "Delegation Failed",
    permit2_approval: "Permit2 Approval",
    quote_received: "Quote",
    price_fetch: "Price",
    portfolio_check: "Portfolio",
    pool_data_fetch: "Pools",
    budget_check: "Budget",
    cycle_complete: "Cycle",
    erc8004_feedback: "ERC-8004 Feedback",
    agent_start: "Agent Start",
    agent_stop: "Agent Stop",
    audit_report: "Audit Report",
    delegation_created: "Delegation",
    delegation_failed: "Delegation Failed",
    adversarial_check: "Safety Check",
    erc8004_register: "Identity",
    erc8004_register_failed: "Identity Failed",
    privacy_guarantee: "Privacy",
    worker_start: "Worker Start",
    worker_stop: "Worker Stop",
    worker_error: "Worker Error",
    judge_started: "Judge",
    judge_completed: "Judge",
    judge_warning: "Judge Warning",
    judge_failed: "Judge Failed",
    delegation_caveat_enforced: "Caveat Enforced",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

// ── Main component ───────────────────────────────────────────────────────

export const FeedEntry = memo(function FeedEntry({ entry }: FeedEntryProps) {
  const isError = !!entry.error;
  const res = entry.result;

  // ── Error entries ──────────────────────────────────────────────────
  if (isError) {
    return (
      <EntryRow dot="red">
        <EntryLine>
          <span className="font-medium text-accent-danger">
            {getEntryLabel(entry.action)}
          </span>
          <span className="text-text-tertiary">{entry.error}</span>
        </EntryLine>
      </EntryRow>
    );
  }

  // ── price_fetch ────────────────────────────────────────────────────
  // Layout: [Label] [ETH price] | [Venice] [model] [tokens] [runtime]
  if (entry.action === "price_fetch" && res) {
    const price = r(res, "price") as number | undefined;
    const model = r(res, "model") as string | undefined;
    const usage = r(res, "usage") as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    return (
      <EntryRow dot="gray">
        <EntryLine>
          <EntryLabelMuted>{getEntryLabel(entry.action)}</EntryLabelMuted>
          {price != null && <DataValue>ETH {formatCurrency(price)}</DataValue>}
          <SponsorChip sponsor="venice" text="Venice.ai" />
          <ModelTag model={model} />
          <TokenUsageTag usage={usage} />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── portfolio_check ────────────────────────────────────────────────
  // Layout: [Label] [total value] [allocation] | [runtime]
  if (entry.action === "portfolio_check" && res) {
    const totalUsdValue = r(res, "totalUsdValue") as number | undefined;
    const allocation = r(res, "allocation") as Record<string, number> | undefined;
    return (
      <EntryRow dot="gray">
        <EntryLine>
          <EntryLabelMuted>{getEntryLabel(entry.action)}</EntryLabelMuted>
          {totalUsdValue != null && <DataValue>{formatCurrency(totalUsdValue)}</DataValue>}
          {allocation && (
            <span className="font-mono tabular-nums text-text-tertiary">
              {formatAllocationSummary(allocation)}
            </span>
          )}
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── pool_data_fetch ────────────────────────────────────────────────
  // Layout: [Label] [pool count] | [Uniswap] [runtime]
  if (entry.action === "pool_data_fetch" && res) {
    const poolCount = r(res, "poolCount") as number | undefined;
    return (
      <EntryRow dot="gray">
        <EntryLine>
          <EntryLabelMuted>{getEntryLabel(entry.action)}</EntryLabelMuted>
          {poolCount != null && (
            <DataValue>{poolCount} pool{poolCount !== 1 ? "s" : ""}</DataValue>
          )}
          <SponsorChip sponsor="uniswap" text="Uniswap" />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── budget_check ───────────────────────────────────────────────────
  // Layout: [Label] [tier] | [runtime]
  if (entry.action === "budget_check" && res) {
    const tier = r(res, "tier") as string | undefined;
    return (
      <EntryRow dot="gray">
        <EntryLine>
          <EntryLabelMuted>{getEntryLabel(entry.action)}</EntryLabelMuted>
          {tier && (
            <span className={`font-mono text-xs ${tier === "critical" ? "text-accent-danger" : "text-text-secondary"}`}>
              {tier}
            </span>
          )}
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── safety_block ────────────────────────────────────────────────────
  // Layout: [Label] [reason badge] [amount if available] | [MetaMask]
  if (entry.action === "safety_block" && res) {
    const reason = r(res, "reason") as string | undefined;
    const swapAmountUsd = r(res, "swapAmountUsd") as number | undefined;
    const REASON_LABELS: Record<string, string> = {
      budget_exceeded: "Budget exceeded",
      per_trade_limit_exceeded: "Per-trade limit exceeded",
      trade_limit_reached: "Daily trade limit reached",
    };
    return (
      <EntryRow dot="red">
        <EntryLine>
          <span className="font-medium text-accent-danger">{getEntryLabel(entry.action)}</span>
          {reason && (
            <span className="text-text-tertiary">{REASON_LABELS[reason] ?? reason.replace(/_/g, " ")}</span>
          )}
          {swapAmountUsd != null && (
            <DataValue>{formatCurrency(swapAmountUsd)}</DataValue>
          )}
          <SponsorChip sponsor="metamask" text="Enforced" />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── rebalance_decision ─────────────────────────────────────────────
  // Layout: [Label] [Hold/Rebalance badge] | [Venice] [model] [tokens] [runtime]
  // Expanded: Reasoning + Market context rows
  if (entry.action === "rebalance_decision" && res) {
    const shouldRebalance = r(res, "shouldRebalance") as boolean;
    const reasoning = r(res, "reasoning") as string | undefined;
    const marketContext = r(res, "marketContext") as string | undefined;
    const model = r(res, "model") as string | undefined;
    const usage = r(res, "usage") as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    return (
      <EntryRow dot="green">
        <EntryLine>
          <EntryLabel>{getEntryLabel(entry.action)}</EntryLabel>
          <Badge variant={shouldRebalance ? "positive" : "warning"}>
            {shouldRebalance ? "Rebalance" : "Hold"}
          </Badge>
          <SponsorChip sponsor="venice" text="Venice.ai" />
          <ModelTag model={model} />
          <TokenUsageTag usage={usage} />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
        {(res as Record<string, unknown>)?._redacted ? (
          <PrivacyNotice className="mt-1.5" />
        ) : (
          <>
            {reasoning && (
              <DetailRow label="Reasoning">
                <ExpandableReasoning text={reasoning} />
              </DetailRow>
            )}
            {marketContext && (
              <DetailRow label="Market">
                <ExpandableReasoning text={marketContext} />
              </DetailRow>
            )}
          </>
        )}
      </EntryRow>
    );
  }

  // ── quote_received ─────────────────────────────────────────────────
  // Layout: [Label] [input → output] [delegation badge] | [Uniswap] [runtime]
  if (entry.action === "quote_received" && res) {
    const input = r(res, "input") as { amount?: string } | undefined;
    const output = r(res, "output") as { amount?: string } | undefined;
    const viaDelegation = r(res, "viaDelegation") as boolean | undefined;
    return (
      <EntryRow dot="blue">
        <EntryLine>
          <EntryLabel>{getEntryLabel(entry.action)}</EntryLabel>
          {input?.amount && output?.amount && (
            <DataValue>{input.amount} &rarr; {output.amount}</DataValue>
          )}
          {viaDelegation && <Badge variant="positive">delegation</Badge>}
          <SponsorChip sponsor="uniswap" text="Uniswap" />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── swap_executed ──────────────────────────────────────────────────
  // Layout: [Label] [sell → buy] [delegation badge] | [Uniswap] [tx link]
  if (entry.action === "swap_executed" && res) {
    const txHash = r(res, "txHash") as string | undefined;
    const viaDelegation = r(res, "viaDelegation") as boolean | undefined;
    return (
      <EntryRow dot="blue">
        <EntryLine>
          <EntryLabel>Swap</EntryLabel>
          <DataValue>
            {r(res, "sellAmount") as string} {r(res, "sellToken") as string}{" "}
            &rarr; {r(res, "buyToken") as string}
          </DataValue>
          {viaDelegation && <Badge variant="positive">delegation</Badge>}
          <SponsorChip sponsor="uniswap" text="Uniswap" />
          <TxLink hash={txHash} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── delegation_created ─────────────────────────────────────────────
  // Layout: [Label] [created (N caveats)] | [MetaMask] [tx link] [runtime]
  if (entry.action === "delegation_created" && res) {
    const txHash = r(res, "txHash") as string | undefined;
    const caveatsCount = r(res, "caveatsCount") as number | undefined;
    return (
      <EntryRow dot="green">
        <EntryLine>
          <EntryLabel>{getEntryLabel(entry.action)}</EntryLabel>
          <DataValue>
            created{caveatsCount != null ? ` (${caveatsCount} caveat${caveatsCount !== 1 ? "s" : ""})` : ""}
          </DataValue>
          <SponsorChip sponsor="metamask" text="MetaMask ERC-7715 / ERC-7710" />
          <TxLink hash={txHash} />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── judge_started ──────────────────────────────────────────────────
  // Layout: [Label] | [Venice]
  if (entry.action === "judge_started") {
    return (
      <EntryRow dot="gray">
        <EntryLine>
          <EntryLabelMuted>Judge evaluation started</EntryLabelMuted>
          <SponsorChip sponsor="venice" text="Venice.ai" />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── judge_completed ────────────────────────────────────────────────
  // Layout: [Label] [score] [reputation failed badge] | [Venice] [model] [tokens] [tx links] [runtime]
  // Expanded: Dimension scores with progress bars
  if (entry.action === "judge_completed" && res) {
    const composite = r(res, "composite") as number | undefined;
    const scores = r(res, "scores") as Record<string, number> | undefined;
    const reasonings = r(res, "reasonings") as Record<string, string> | undefined;
    const feedbackTxHash = r(res, "feedbackTxHash") as string | undefined;
    const validationRequestTxHash = r(res, "validationRequestTxHash") as string | undefined;
    const validationResponseTxHashes = r(res, "validationResponseTxHashes") as Record<string, string> | undefined;
    const outcome = r(res, "outcome") as string | undefined;
    const judgeModel = r(res, "model") as string | undefined;
    const judgeWarnings = r(res, "warnings") as string[] | undefined;
    const judgeUsage = r(res, "usage") as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    const hasOnChainFailures = (feedbackTxHash === "0x0" || !feedbackTxHash) || (judgeWarnings && judgeWarnings.length > 0);

    const compositeScore = composite != null ? composite * 10 : null;
    const scoreColor = compositeScore != null
      ? getScoreColor(compositeScore)
      : "text-text-secondary";

    const DIMENSION_LABELS: Record<string, { label: string; weight: string }> = {
      "decision-quality": { label: "Decision Quality", weight: "(40%)" },
      "execution-quality": { label: "Execution Quality", weight: "(30%)" },
      "goal-progress": { label: "Goal Progress", weight: "(30%)" },
    };

    return (
      <EntryRow dot={outcome === "failed" ? "red" : "green"}>
        <EntryLine>
          <EntryLabel>
            Judge{outcome === "failed" ? " (Failed Swap)" : ""}
          </EntryLabel>
          {compositeScore != null && (
            <span className={`font-mono tabular-nums font-medium ${scoreColor}`}>
              {compositeScore.toFixed(0)}/100
            </span>
          )}
          {hasOnChainFailures && <Badge variant="danger">reputation failed</Badge>}
          <SponsorChip sponsor="venice" text="Venice.ai" />
          <ModelTag model={judgeModel} />
          <TokenUsageTag usage={judgeUsage} />
          {feedbackTxHash && feedbackTxHash !== "0x0" && (
            <TxLink hash={feedbackTxHash} chain="base-sepolia" label="reputation" />
          )}
          {validationRequestTxHash && (
            <TxLink hash={validationRequestTxHash} chain="base-sepolia" label="request" />
          )}
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>

        {/* Dimension scores */}
        {scores && (
          <div className="mt-1.5 space-y-1">
            {Object.entries(scores).map(([tag, score]) => {
              const dim = DIMENSION_LABELS[tag];
              const reasoning = reasonings?.[tag];
              const isGoalProgress = tag === "goal-progress";
              const dimTxHash = validationResponseTxHashes?.[tag];

              if (isGoalProgress) {
                const advanced = score >= 50;
                return (
                  <div key={tag}>
                    <div className="flex items-center gap-2">
                      <div className="text-text-tertiary text-xs w-32 shrink-0">
                        {dim?.label ?? tag}
                        <span className="text-text-tertiary/50 text-[10px] ml-1">{dim?.weight}</span>
                      </div>
                      <span className={`font-mono text-xs font-medium ${advanced ? "text-accent-positive" : "text-accent-danger"}`}>
                        {advanced ? "Yes" : "No"}
                      </span>
                      <TxLink hash={dimTxHash} chain="base-sepolia" />
                    </div>
                    {reasoning && typeof reasoning === "string" && !reasoning.startsWith("[private") && (
                      <ExpandableReasoning text={reasoning} className="pl-[8.5rem] mt-0.5" />
                    )}
                  </div>
                );
              }

              const dimColor = getScoreColor(score);
              return (
                <div key={tag}>
                  <div className="flex items-center gap-2">
                    <div className="text-text-tertiary text-xs w-32 shrink-0">
                      {dim?.label ?? tag}
                      <span className="text-text-tertiary/50 text-[10px] ml-1">{dim?.weight}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <div className="h-1 flex-1 max-w-24 rounded-full bg-border overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getScoreColor(score, "bg")}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <span className={`font-mono tabular-nums text-xs ${dimColor}`}>
                        {score}
                      </span>
                      <TxLink hash={dimTxHash} chain="base-sepolia" />
                    </div>
                  </div>
                  {reasoning && typeof reasoning === "string" && !reasoning.startsWith("[private") && (
                    <ExpandableReasoning text={reasoning} className="pl-[8.5rem] mt-0.5" />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {(res as Record<string, unknown>)?._redacted && (
          <PrivacyNotice className="mt-2" />
        )}
      </EntryRow>
    );
  }

  // ── judge_warning ──────────────────────────────────────────────────
  // Layout: [Label] [error text] | [Venice]
  if (entry.action === "judge_warning" && res) {
    const error = r(res, "error") as string | undefined;
    return (
      <EntryRow dot="red">
        <EntryLine>
          <span className="font-medium text-accent-danger">
            {getEntryLabel(entry.action)}
          </span>
          {error && <span className="text-text-tertiary text-xs">{error}</span>}
          <SponsorChip sponsor="venice" text="Venice.ai" />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── cycle_complete ─────────────────────────────────────────────────
  // Layout: [Label] [total value] [drift] [ETH price] [allocation] | [runtime]
  if (entry.action === "cycle_complete" && res) {
    const totalValue = r(res, "totalValue") as number | undefined;
    const drift = r(res, "drift") as number | undefined;
    const ethPrice = r(res, "ethPrice") as number | undefined;
    const allocation = r(res, "allocation") as Record<string, number> | undefined;
    return (
      <EntryRow dot="green">
        <EntryLine>
          <EntryLabel>{getEntryLabel(entry.action)}</EntryLabel>
          {totalValue != null && <DataValue>{formatCurrency(totalValue)}</DataValue>}
          {drift != null && (
            <span className={`font-mono tabular-nums text-xs ${drift > 0.05 ? "text-accent-danger" : "text-text-tertiary"}`}>
              drift {formatPercentage(drift)}
            </span>
          )}
          {ethPrice != null && (
            <span className="font-mono tabular-nums text-xs text-text-tertiary">
              ETH {formatCurrency(ethPrice)}
            </span>
          )}
          {allocation && (
            <span className="text-text-tertiary hidden sm:inline">
              {formatAllocationSummary(allocation)}
            </span>
          )}
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── erc8004_register ───────────────────────────────────────────────
  // Layout: [Label] [Agent ID] | [ERC-8004] [tx link] [runtime]
  if (entry.action === "erc8004_register" && res) {
    const agentId = r(res, "agentId") as string | undefined;
    const txHash = r(res, "txHash") as string | undefined;
    return (
      <EntryRow dot="green">
        <EntryLine>
          <EntryLabel>{getEntryLabel(entry.action)}</EntryLabel>
          {agentId && <DataValue>Agent #{agentId}</DataValue>}
          <SponsorChip sponsor="protocol-labs" text="ERC-8004" />
          <TxLink hash={txHash} chain="base-sepolia" />
          <RuntimeTag ms={entry.duration_ms} />
        </EntryLine>
      </EntryRow>
    );
  }

  // ── Default: fallback for any unhandled entry type ─────────────────
  const fallbackTxHash = res ? (r(res, "txHash") as string | undefined) : undefined;

  return (
    <EntryRow dot="gray">
      <EntryLine>
        <EntryLabelMuted>{getEntryLabel(entry.action)}</EntryLabelMuted>
        <TxLink hash={fallbackTxHash} />
        <RuntimeTag ms={entry.duration_ms} />
      </EntryLine>
    </EntryRow>
  );
});
