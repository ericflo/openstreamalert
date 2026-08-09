# Changelog

Notable user-facing changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) once the first stable release is
tagged.

## Unreleased

- Add a self-contained Windows tray application and Squirrel installer build.
- Add secretless Twitch Device Code Grant for the desktop public client.
- Protect the Windows database key with DPAPI-backed Electron secure storage.
- Add Windows-native browser, SQLite, packaging, loopback, and launch smoke tests.

### Added

- Responsive design studio with four overlay themes and a no-credentials demo
- Read-only Twitch OAuth and EventSub chat ingestion
- Native Twitch emotes, badges, replies, notices, actions, and moderation clears
- Revocable private OBS URLs and automatic SSE/WebSocket recovery
- Live settings, privacy pause/resume, user/phrase filters, and portable config
- Versioned database migrations, production account allowlisting, and readiness diagnostics
- Encrypted SQLite credential storage with hourly token validation
- Hardened Docker deployment, coverage-gated CI, a release image scanner,
  public-launch CodeQL, browser acceptance tests, and operator documentation
