# Windows desktop app

The Windows edition is designed to be the easiest way to run OpenStreamAlert:
install it, connect Twitch with a one-time code, and paste the displayed URL into
OBS. It bundles its own runtime—Node.js, Docker, a terminal, OpenSSL, and a Twitch
client secret are not required.

OpenStreamAlert is still pre-release, so a signed public installer is not yet
published. The repository already builds and smoke-tests the complete Windows
package on a pinned Windows 2022 toolchain; the live Windows/Twitch/OBS acceptance gate and code
signing must pass before that artifact becomes a supported download.

## Streamer quick start

Once the signed beta is published:

1. Download `OpenStreamAlert-Setup-x64.exe` from the GitHub release and run it.
   The per-user installer does not require administrator access.
2. Open OpenStreamAlert and press **Connect Twitch**.
3. Copy the short one-time code, press **Open Twitch**, and approve the single
   `user:read:chat` permission in your normal browser.
4. Choose a theme and copy the private OBS URL.
5. Add an OBS **Browser** source at 500×700 and paste the URL.

Closing the studio window keeps OpenStreamAlert in the Windows notification
area because OBS still needs its local chat service. Use **Quit
OpenStreamAlert** from the tray menu to stop it. **Start with Windows** is
available in that menu and remains opt-in.

The Browser Source URL uses the stable loopback address
`http://127.0.0.1:17071`. Only programs on the same PC can connect to the
listener. If port 17071 is occupied, the app shows a specific startup error
instead of silently changing the URL and breaking an existing OBS scene.

## Privacy on Windows

Application data lives under `%APPDATA%\OpenStreamAlert` for the current Windows
user. The SQLite database contains settings and encrypted Twitch credentials,
but never chat history. The randomly generated database-encryption key is itself
protected with Electron `safeStorage`, which uses Windows DPAPI. Neither the
OAuth access token nor its refresh token is placed in the OBS URL, renderer
storage, or desktop configuration file.

The desktop app uses Twitch's
[Device Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/).
Only OpenStreamAlert's public Twitch client ID is embedded in a release; a
reusable client secret is intentionally absent.

## Build an installer from source

Install Git and Node.js 24. npm can rebuild the bundled SQLite native module, so
source builds may also require Visual Studio 2022 Build Tools with the **Desktop
development with C++** workload. People using the published installer do not
need Node, npm, or Visual Studio.
Register a **public** Twitch application following
Twitch's [authentication guidance](https://dev.twitch.tv/docs/authentication/),
then use its client ID—never a client secret—from PowerShell:

```powershell
git clone https://github.com/ericflo/openstreamalert.git
Set-Location openstreamalert
npm ci
$env:TWITCH_DESKTOP_CLIENT_ID = "your-public-client-id"
npm run make:win
```

The Squirrel installer, update package, and portable ZIP appear under
`out\make`. Running `npm run desktop` starts the same desktop shell directly for
development.

For repository builds, set `TWITCH_DESKTOP_CLIENT_ID` as a GitHub Actions
repository variable. Private-repository CI artifacts are deliberately unsigned
test evidence; do not ask users to bypass SmartScreen for them.

## Signing and release policy

A public Windows release is blocked unless both the installed executable and
installer have a valid timestamped Authenticode signature from the configured
publisher. The release workflow requires:

- secret `WINDOWS_CERTIFICATE_BASE64`;
- secret `WINDOWS_CERTIFICATE_PASSWORD`;
- variable `WINDOWS_SIGNER_SUBJECT`;
- variable `WINDOWS_SIGNER_THUMBPRINT`;
- variable `TWITCH_DESKTOP_CLIENT_ID`.

The workflow checks the expected signer before creating a GitHub release. A new
publisher can still encounter SmartScreen reputation prompts initially; the
project will not describe an unsigned artifact as a frictionless release. Every
release also includes `SHA256SUMS-windows.txt` for the installer, update files,
and portable archive.

## Troubleshooting

- **The app is gone but OBS chat still works:** it is running in the notification
  area. Double-click the OpenStreamAlert icon.
- **OBS says the page is unavailable:** start OpenStreamAlert and leave it in the
  tray. Confirm `http://127.0.0.1:17071/readyz` opens in a browser.
- **Port 17071 is already in use:** quit the other OpenStreamAlert process or the
  program using that port, then reopen it. The port is intentionally stable.
- **The activation code expired:** return to the studio and press **Try again**.
- **A source-build says it needs a client ID:** rebuild after setting
  `TWITCH_DESKTOP_CLIENT_ID`; official releases will provide the project client
  ID automatically.
- **Windows cannot unlock the encrypted data key:** the app leaves every file
  untouched and offers to open its data directory. Restore `desktop.json`
  together with its matching database backup, or rename the whole
  `%APPDATA%\OpenStreamAlert` folder to begin a fresh connection. Replacing only
  the key file cannot decrypt the existing tokens.
