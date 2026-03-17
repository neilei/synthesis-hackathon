import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

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
