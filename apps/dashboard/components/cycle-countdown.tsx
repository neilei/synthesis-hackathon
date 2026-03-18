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
  return Math.max(0, Math.ceil(nextCycleAt - Date.now() / 1000));
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

  return (
    <span className="font-mono text-2xl tabular-nums text-text-primary">
      {secondsLeft}s
    </span>
  );
}
