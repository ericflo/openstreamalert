import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "shared/**/*.ts",
        "server/{crypto,overlay-streams,twitch}.ts",
        "src/overlay/{feed,config-url}.ts",
      ],
      thresholds: { statements: 55, branches: 55, functions: 55, lines: 55 },
    },
  },
});
