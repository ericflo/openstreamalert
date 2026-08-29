import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
import started from "electron-squirrel-startup";
import type { OpenStreamAlertRuntime } from "../server/runtime.js";

const DESKTOP_PORT = 17_071;
const APP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;
const startHidden = process.argv.includes("--hidden");
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let runtime: OpenStreamAlertRuntime | undefined;
let quitting = false;
let stopping = false;
let explainedTray = false;

if (started) app.quit();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--quit")) void quitCleanly();
    else showStudio();
  });
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (!runtime || stopping) return;
    event.preventDefault();
    void quitCleanly();
  });
  void app.whenReady().then(startDesktop);
}

async function startDesktop() {
  app.setAppUserModelId("com.openstreamalert.desktop");
  try {
    configureRuntime();
    configurePermissions();
    const module = await import("../server/runtime.js");
    runtime = await module.startRuntime();
    createTray();
    createWindow();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown startup error";
    if (error instanceof DesktopSecurityError) {
      const userData = app.getPath("userData");
      const choice = dialog.showMessageBoxSync({
        type: "error",
        title: "OpenStreamAlert security data needs attention",
        message: error.message,
        detail: `Your data was not changed. Restore a matching backup or rename this folder for a fresh setup:\n${userData}`,
        buttons: ["Open data folder", "Quit"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice === 0) await shell.openPath(userData);
      app.exit(1);
      return;
    }
    dialog.showErrorBox(
      "OpenStreamAlert could not start",
      message.includes("EADDRINUSE")
        ? `Port ${DESKTOP_PORT} is already in use. Close the other program or OpenStreamAlert process, then try again.`
        : message,
    );
    app.exit(1);
  }
}

function configurePermissions() {
  const allowed = (webContentsUrl: string, permission: string) => {
    try {
      return (
        permission === "clipboard-sanitized-write" &&
        new URL(webContentsUrl).origin === APP_URL
      );
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) =>
      callback(allowed(webContents.getURL(), permission)),
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(webContents && allowed(webContents.getURL(), permission)),
  );
}

function configureRuntime() {
  const userData = app.getPath("userData");
  const dataDirectory = path.join(userData, "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  process.env.OPENSTREAMALERT_DESKTOP = "1";
  process.env.NODE_ENV = "production";
  process.env.PORT = String(DESKTOP_PORT);
  process.env.BIND_ADDRESS = "127.0.0.1";
  process.env.APP_URL = APP_URL;
  process.env.CLIENT_PATH = path.join(app.getAppPath(), "dist", "client");
  process.env.DATABASE_PATH = path.join(
    dataDirectory,
    "openstreamalert.sqlite",
  );
  process.env.BUILD_VERSION = app.getVersion();
  process.env.TWITCH_CLIENT_ID = loadPublicClientId();
  process.env.TWITCH_CLIENT_SECRET = "";
  process.env.TWITCH_ALLOWED_USERS = "";
  process.env.ENCRYPTION_KEY = loadEncryptionKey(userData);
}

function loadPublicClientId() {
  const environment = process.env.TWITCH_DESKTOP_CLIENT_ID?.trim();
  if (environment) return environment;
  try {
    const value = JSON.parse(
      fs.readFileSync(
        path.join(process.resourcesPath, "desktop-config.json"),
        "utf8",
      ),
    ) as { twitchClientId?: unknown };
    return typeof value.twitchClientId === "string"
      ? value.twitchClientId.trim()
      : "";
  } catch {
    return "";
  }
}

function loadEncryptionKey(userData: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new DesktopSecurityError(
      "Windows secure storage is unavailable for this user account.",
    );
  const configPath = path.join(userData, "desktop.json");
  if (fs.existsSync(configPath)) {
    try {
      const value = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        protectedEncryptionKey?: unknown;
      };
      if (typeof value.protectedEncryptionKey !== "string")
        throw new Error("missing protected key");
      const key = safeStorage
        .decryptString(Buffer.from(value.protectedEncryptionKey, "base64"))
        .trim();
      if (Buffer.from(key, "base64").length !== 32)
        throw new Error("invalid protected key");
      return key;
    } catch {
      throw new DesktopSecurityError(
        "Windows could not unlock OpenStreamAlert's encrypted data key.",
      );
    }
  }
  const encryptionKey = randomBytes(32).toString("base64");
  const protectedEncryptionKey = safeStorage
    .encryptString(encryptionKey)
    .toString("base64");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ version: 1, protectedEncryptionKey }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  return encryptionKey;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1_280,
    height: 860,
    minWidth: 940,
    minHeight: 680,
    show: false,
    backgroundColor: "#0b0b0f",
    autoHideMenuBar: true,
    icon: desktopIcon(),
    title: "OpenStreamAlert",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === APP_URL) return;
    event.preventDefault();
    if (allowedExternalUrl(url)) void shell.openExternal(url);
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
    if (!explainedTray && process.platform === "win32") {
      explainedTray = true;
      tray?.displayBalloon({
        title: "OpenStreamAlert is still running",
        content:
          "OBS chat stays live from the notification area. Use the tray menu to quit.",
        noSound: true,
      });
    }
  });
  window.on("ready-to-show", () => {
    if (!startHidden) window?.show();
  });
  void window.loadURL(APP_URL);
}

function createTray() {
  tray = new Tray(desktopIcon());
  tray.setToolTip("OpenStreamAlert — keep running for OBS chat");
  tray.on("double-click", showStudio);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const loginItem = loginItemSettings();
  const opensAtLogin = app.getLoginItemSettings(loginItem).openAtLogin;
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Studio", click: showStudio },
      { type: "separator" },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: opensAtLogin,
        enabled: app.isPackaged,
        click: (item) => {
          app.setLoginItemSettings({ ...loginItem, openAtLogin: item.checked });
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      { label: "Quit OpenStreamAlert", click: () => void quitCleanly() },
    ]),
  );
}

function loginItemSettings() {
  if (process.platform === "win32" && app.isPackaged) {
    const executableName = path.basename(process.execPath);
    const updateExecutable = path.resolve(
      path.dirname(process.execPath),
      "..",
      "Update.exe",
    );
    if (fs.existsSync(updateExecutable))
      return {
        path: updateExecutable,
        args: [
          "--processStart",
          `"${executableName}"`,
          "--process-start-args",
          '"--hidden"',
        ],
      };
  }
  return { path: process.execPath, args: ["--hidden"] };
}

function showStudio() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function quitCleanly() {
  if (stopping) return;
  stopping = true;
  quitting = true;
  tray?.destroy();
  await runtime?.stop();
  runtime = undefined;
  app.quit();
}

function desktopIcon() {
  // Linux nativeImage cannot decode .ico; prefer the PNG there.
  const names =
    process.platform === "win32" ? ["icon.ico"] : ["icon.png", "icon.ico"];
  for (const name of names) {
    const icon = nativeImage.createFromPath(
      path.join(process.resourcesPath, name),
    );
    if (!icon.isEmpty()) return icon;
  }
  return nativeImage.createEmpty();
}

function allowedExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (
      url.hostname === "www.twitch.tv" &&
      ["/activate", "/activate/"].includes(url.pathname)
    )
      return true;
    return (
      url.hostname === "github.com" &&
      url.pathname.startsWith("/ericflo/openstreamalert")
    );
  } catch {
    return false;
  }
}

class DesktopSecurityError extends Error {}
