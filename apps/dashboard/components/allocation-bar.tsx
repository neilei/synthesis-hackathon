import { getTokenBg, getTokenLabel, getTokenLabelColor } from "@veil/common";

interface AllocationBarProps {
  allocation: Record<string, number>;
  label?: string;
  ghost?: boolean;
  size?: "sm" | "lg";
}

const BAR_SIZE = {
  sm: { height: "h-6", text: "text-[10px] font-medium", swatch: "h-2 w-2", labelText: "text-[10px]" },
  lg: { height: "h-8", text: "text-xs font-semibold", swatch: "h-2.5 w-2.5", labelText: "text-xs" },
} as const;

export function AllocationBar({
  allocation,
  label,
  ghost,
  size = "sm",
}: AllocationBarProps) {
  const entries = Object.entries(allocation);
  const total = entries.reduce((sum, [, val]) => sum + val, 0);
  const styles = BAR_SIZE[size];

  return (
    <div>
      {label && (
        <p className="mb-1.5 text-xs text-text-secondary">{label}</p>
      )}
      <div
        className={`flex ${styles.height} w-full overflow-hidden rounded ${ghost ? "border border-dashed border-border" : ""}`}
      >
        {entries.map(([token, value]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={token}
              className={`${getTokenBg(token)} ${ghost ? "opacity-25" : "opacity-90"} flex items-center justify-center ${styles.text} text-white transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${getTokenLabel(token)}: ${pct.toFixed(1)}%`}
            >
              {size === "lg" && pct >= 12 ? `${getTokenLabel(token)} ${pct.toFixed(0)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className={`mt-1 flex ${size === "lg" ? "gap-4 mt-2" : "gap-3"}`}>
        {entries.map(([token, value]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <span
              key={token}
              className={`flex items-center gap-1 ${styles.labelText} text-text-tertiary`}
            >
              <span
                className={`inline-block ${styles.swatch} rounded-sm ${getTokenBg(token)}`}
              />
              {size === "lg" ? (
                <>
                  <span className={getTokenLabelColor(token)}>{getTokenLabel(token)}</span>
                  <span className="font-mono text-text-secondary">{pct.toFixed(0)}%</span>
                </>
              ) : (
                <>{getTokenLabel(token)} {pct.toFixed(1)}%</>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
