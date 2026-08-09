# Privacy and data flow

OpenStreamAlert has no built-in telemetry, advertising, crash reporter, or
third-party account system.

## What is stored

- Twitch user ID, login, and display name
- Twitch access and refresh tokens, encrypted with the operator's key
- Opaque web sessions and their expiry time
- The current overlay key and visual settings

## What is not stored

- Chat messages, usernames seen in chat, or chat history
- Viewer analytics, IP analytics, or behavioral events
- Email addresses—the app does not request the email scope

Live chat travels from Twitch to the server over EventSub, is converted to a
small display event in memory, and travels to connected OBS pages over SSE.
Browser sources keep only the currently visible bounded message list.

The overlay URL is an access secret because it displays a channel's public chat.
It contains no OAuth credential, can be paused without changing it, and can be
rotated immediately; either action closes existing streams. Choosing **Delete
account data** revokes the current Twitch token on a best-effort basis and
deletes the account, sessions, settings, and encrypted tokens from SQLite.

Self-hosters control their own server logs and reverse proxy. Configure those
systems not to retain full overlay paths, protect database backups and
`ENCRYPTION_KEY`, and publish a privacy notice if other people use the instance.
