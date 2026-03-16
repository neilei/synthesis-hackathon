/**
 * POST /api/deploy proxy. Forwards intent to the agent server at :3147
 * and returns the parsed intent with audit report.
 *
 * @module @veil/dashboard/app/api/deploy/route
 */
import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.deploy}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
