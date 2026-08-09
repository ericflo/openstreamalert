# Architecture

OpenStreamAlert is one deployable TypeScript service with four deliberately
small boundaries.

| Boundary       | Responsibility                                                               |
| -------------- | ---------------------------------------------------------------------------- |
| React studio   | Authentication entry point, visual settings, preview, private URL management |
| React overlay  | Transparent rendering, bounded message lifetime, native SSE recovery         |
| Express server | OAuth, sessions, validation, public overlay endpoints, static assets         |
| Twitch adapter | Token refresh, badge metadata, EventSub lifecycle, normalized chat events    |

SQLite persists accounts, encrypted credentials, sessions, overlay keys, and
settings. Chat events are never inserted into the database.

## Runtime sequence

1. A broadcaster authorizes the single `user:read:chat` scope.
2. The callback exchanges the code server-side, validates it, encrypts both
   tokens with AES-256-GCM, and creates an HTTP-only session.
3. The studio saves validated settings and presents a random 256-bit overlay URL.
4. OBS loads that URL. The server looks up the owner and opens an EventSub
   WebSocket when the first SSE viewer arrives.
5. Chat fragments and moderation events are converted to a data-only model.
   React escapes all user text; no message HTML is accepted or generated.
6. Thirty seconds after the last viewer leaves, the Twitch connection closes.

## Recovery behavior

- Twitch-requested WebSocket reconnects transfer to the supplied URL before
  closing the old socket, preserving subscriptions.
- Unexpected closes use exponential backoff with jitter and recreate all
  subscriptions. EventSub has no replay, so a brief gap is possible.
- Delivery IDs are retained in a bounded set to remove at-least-once duplicates.
- SSE emits heartbeats to avoid proxy idle timeouts and lets the browser restore
  a dropped connection automatically.
- Access tokens are validated at least hourly while a chat connection is active
  and refreshed with serialized ownership in the one-process runtime.

## Scaling boundary

Version one intentionally targets a single process and local SQLite volume. Do
not run multiple replicas against the same database: each would create separate
EventSub connections and SSE clients would not share an event bus. A hosted
multi-replica edition should move identity/settings to a network database and
give each account a single leased chat worker backed by pub/sub.

## Compatibility boundary

OBS 31's Chromium 127 is the browser baseline. The overlay avoids recent-only
APIs, bounds DOM history to 100 messages, has no audio, and explicitly resets
the document to a transparent fixed viewport. Actual OBS smoke tests remain a
release requirement because off-screen CEF lifecycle differs from desktop Chrome.
