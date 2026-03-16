/**
 * Client-side fetch wrappers for /api/state and /api/deploy endpoints.
 *
 * @module @veil/dashboard/lib/api
 */
import type { AgentStateResponse, DeployResponse } from "@veil/common";

export async function fetchAgentState(): Promise<AgentStateResponse> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error("Failed to fetch state: unable to reach the agent server");
  return res.json();
}

export async function deployAgent(intent: string): Promise<DeployResponse> {
  const res = await fetch("/api/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `Deploy failed: ${res.status}`);
  }
  return res.json();
}
