"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAgentState } from "@/lib/api";
import type { AgentStateResponse } from "@/lib/types";

export function useAgentState(enabled: boolean, intervalMs = 5000) {
  const [data, setData] = useState<AgentStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchAgentState();
      setData(state);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
