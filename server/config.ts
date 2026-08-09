import "dotenv/config";
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
  allowedTwitchUsers: (process.env.TWITCH_ALLOWED_USERS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
  buildVersion: process.env.BUILD_VERSION ?? "development",
};

if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("PORT must be an integer between 1 and 65535");
try {
  const parsedAppUrl = new URL(appUrl);
  if (parsedAppUrl.protocol !== "http:" && parsedAppUrl.protocol !== "https:")
    throw new Error("unsupported protocol");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(
    parsedAppUrl.hostname,
  );
  if (config.production && parsedAppUrl.protocol !== "https:" && !loopback)
    throw new Error("production requires HTTPS");
} catch {
  throw new Error(
    "APP_URL must be an absolute HTTP(S) URL; production non-loopback URLs require HTTPS",
  );
}
const twitchParts = [
  config.twitchClientId,
  config.twitchClientSecret,
  config.encryptionKey,
];
if (twitchParts.some(Boolean) && !twitchParts.every(Boolean))
  throw new Error(
    "TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and ENCRYPTION_KEY must be configured together",
  );
if (twitchParts.every(Boolean)) {
  if (Buffer.from(config.encryptionKey, "base64").length !== 32)
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as base64");
  if (config.production && config.allowedTwitchUsers.length === 0)
    throw new Error(
      "TWITCH_ALLOWED_USERS is required for a configured production deployment",
    );
}

export function twitchIsConfigured() {
  return Boolean(
    config.twitchClientId && config.twitchClientSecret && config.encryptionKey,
  );
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
