/**
 * GET /api/state proxy. Forwards to the agent server and returns current
 * agent state for the Monitor tab.
 *
 * @module @veil/dashboard/app/api/state/route
 */
const AGENT_API_URL = process.env.AGENT_API_URL || "http://localhost:3147";

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API_URL}/api/state`, {
      cache: "no-store",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Agent server unreachable" },
      { status: 502 },
    );
  }
}
