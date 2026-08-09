import { startRuntime } from "./runtime.js";

const runtime = await startRuntime();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    const forcedExit = setTimeout(() => process.exit(1), 10_000);
    forcedExit.unref();
    await runtime.stop();
    clearTimeout(forcedExit);
    process.exit(0);
  });
}
