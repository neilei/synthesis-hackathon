"use client";

import { useState, useEffect } from "react";

interface CycleCountdownProps {
  lastCycleAt: number | null | undefined;
  intervalMs: number;
  isActive: boolean;
}

function computeSecondsLeft(
  lastCycleAt: number,
  intervalMs: number,
): number {
  const nextCycleAt = lastCycleAt + intervalMs / 1000;
  return Math.ceil(nextCycleAt - Date.now() / 1000);
}

function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function CycleCountdown({
  lastCycleAt,
  intervalMs,
  isActive,
}: CycleCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive || !lastCycleAt) return;

    function tick() {
      setSecondsLeft(computeSecondsLeft(lastCycleAt!, intervalMs));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastCycleAt, intervalMs, isActive]);

  if (!isActive || !lastCycleAt || secondsLeft == null) return null;

  if (secondsLeft <= 0) {
    return (
      <span className="font-mono text-2xl tabular-nums text-accent-positive animate-pulse">
        processing&hellip;
      </span>
    );
  }

  return (
    <span className="font-mono text-2xl tabular-nums text-text-primary">
      {formatCountdown(secondsLeft)}
    </span>
  );
}
