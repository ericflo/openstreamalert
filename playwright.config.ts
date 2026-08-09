import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "on-first-retry" },
  webServer: {
    command: "npm start",
    env: {
      PORT: "4173",
      APP_URL: "http://127.0.0.1:4173",
      NODE_ENV: "production",
    },
    url: "http://127.0.0.1:4173/api/status",
    reuseExistingServer: !process.env.CI,
  },
});
