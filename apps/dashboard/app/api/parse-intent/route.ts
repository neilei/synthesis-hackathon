import { API_PATHS } from "@veil/common";
import { proxyPost } from "@/lib/proxy";

export async function POST(request: Request) {
  return proxyPost(API_PATHS.parseIntent, request);
}
