"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchIntents, type IntentRecord } from "@/lib/api";

export function useIntents(
  wallet: string | undefined,
  token: string | null,
  intervalMs = 10000,
) {
  const [intents, setIntents] = useState<IntentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!wallet || !token) return;
    try {
      const data = await fetchIntents(wallet, token);
      setIntents([...data].sort((a, b) => b.createdAt - a.createdAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch intents");
    } finally {
      setLoading(false);
    }
  }, [wallet, token]);

  useEffect(() => {
    if (!wallet || !token) {
      setLoading(false);
      return;
    }

    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [wallet, token, intervalMs, refresh]);

  return { intents, error, loading, refresh };
}
