import { API_PATHS } from "@veil/common";
import { AGENT_API_URL } from "@/lib/agent-url";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.authVerify}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
