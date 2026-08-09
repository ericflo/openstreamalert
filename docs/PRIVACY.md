# Privacy and data flow

OpenStreamAlert has no built-in telemetry, advertising, crash reporter, or
third-party account system.

## What is stored

- Twitch user ID, login, and display name
- Twitch access and refresh tokens, encrypted with the operator's key
- Opaque web sessions and their expiry time
- The current overlay key and visual settings
- Usernames and phrases that the broadcaster explicitly adds to overlay filters

## What is not stored

- Chat messages, usernames seen in chat, or chat history
- Viewer analytics, IP analytics, or behavioral events
- Email addresses—the app does not request the email scope

Live chat travels from Twitch to the server over EventSub, is converted to a
small display event in memory, and travels to connected OBS pages over SSE.
Browser sources keep only the currently visible bounded message list.

The overlay URL is an access secret because it displays a channel's public chat.
It contains no OAuth credential, can be paused without changing it, and can be
rotated immediately. Pause clears connected overlays and suppresses new chat
while keeping their transport ready to resume; rotation terminates existing
streams. Choosing **Delete account data** revokes the current Twitch token on a
best-effort basis and deletes the account, sessions, settings, and encrypted
tokens from SQLite.

Self-hosters control their own server logs and reverse proxy. Configure those
systems not to retain full overlay paths, protect database backups and
`ENCRYPTION_KEY`, and publish a privacy notice if other people use the instance.

On Windows, data is stored beneath the current user's
`%APPDATA%\OpenStreamAlert` directory. The desktop app generates the encryption
key automatically and protects it with Windows DPAPI through Electron
`safeStorage`. The packaged public client contains a Twitch client ID, which is
not a secret, but never contains a Twitch client secret.
