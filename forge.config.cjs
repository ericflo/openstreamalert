const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseVersion, FuseV1Options } = require("@electron/fuses");
const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const windowsSign = certificateFile
  ? {
      certificateFile,
      certificatePassword,
      timestampServer: "http://timestamp.digicert.com",
    }
  : undefined;

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.join(__dirname, "desktop", "assets", "icon"),
    executableName: "OpenStreamAlert",
    ...(windowsSign ? { windowsSign } : {}),
    extraResource: [
      path.join(__dirname, "dist", "desktop-config.json"),
      path.join(__dirname, "desktop", "assets", "icon.ico"),
      path.join(__dirname, "desktop", "assets", "icon.png"),
    ],
    ignore: [
      /^\/(?:\.git|\.github|coverage|data|docs|out|playwright-report|scripts|server|shared|src|test-results|tests)(?:\/|$)/,
      /^\/(?:\.env|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|Dockerfile|README|SECURITY|compose|playwright|tsconfig|vite|vitest)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "openstreamalert",
        authors: "OpenStreamAlert contributors",
        description: "Beautiful, private Twitch chat overlays for OBS",
        setupExe: "OpenStreamAlert-Setup-x64.exe",
        setupIcon: path.join(__dirname, "desktop", "assets", "icon.ico"),
        ...(windowsSign ? { windowsSign } : {}),
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
  plugins: [
    { name: "@electron-forge/plugin-auto-unpack-natives", config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};
