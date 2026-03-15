"use client";

import { useState, useCallback } from "react";
import { deployAgent } from "@/lib/api";
import type { DeployResponse } from "@/lib/types";

export function useDeploy() {
  const [data, setData] = useState<DeployResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const deploy = useCallback(async (intent: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await deployAgent(intent);
      setData(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, error, loading, deploy, reset };
}
