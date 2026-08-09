import fs from "node:fs";
import path from "node:path";

const clientId = (process.env.TWITCH_DESKTOP_CLIENT_ID ?? "").trim();
if (clientId.length > 128 || /[\r\n]/.test(clientId))
  throw new Error("TWITCH_DESKTOP_CLIENT_ID is invalid");
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(
  path.join("dist", "desktop-config.json"),
  `${JSON.stringify({ twitchClientId: clientId })}\n`,
  "utf8",
);
