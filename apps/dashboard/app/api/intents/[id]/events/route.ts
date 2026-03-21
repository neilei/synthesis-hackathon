import { API_PATHS } from "@maw/common";
import { type NextRequest } from "next/server";
import { AGENT_API_URL } from "@/lib/agent-url";

export const dynamic = "force-dynamic";

/**
 * SSE proxy: streams live log entries from the agent server to the browser.
 * EventSource cannot set custom headers, so auth is extracted from the
 * HttpOnly `maw_token` cookie (set during /api/auth/verify) and forwarded
 * as a Bearer token to the agent server.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agentUrl = `${AGENT_API_URL}${API_PATHS.intents}/${id}/events`;

    const headers: Record<string, string> = {};
    // Prefer explicit Authorization header (e.g. from fetch calls)
    const auth = request.headers.get("Authorization");
    if (auth) {
      headers["Authorization"] = auth;
    } else {
      // Fall back to HttpOnly cookie set during auth verify
      const token = request.cookies.get("maw_token")?.value;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    // Forward cookies so agent server can also read them directly
    const cookie = request.headers.get("Cookie");
    if (cookie) headers["Cookie"] = cookie;

    const res = await fetch(agentUrl, {
      cache: "no-store",
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return new Response(JSON.stringify({ error: text }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pipe the SSE stream through to the client
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Could not connect to the agent server." }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
