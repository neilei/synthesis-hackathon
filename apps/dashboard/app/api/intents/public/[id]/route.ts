import { AGENT_API_URL } from "@/lib/agent-url";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${AGENT_API_URL}/api/intents/public/${id}`, {
      cache: "no-store",
    });
    const data: unknown = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
