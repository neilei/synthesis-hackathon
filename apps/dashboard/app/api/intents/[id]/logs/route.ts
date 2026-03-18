import { API_PATHS } from "@veil/common";
import { type NextRequest } from "next/server";
import { AGENT_API_URL } from "@/lib/agent-url";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.intents}/${id}/logs`, {
      cache: "no-store",
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      return Response.json(data, { status: res.status });
    }

    // Stream the JSONL file through
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="${id}.jsonl"`,
      },
    });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
