import type { AgentLogEntry } from "@veil/common";

export interface CycleSnapshot {
  allocation: Record<string, number>;
  drift: number;
  totalValue: number;
  ethPrice: number;
}

export interface CycleGroup {
  cycle: number | null;
  entries: AgentLogEntry[];
  snapshot: CycleSnapshot | null;
  hasError: boolean;
}

function extractSnapshot(entries: AgentLogEntry[]): CycleSnapshot | null {
  const complete = entries.find((e) => e.action === "cycle_complete");
  if (!complete?.result) return null;
  const r = complete.result;
  if (
    typeof r.allocation !== "object" ||
    r.allocation === null ||
    typeof r.drift !== "number" ||
    typeof r.totalValue !== "number" ||
    typeof r.ethPrice !== "number"
  ) {
    return null;
  }
  return {
    allocation: r.allocation as Record<string, number>,
    drift: r.drift,
    totalValue: r.totalValue,
    ethPrice: r.ethPrice,
  };
}

export function groupFeedByCycle(feed: AgentLogEntry[]): CycleGroup[] {
  if (feed.length === 0) return [];

  const map = new Map<number | null, AgentLogEntry[]>();
  const order: (number | null)[] = [];

  for (const entry of feed) {
    const key = entry.cycle ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(entry);
  }

  return order.map((key) => {
    const entries = map.get(key)!;
    return {
      cycle: key,
      entries,
      snapshot: key !== null ? extractSnapshot(entries) : null,
      hasError: entries.some((e) => !!e.error),
    };
  });
}
