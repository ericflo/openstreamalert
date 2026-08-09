import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawn(npm, ["run", "build:demo"], { stdio: "inherit" });
build.once("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      "dist/client",
      "--base",
      "/openstreamalert/",
      "--host",
      "127.0.0.1",
      "--port",
      "4174",
      "--strictPort",
    ],
    { stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => vite.kill(signal));
  vite.once("exit", (viteCode) => process.exit(viteCode ?? 0));
});
