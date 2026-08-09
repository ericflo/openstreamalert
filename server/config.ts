import { randomBytes } from "node:crypto";
import path from "node:path";

const port = Number(process.env.PORT ?? 5173);
const appUrl = (process.env.APP_URL ?? `http://localhost:${port}`).replace(
  /\/$/,
  "",
);

export const config = {
  port,
  appUrl,
  databasePath: path.resolve(
    process.env.DATABASE_PATH ?? "./data/openstreamalert.sqlite",
  ),
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  production: process.env.NODE_ENV === "production",
  sessionDays: 30,
};

export function twitchIsConfigured() {
  return Boolean(
    config.twitchClientId && config.twitchClientSecret && config.encryptionKey,
  );
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
