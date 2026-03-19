"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchPublicIntents, type IntentRecord } from "@/lib/api";

export function usePublicIntents(includeInactive = false, intervalMs = 10000) {
  const [intents, setIntents] = useState<IntentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPublicIntents(includeInactive);
      setIntents([...data].sort((a, b) => b.createdAt - a.createdAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch intents");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, refresh]);

  return { intents, error, loading, refresh };
}
