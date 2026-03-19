import { API_PATHS } from "@veil/common";
import { proxyGet, proxyPost } from "@/lib/proxy";

export async function GET(request: Request) {
  return proxyGet(API_PATHS.intents, request, { forwardAuth: true });
}

export async function POST(request: Request) {
  return proxyPost(API_PATHS.intents, request, { forwardAuth: true });
}
