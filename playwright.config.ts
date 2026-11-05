import { defineConfig } from "@playwright/test";

// End-to-end tests drive the real built Electron app, one test at a time.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
});
