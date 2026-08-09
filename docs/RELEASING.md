# Release checklist

OpenStreamAlert is pre-release software. A green CI run proves the deterministic
demo and container paths; it does not replace a live Twitch and OBS acceptance
test. Do not tag a release until every required item below is complete.

The demo Browser Source path was smoke-tested on 2026-08-09 with OBS 32.1.2 on
Linux/Wayland at 500×700. OBS loaded the production build through `obs-browser`,
rendered the overlay, and produced a 500×700 true-alpha screenshot. This proves
the local CEF rendering path only; it does not satisfy the live Twitch gate.

## Prepare

- Choose the semantic version and create a short-lived release branch.
- Update `package.json` and `package-lock.json` to the same version.
- Move relevant entries in `CHANGELOG.md` from **Unreleased** into a dated
  version section and note any schema, configuration, or operator changes.
- Review dependency alerts, CodeQL results, licenses, and the final image scan.
- Confirm the setup, privacy, security, troubleshooting, and upgrade guidance
  still describes the shipped behavior.

## Automated gates

Run the same checks as CI from a clean checkout with Node 24:

```bash
npm ci
npm run format:check
npm run lint
npm run check
npm run test:coverage
npm run build
npm run test:e2e
docker build --build-arg VERSION=vX.Y.Z --build-arg REVISION="$(git rev-parse HEAD)" -t openstreamalert:vX.Y.Z .
```

Boot the image with a temporary data volume, wait for `/readyz`, confirm its
reported version, restart it, and verify that settings persisted. Test a backup
and restore before a release containing a database change.

## Live acceptance gate

Use a dedicated Twitch application and non-production channel. Remove secrets
and private overlay URLs from all captured evidence.

- Complete OAuth, save settings, copy the private URL, and load it in OBS 31 or
  later on each supported operating system.
- Verify ordinary messages, long and non-Latin text, native emotes, badges,
  replies, actions, notices, message deletion, user clearing, and chat clearing.
- Exercise OBS scene hide/show, Browser Source refresh, an ordinary network
  interruption, a Twitch-requested reconnect, token refresh, authorization
  revocation, overlay-key rotation, logout, and account deletion.
- Check 320×700, 500×700, and 1920×1080 viewports over bright and dark video,
  with reduced motion enabled and disabled.
- Confirm chat content and bearer URLs are absent from the database, browser
  storage, application logs, reverse-proxy logs, screenshots, and test artifacts.

Record the tested commit, Twitch/OBS versions, operating systems, and result in
the release notes. A failure in the core OAuth → EventSub → OBS path blocks the
release even when CI is green.

## Publish and verify

- Merge only after required CI and security checks pass on the exact commit.
- Create an annotated, signed `vX.Y.Z` tag and a GitHub release from that commit.
- Push the signed tag. The release workflow verifies it matches `package.json`,
  builds immutable version and commit-SHA GHCR tags for amd64/arm64, attaches OCI
  metadata, SBOM and provenance, scans the published digest, and creates the
  GitHub release with that digest. It intentionally publishes no `latest` tag.
- Re-run the clean-install and container readiness smoke against published
  artifacts, verify documentation links, and confirm the release is readable
  without maintainer-only permissions.
- Keep rollback instructions and the previous known-good image digest nearby.
