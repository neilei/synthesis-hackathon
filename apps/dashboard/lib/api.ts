/**
 * Client-side fetch wrappers for the Veil API.
 *
 * @module @veil/dashboard/lib/api
 */
import { ParsedIntentSchema } from "@veil/common";
import type { ParsedIntent, AuditReport, IntentRecord, AgentLogEntry } from "@veil/common";

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export async function fetchNonce(wallet: string): Promise<string> {
  const res = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) throw new Error("Failed to fetch nonce");
  const data = await res.json();
  return data.nonce;
}

export async function verifySignature(
  wallet: string,
  signature: string,
): Promise<string> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ wallet, signature }),
  });
  if (!res.ok) throw new Error("Auth verification failed");
  const data = await res.json();
  return data.token;
}

// ---------------------------------------------------------------------------
// Intent API
// ---------------------------------------------------------------------------

export async function parseIntent(
  intentText: string,
): Promise<{ parsed: ParsedIntent; audit: AuditReport }> {
  const res = await fetch("/api/parse-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: intentText }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `Parse failed: ${res.status}`);
  }
  return res.json();
}

export type { IntentRecord };

export async function createIntent(
  token: string,
  body: {
    intentText: string;
    parsedIntent: ParsedIntent;
    signedDelegation: string;
    delegatorSmartAccount: string;
    permissionsContext?: string;
    delegationManager?: string;
  },
): Promise<{ intent: IntentRecord; audit: AuditReport }> {
  const res = await fetch("/api/intents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Create intent failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchIntents(
  wallet: string,
  token: string,
): Promise<IntentRecord[]> {
  const res = await fetch(`/api/intents?wallet=${encodeURIComponent(wallet)}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch intents");
  return res.json();
}

export async function fetchIntentDetail(
  intentId: string,
  token: string,
): Promise<IntentRecord & { logs: AgentLogEntry[]; liveState: unknown }> {
  const res = await fetch(`/api/intents/${intentId}?limit=10000`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch intent");
  return res.json();
}

export async function deleteIntent(
  intentId: string,
  token: string,
): Promise<void> {
  const res = await fetch(`/api/intents/${intentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete intent");
}

export function getIntentLogsUrl(intentId: string): string {
  return `/api/intents/${intentId}/logs`;
}

export function safeParseParsedIntent(raw: string): ParsedIntent | null {
  try {
    const parsed = JSON.parse(raw);
    const result = ParsedIntentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
