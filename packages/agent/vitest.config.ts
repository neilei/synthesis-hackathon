/**
 * Vitest configuration for unit tests. Excludes e2e test files.
 *
 * @module @veil/agent/vitest.config
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.e2e.test.ts"],
    environment: "node",
  },
});
