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

    // Forward Set-Cookie from agent server so the browser stores the
    // HttpOnly auth cookie (used by EventSource SSE which can't set headers).
    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) {
      responseHeaders.set("Set-Cookie", setCookie);
    }

    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "Could not connect to the agent server." },
      { status: 502 },
    );
  }
}
