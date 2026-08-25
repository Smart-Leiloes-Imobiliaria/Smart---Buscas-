import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command:
      "npm run demo:seed && node --env-file-if-exists=.env.local --import tsx scripts/seed-e2e-users.ts && node --env-file-if-exists=.env.local --import tsx scripts/seed-e2e-property.ts && NEXT_DIST_DIR=.next-e2e npm run build && cp -R public .next-e2e/standalone/public && cp -R .next-e2e/static .next-e2e/standalone/.next-e2e/static && PORT=3100 HOSTNAME=127.0.0.1 node --env-file-if-exists=.env.local .next-e2e/standalone/server.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
