import { spawnSync } from "node:child_process";
import fs from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_PUBLIC_DEMO: "1",
    VITE_BASE_PATH: process.env.VITE_BASE_PATH ?? "/openstreamalert/",
  },
});
if (build.status !== 0) process.exit(build.status ?? 1);
fs.copyFileSync("dist/client/index.html", "dist/client/404.html");
