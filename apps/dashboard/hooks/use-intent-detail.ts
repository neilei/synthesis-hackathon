"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentLogEntry } from "@veil/common";
import { fetchIntentDetail, type IntentRecord } from "@/lib/api";

export interface IntentDetail extends IntentRecord {
  logs: AgentLogEntry[];
  liveState: unknown;
}

export function useIntentDetail(
  intentId: string | null,
  token: string | null,
  intervalMs = 15000,
) {
  const [data, setData] = useState<IntentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!intentId || !token) return;
    try {
      const detail = await fetchIntentDetail(intentId, token);
      // fetchIntentDetail returns IntentRecord & { logs, liveState } which structurally matches IntentDetail
      setData(detail as IntentDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch intent");
    } finally {
      setLoading(false);
    }
  }, [intentId, token]);

  useEffect(() => {
    if (!intentId || !token) {
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
  }, [intentId, token, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
