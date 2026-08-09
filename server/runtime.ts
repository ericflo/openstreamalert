import type { Server } from "node:http";
import { createApp } from "./app.js";
import { config, twitchIsConfigured } from "./config.js";
import { cleanupExpiredSessions, closeDatabase } from "./database.js";
import { overlayStreams } from "./overlay-streams.js";
import { chats } from "./twitch.js";

export interface OpenStreamAlertRuntime {
  server: Server;
  stop(): Promise<void>;
}

export async function startRuntime(): Promise<OpenStreamAlertRuntime> {
  cleanupExpiredSessions();
  const cleanupTimer = setInterval(cleanupExpiredSessions, 6 * 60 * 60_000);
  cleanupTimer.unref();
  const application = await createApp();
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = application.listen(config.port, config.bindAddress, () =>
      resolve(listener),
    );
    listener.once("error", reject);
  });
  console.log(
    JSON.stringify({
      level: "info",
      event: "server.ready",
      url: config.appUrl,
      bindAddress: config.bindAddress,
      version: config.buildVersion,
      twitchConfigured: twitchIsConfigured(),
      runtimeMode: config.runtimeMode,
    }),
  );
  let stopping: Promise<void> | undefined;
  return {
    server,
    stop() {
      if (stopping) return stopping;
      stopping = new Promise<void>((resolve) => {
        clearInterval(cleanupTimer);
        chats.stopAll();
        overlayStreams.closeAll();
        server.close(() => {
          closeDatabase();
          resolve();
        });
      });
      return stopping;
    },
  };
}
