# Architecture decisions

This is a living record of the decisions that make OpenStreamAlert simple to
operate and safe to use.

## Full-stack TypeScript, one deployable service

The studio is a React application built by Vite. An Express server serves the
compiled assets, OAuth routes, settings API, and overlay event stream. SQLite
stores accounts, encrypted Twitch credentials, sessions, and overlay settings.

One process keeps personal deployment understandable. The boundaries between
UI, domain logic, Twitch integration, and persistence remain explicit so a
future hosted edition can split them without rewriting the product.

## Server-owned Twitch credentials

Twitch OAuth uses the authorization-code flow. Access and refresh tokens are
encrypted at rest with an operator-provided key. Browser sessions use opaque,
HTTP-only cookies. Neither the studio nor the OBS page can read Twitch tokens.

The OBS URL contains a random overlay key. It is intentionally a bearer secret:
anyone with it may view that channel's public chat overlay. It can be rotated
from the studio immediately.

## EventSub over WebSockets

Twitch recommends EventSub for receiving chat. A server-side connection is
created only while at least one overlay is watching, then retired after a short
idle window. One connection carries chat messages and moderation events for the
channel. Twitch-directed reconnect URLs are honored without creating duplicate
subscriptions.

The server forwards a small normalized event model to browser sources with
Server-Sent Events (SSE). SSE fits the one-way data flow, reconnects natively in
CEF, traverses common reverse proxies, and keeps the overlay client small.

## URL routes, not generated HTML files

The studio lives at `/`; OAuth returns to `/auth/callback`; an overlay lives at
`/overlay/:key`. Settings remain server-side and stream into open overlays over
SSE, so saved changes appear live without producing a new URL or requiring an
OBS refresh.

## Progressive enhancement for development

Demo mode has no Twitch or database dependency beyond local startup. It uses
representative fixture messages, making visual work, screenshots, tests, and a
first evaluation possible before an operator registers a Twitch application.
