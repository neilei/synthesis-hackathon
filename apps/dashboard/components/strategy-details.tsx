import { formatPercentage } from "@veil/common";
import type { ParsedIntent } from "@veil/common";

interface StrategyDetailsProps {
  parsed: ParsedIntent;
  showDriftThreshold?: boolean;
  compact?: boolean;
}

export function StrategyDetails({
  parsed,
  showDriftThreshold = false,
  compact = false,
}: StrategyDetailsProps) {
  return (
    <dl className={`grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm ${compact ? "gap-y-2" : "gap-y-3"}`}>
      <div>
        <dt className="text-text-secondary">Daily Budget</dt>
        <dd className="font-mono text-text-primary">
          ${parsed.dailyBudgetUsd.toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className="text-text-secondary">Time Window</dt>
        <dd className="font-mono text-text-primary">
          {parsed.timeWindowDays} days
        </dd>
      </div>
      <div>
        <dt className="text-text-secondary">Max Slippage</dt>
        <dd className="font-mono text-text-primary">
          {formatPercentage(parsed.maxSlippage)}
        </dd>
      </div>
      {showDriftThreshold && (
        <div>
          <dt className="text-text-secondary">Drift Threshold</dt>
          <dd className="font-mono text-text-primary">
            {formatPercentage(parsed.driftThreshold)}
          </dd>
        </div>
      )}
      <div>
        <dt className="text-text-secondary">Max Trades/Day</dt>
        <dd className="font-mono text-text-primary">
          {parsed.maxTradesPerDay}
        </dd>
      </div>
      {parsed.maxPerTradeUsd > 0 && (
        <div>
          <dt className="text-text-secondary">Max Per Trade</dt>
          <dd className="font-mono text-text-primary">
            ${parsed.maxPerTradeUsd.toLocaleString()}
          </dd>
        </div>
      )}
    </dl>
  );
}
