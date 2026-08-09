import "dotenv/config";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";

const port = Number(process.env.PORT ?? 5173);
const appUrl = (process.env.APP_URL ?? `http://localhost:${port}`).replace(
  /\/$/,
  "",
);
const desktop = process.env.OPENSTREAMALERT_DESKTOP === "1";
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : process.env.VITEST
    ? ":memory:"
    : path.resolve("./data/openstreamalert.sqlite");

export function parseBindAddress(value: string | undefined) {
  const address = value?.trim() || "127.0.0.1";
  if (address !== "localhost" && isIP(address) === 0)
    throw new Error(
      "BIND_ADDRESS must be localhost or an IPv4/IPv6 address without a port",
    );
  return address;
}

export const config = {
  port,
  appUrl,
  bindAddress: parseBindAddress(process.env.BIND_ADDRESS),
  runtimeMode: desktop
    ? ("desktop" as const)
    : process.env.NODE_ENV === "production"
      ? ("hosted" as const)
      : ("development" as const),
  databasePath,
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  production: process.env.NODE_ENV === "production",
  clientPath: path.resolve(process.env.CLIENT_PATH ?? "dist/client"),
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
if (!desktop && twitchParts.some(Boolean) && !twitchParts.every(Boolean))
  throw new Error(
    "TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and ENCRYPTION_KEY must be configured together",
  );
if (desktop && config.twitchClientSecret)
  throw new Error(
    "Desktop mode must use Twitch device authorization without a client secret",
  );
if (desktop && config.twitchClientId && !config.encryptionKey)
  throw new Error(
    "Desktop mode requires ENCRYPTION_KEY when TWITCH_CLIENT_ID is configured",
  );
if (
  (!desktop && twitchParts.every(Boolean)) ||
  (desktop && config.encryptionKey)
) {
  if (Buffer.from(config.encryptionKey, "base64").length !== 32)
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as base64");
  if (config.runtimeMode === "hosted" && config.allowedTwitchUsers.length === 0)
    throw new Error(
      "TWITCH_ALLOWED_USERS is required for a configured production deployment",
    );
}

export function twitchIsConfigured() {
  return Boolean(
    config.twitchClientId &&
    config.encryptionKey &&
    (config.runtimeMode === "desktop" || config.twitchClientSecret),
  );
}

export function twitchAuthMode() {
  if (!twitchIsConfigured()) return null;
  return config.runtimeMode === "desktop" ? "device" : "authorization-code";
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
