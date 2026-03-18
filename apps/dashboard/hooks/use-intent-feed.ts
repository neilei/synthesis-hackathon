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
  const [sseError, setSseError] = useState<string | null>(null);
  const errorCountRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const seenSeqRef = useRef(new Set<number>());
  const lastReloadRef = useRef(0);

  const loadHistorical = useCallback(async () => {
    if (!intentId || !token) return;
    try {
      const data = await fetchIntentDetail(intentId, token);
      const logs = data.logs ?? [];
      setEntries(logs);
      seenSeqRef.current = new Set(logs.map((e) => e.sequence));
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

    // Connect SSE for live updates (withCredentials sends the HttpOnly cookie)
    const es = new EventSource(`/api/intents/${intentId}/events`, {
      withCredentials: true,
    });
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      // Reset error count on successful message — connection is working
      errorCountRef.current = 0;
      setSseError(null);

      try {
        const entry = JSON.parse(e.data) as AgentLogEntry;
        if (seenSeqRef.current.has(entry.sequence)) return;
        seenSeqRef.current.add(entry.sequence);
        setEntries((prev) => [...prev, entry]);
      } catch {
        // Skip malformed SSE data
      }
    });

    es.onerror = () => {
      errorCountRef.current++;
      if (errorCountRef.current >= 3) {
        setSseError("Live feed disconnected — retrying. Check auth or server status.");
      }
      // Debounce historical reloads to at most once per 5 seconds
      const now = Date.now();
      if (now - lastReloadRef.current > 5000) {
        lastReloadRef.current = now;
        loadHistorical();
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [intentId, token, loadHistorical]);

  return { entries, loading, sseError };
}
