"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentLogEntry } from "@veil/common";
import { fetchPublicIntentDetail, type IntentRecord } from "@/lib/api";

export interface PublicIntentDetail extends IntentRecord {
  logs: AgentLogEntry[];
  liveState: unknown;
}

export function usePublicIntentDetail(
  intentId: string | null,
  intervalMs = 15000,
) {
  const [data, setData] = useState<PublicIntentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!intentId) return;
    try {
      const detail = await fetchPublicIntentDetail(intentId);
      setData(detail as PublicIntentDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch intent");
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    if (!intentId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intentId, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
