import { API_PATHS } from "@veil/common";
import { proxyGet } from "@/lib/proxy";

export async function GET(request: Request) {
  return proxyGet(API_PATHS.authNonce, request);
}
