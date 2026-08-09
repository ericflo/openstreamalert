# Research notes

These decisions were re-checked against current platform documentation on
August 8, 2026. Links are primary sources for technical claims; competitor
pages are used only to understand established product expectations.

## Twitch

- Twitch recommends EventSub over IRC for new chat clients, while IRC remains
  active over its secure endpoint. EventSub WebSockets are the documented fit
  for installed/end-user-hosted clients: [chat authentication](https://dev.twitch.tv/docs/chat/authenticating/),
  [IRC concepts](https://dev.twitch.tv/docs/chat/irc/), and
  [product lifecycle](https://dev.twitch.tv/docs/product-lifecycle/).
- A custom chat feed is not anonymously available through the supported APIs.
  The read-only EventSub path needs a user token with `user:read:chat`:
  [chat message subscription](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage).
- EventSub delivers at least once. Clients must deduplicate delivery IDs, honor
  `session_reconnect`, recreate subscriptions after unplanned disconnects, and
  respect connection/subscription limits:
  [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).
- Twitch message fragments are the correct source for emotes and mentions.
  Badge identity is attached to each message and image metadata comes from the
  chat badge endpoints: [sending and receiving chat](https://dev.twitch.tv/docs/chat/send-receive-messages/)
  and [API reference](https://dev.twitch.tv/docs/api/reference/).
- OAuth credentials are password-equivalent. Third-party apps must validate
  maintained tokens hourly: [authentication](https://dev.twitch.tv/docs/authentication/)
  and [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).

## OBS Browser Source

- Browser Source is CEF-based, available on supported desktop platforms, and
  exposes explicit URL, viewport, FPS, CSS, visibility, and refresh settings:
  [OBS Browser Source](https://obsproject.com/kb/browser-source) and the
  [obs-browser project](https://github.com/obsproject/obs-browser#readme).
- OBS 31 moved Browser Source to Chromium 127. OpenStreamAlert treats that as
  its conservative browser baseline:
  [OBS 31 release notes](https://obsproject.com/blog/obs-studio-31-release-notes).
- Width and height define the browser viewport. They should match the intended
  on-canvas pixel box rather than being scaled from the 800×600 default.
- Keeping “shutdown when hidden” and “refresh when active” off avoids discarding
  chat state during scene switches. Network recovery remains mandatory because
  manual refreshes, OBS restarts, and ordinary failures still occur.

## Product landscape

[Streamlabs Chat Box](https://streamlabs.com/stream-widgets/chat-box) establishes
the expectation of a copyable Browser Source URL, visual controls, fading,
filters, and third-party emotes. [StreamElements overlays](https://docs.streamelements.com/overlays)
offer broad composition but require a multi-step visual-editor workflow.
[Social Stream Ninja](https://github.com/steveseguin/social_stream) demonstrates
the appeal of open, local-first, deeply extensible multi-platform tooling—and
the setup complexity that can accompany it.

OpenStreamAlert deliberately takes a narrower position: the convenience of a
hosted widget, the trust of a local/open tool, and a small opinionated studio
whose defaults need no design work.
