import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/demo",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4174/openstreamalert/",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "VITE_PUBLIC_DEMO=1 VITE_BASE_PATH=/openstreamalert/ npm run build && cp dist/client/index.html dist/client/404.html && npx vite preview --outDir dist/client --base /openstreamalert/ --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/openstreamalert/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
