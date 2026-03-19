import { AGENT_API_URL } from "./agent-url";

const PROXY_ERROR = { error: "Could not connect to the agent server." };

/**
 * Proxy a GET request to the agent API, forwarding query string and
 * optionally the Authorization header.
 */
export async function proxyGet(
  path: string,
  request: Request,
  options?: { forwardAuth?: boolean },
): Promise<Response> {
  try {
    const { search } = new URL(request.url);
    const headers: Record<string, string> = {};
    if (options?.forwardAuth) {
      headers["Authorization"] = request.headers.get("Authorization") ?? "";
    }
    const res = await fetch(`${AGENT_API_URL}${path}${search}`, {
      cache: "no-store",
      headers,
    });
    const data: unknown = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(PROXY_ERROR, { status: 502 });
  }
}

/**
 * Proxy a POST request to the agent API, forwarding the JSON body and
 * optionally the Authorization header.
 */
export async function proxyPost(
  path: string,
  request: Request,
  options?: { forwardAuth?: boolean },
): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.forwardAuth) {
      headers["Authorization"] = request.headers.get("Authorization") ?? "";
    }
    const res = await fetch(`${AGENT_API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(PROXY_ERROR, { status: 502 });
  }
}
