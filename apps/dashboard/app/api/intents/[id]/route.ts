import { DEFAULT_AGENT_PORT, API_PATHS } from "@veil/common";
import { type NextRequest } from "next/server";

const AGENT_API_URL =
  process.env.AGENT_API_URL || `http://localhost:${DEFAULT_AGENT_PORT}`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.intents}/${id}`, {
      cache: "no-store",
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
      },
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await fetch(`${AGENT_API_URL}${API_PATHS.intents}/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
      },
    });
    if (res.status === 204) {
      return new Response(null, { status: 204 });
    }
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
