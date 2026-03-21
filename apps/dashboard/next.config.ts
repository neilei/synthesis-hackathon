/**
 * Next.js application configuration.
 *
 * @module @maw/dashboard/next.config
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for production: agent server serves the built files directly.
  // API proxy routes (app/api/) are only used during `next dev`.
  // Set NEXT_PUBLIC_STATIC_EXPORT=1 when building for the agent server.
  ...(process.env.STATIC_EXPORT === "1" ? { output: "export" as const } : {}),
};

export default nextConfig;
