import { defineConfig } from "vitest/config";

// Unit tests run in plain Node; DOM-free code only (the UI is covered by the Electron e2e tests).
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/shared/**/*.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
