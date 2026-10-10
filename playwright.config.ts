import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3211",
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3211/api/health",
    env: {
      PULSEMIC_PORT: "3211",
      LOCALAPPDATA: `${process.cwd()}/.local/browser-test`,
    },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
