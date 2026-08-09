# Windows code-signing policy

## Current distribution status

The `windows-preview-0.1.1` installer and portable archive are intentionally
unsigned pre-release builds. Their GitHub Release includes SHA-256 checksums and
identifies the exact tested commit. They are not represented as a frictionless
or supported Windows release.

Ordinary CI builds the Windows package to exercise the real Electron,
Squirrel, SQLite, tray, loopback, and restart paths, but does not publish those
executables for end users. The supported beta remains blocked on a timestamped
Authenticode signature and the live Windows/Twitch/OBS acceptance matrix.

## Signing requirements

A supported Windows release must:

1. be built from an annotated, verified tag whose version matches
   `package.json`;
2. contain the project Twitch public client ID and no reusable client secret;
3. sign the installed executable, Squirrel installer, and executable inside the
   portable ZIP with the expected publisher certificate;
4. include a trusted timestamp so the signature survives certificate expiry;
5. publish SHA-256 checksums and pass the release workflow's identity checks;
6. be downloadable only from this repository's GitHub Releases page.

Signing credentials must never enter the repository or ordinary CI jobs. They
are loaded only by the isolated signed-release step and removed even when the
build fails.

## Open-source signing path

The preferred route is free code signing for qualifying open-source projects
through [SignPath Foundation](https://signpath.org/). The project is being made
public and publishing an honestly labeled preview first because SignPath's
eligibility rules require an active public project that is already released in
the form it intends to sign. Acceptance is not assumed; the README will credit
the service using SignPath's required wording only after approval.

If that route is unavailable, the alternatives are Microsoft's
[Artifact Signing](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
or a conventional OV code-signing certificate. A self-signed certificate will
not be used for a supported download.

## Ownership and review

Eric Florenzano is the current maintainer, release reviewer, and signing
approver. A future signing service integration must use a protected GitHub
environment, manual approval, and the trusted GitHub Actions build origin. No
contributor pull request receives signing credentials.

For the application's data handling, see [Privacy](PRIVACY.md). For removal and
local-data cleanup, see [Uninstall](WINDOWS.md#uninstall). For release gates, see
[Releasing](RELEASING.md).
