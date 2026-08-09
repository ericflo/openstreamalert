# Twitch CLI protocol test

OpenStreamAlert includes an opt-in integration test against Twitch's official
local EventSub WebSocket server. It uses no Twitch account, application, OAuth
token, or internet request at test time.

## Setup

Install the current [Twitch CLI](https://dev.twitch.tv/docs/cli/) and make its
`twitch` executable available on `PATH`. The commands below follow Twitch's
official [WebSocket event testing guide](https://dev.twitch.tv/docs/cli/websocket-event-command/).
Then run:

```bash
npm run test:twitch-cli
```

To use an executable outside `PATH`:

```bash
TWITCH_CLI_BIN=/absolute/path/to/twitch npm run test:twitch-cli
```

The runner chooses a free loopback port, starts:

```text
twitch event websocket start-server --ip 127.0.0.1 --port <port>
```

It first simulates an ordinary network close with:

```text
twitch event websocket close --session <session-id> --reason 4006 --ip 127.0.0.1 --port <port>
```

and then asks the recovered connection to migrate with:

```text
twitch event websocket reconnect --ip 127.0.0.1 --port <port>
```

It verifies the real CLI Welcome, close, and reconnect frames; all five
subscription request bodies and their shared session ID; recovery after the
ordinary close; the replacement Welcome; closure of the old socket; and that the
carried subscription set is not recreated during migration.

## Deliberate boundary

Production still uses fixed Twitch HTTPS and WSS endpoints. The integration test
redirects socket creation and HTTP only through `TwitchChat`'s existing injected
test dependencies.

The CLI's mock subscription endpoint in released CLI v1.1.24 rejects the modern
`channel.chat.*` subscription types. For that reason the runner does not use
`--require-subscription`: it validates real CLI WebSocket transport while its
injected HTTP adapter records and accepts subscription requests. Unit tests
remain responsible for HTTP failure, authorization, timeout, and retry cases.

This harness cannot validate Twitch's production OAuth service, real chat event
payloads, CDN assets, reverse proxies, or OBS rendering. Those still require the
live acceptance procedure in [RELEASING.md](RELEASING.md).
