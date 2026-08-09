import { spawnSync } from "node:child_process";
import fs from "node:fs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the public demo build through npm.");

const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_PUBLIC_DEMO: "1",
    VITE_BASE_PATH: process.env.VITE_BASE_PATH ?? "/openstreamalert/",
  },
});
if (build.status !== 0) process.exit(build.status ?? 1);
fs.copyFileSync("dist/client/index.html", "dist/client/404.html");
