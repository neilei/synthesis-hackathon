/**
 * Vitest configuration for e2e tests. 120-second timeout for external service calls.
 *
 * @module @veil/agent/vitest.e2e.config
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 120000,
  },
});
