import { defineConfig, devices } from "@playwright/test";

/**
 * Takes the README screenshots (saved to ../screenshots) against a running stack loaded with the
 * sample organization (seed/sample). Run with `make screenshots`.
 */
export default defineConfig({
  testDir: "./e2e-screenshots",
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  },
});
