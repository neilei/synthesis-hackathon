/**
 * GET /api/state proxy. Forwards to the agent server and returns current
 * agent state for the Monitor tab.
 *
 * @module @veil/dashboard/app/api/state/route
 */
import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.state}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server. Make sure it's running." },
      { status: 502 },
    );
  }
}
