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
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm ${compact ? "gap-y-2" : "gap-y-3"}`}>
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
          {formatPercentage(parsed.maxSlippage)}
        </p>
      </div>
      {showDriftThreshold && (
        <div>
          <span className="text-text-secondary">Drift Threshold</span>
          <p className="font-mono text-text-primary">
            {formatPercentage(parsed.driftThreshold)}
          </p>
        </div>
      )}
      <div>
        <span className="text-text-secondary">Max Trades/Day</span>
        <p className="font-mono text-text-primary">
          {parsed.maxTradesPerDay}
        </p>
      </div>
      {parsed.maxPerTradeUsd > 0 && (
        <div>
          <span className="text-text-secondary">Max Per Trade</span>
          <p className="font-mono text-text-primary">
            ${parsed.maxPerTradeUsd.toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
