import { API_PATHS } from "@veil/common";
import { AGENT_API_URL } from "@/lib/agent-url";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet");
    const res = await fetch(
      `${AGENT_API_URL}${API_PATHS.authNonce}?wallet=${encodeURIComponent(wallet ?? "")}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
