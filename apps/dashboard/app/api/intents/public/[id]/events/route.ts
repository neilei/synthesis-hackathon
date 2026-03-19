import { AGENT_API_URL } from "@/lib/agent-url";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await fetch(
      `${AGENT_API_URL}/api/intents/public/${id}/events`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return new Response(JSON.stringify({ error: text }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

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
