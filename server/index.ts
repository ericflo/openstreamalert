import { cleanupExpiredSessions } from "./database.js";
import { config, twitchIsConfigured } from "./config.js";
import { createApp } from "./app.js";
import { overlayStreams } from "./overlay-streams.js";
import { chats } from "./twitch.js";

cleanupExpiredSessions();
const cleanupTimer = setInterval(cleanupExpiredSessions, 6 * 60 * 60_000);
cleanupTimer.unref();
const app = await createApp();
const server = app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "server.ready",
      url: config.appUrl,
      version: config.buildVersion,
      twitchConfigured: twitchIsConfigured(),
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(cleanupTimer);
    chats.stopAll();
    overlayStreams.closeAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
