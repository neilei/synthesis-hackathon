"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLogEntry } from "@veil/common";
import { fetchIntentDetail } from "@/lib/api";

export function useIntentFeed(
  intentId: string | null,
  token: string | null,
) {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const maxSeqRef = useRef(-1);
  const esRef = useRef<EventSource | null>(null);

  const loadHistorical = useCallback(async () => {
    if (!intentId || !token) return;
    try {
      const data = await fetchIntentDetail(intentId, token);
      const logs = data.logs ?? [];
      setEntries(logs);
      maxSeqRef.current = logs.length > 0
        ? Math.max(...logs.map((e) => e.sequence))
        : -1;
    } finally {
      setLoading(false);
    }
  }, [intentId, token]);

  useEffect(() => {
    if (!intentId || !token) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadHistorical();

    // Connect SSE for live updates
    const es = new EventSource(`/api/intents/${intentId}/events`);
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const entry = JSON.parse(e.data) as AgentLogEntry;
        setEntries((prev) => {
          // Deduplicate by sequence
          if (prev.some((p) => p.sequence === entry.sequence)) return prev;
          return [...prev, entry];
        });
        if (entry.sequence > maxSeqRef.current) {
          maxSeqRef.current = entry.sequence;
        }
      } catch {
        // Skip malformed SSE data
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects. On reconnect we may have missed entries,
      // so reload historical data to fill gaps.
      loadHistorical();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [intentId, token, loadHistorical]);

  return { entries, loading };
}
