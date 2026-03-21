"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLogEntry } from "@maw/common";
import { fetchPublicIntentDetail } from "@/lib/api";

export function usePublicIntentFeed(intentId: string | null) {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sseError, setSseError] = useState<string | null>(null);
  const [liveSeqs, setLiveSeqs] = useState<Set<number>>(new Set());
  const errorCountRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const seenSeqRef = useRef(new Set<number>());
  const lastReloadRef = useRef(0);

  const loadHistorical = useCallback(async () => {
    if (!intentId) return;
    try {
      const data = await fetchPublicIntentDetail(intentId);
      const logs = data.logs ?? [];
      setEntries(logs);
      seenSeqRef.current = new Set(logs.map((e) => e.sequence));
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    if (!intentId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadHistorical();

    // Public SSE — no auth needed
    const es = new EventSource(`/api/intents/public/${intentId}/events`);
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      errorCountRef.current = 0;
      setSseError(null);

      try {
        const entry = JSON.parse(e.data) as AgentLogEntry;
        if (seenSeqRef.current.has(entry.sequence)) return;
        seenSeqRef.current.add(entry.sequence);
        setLiveSeqs((prev) => new Set(prev).add(entry.sequence));
        setEntries((prev) => [...prev, entry]);
      } catch {
        // Skip malformed SSE data
      }
    });

    es.onerror = () => {
      errorCountRef.current++;
      if (errorCountRef.current >= 3) {
        setSseError("Live feed disconnected — retrying.");
      }
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
  }, [intentId, loadHistorical]);

  return { entries, loading, sseError, liveSeqs };
}
