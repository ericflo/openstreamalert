# Troubleshooting

## The studio says “Twitch setup needed”

At least one of `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, or `ENCRYPTION_KEY`
is absent. Confirm `.env` is beside `package.json`, restart the process, and
check `/api/health`. The encryption key must decode to exactly 32 bytes; the
documented `openssl` command produces the correct format.

## Twitch rejects the callback

The callback in Twitch's console must exactly equal
`APP_URL + /auth/callback`, including scheme, hostname, port, and path. Do not
use `localhost` in one place and `127.0.0.1` in the other.

## The Browser Source is blank

1. Open the private overlay URL in a normal browser on the streaming computer.
2. Confirm OpenStreamAlert is running and `/api/health` returns `{"ok":true}`.
3. If it was rotated, copy the new URL into OBS.
4. Press **Refresh cache of current page** in Browser Source properties.
5. Check reverse-proxy SSE buffering and timeouts on a hosted instance.
6. Reconnect Twitch in the studio if the overlay reports authorization trouble.

An empty transparent page can also mean chat is connected but nobody has spoken.
Use **Test message** in the studio to validate the appearance; demo messages do
not travel into OBS for a connected account.

## Messages disappear during scene changes

Turn off both **Shutdown source when not visible** and **Refresh browser source
when scene becomes active**. Either option discards or reloads the page during
normal scene switching.

## Text is blurry, clipped, or too large

Browser Source width and height are the page's actual viewport. Set them to the
pixel size the overlay should occupy in the OBS canvas, then tune text size in
the studio. Avoid dramatically scaling the source with the OBS transform.

Long messages intentionally wrap. If the lowest message is clipped, increase
height, reduce font size, or reduce the number of visible messages.

## Emotes or badges are missing

Twitch-native emotes render directly from structured message fragments. Badge
metadata loads when the EventSub session starts. A network filter blocking
`static-cdn.jtvnw.net` prevents both. Third-party emotes such as 7TV, BTTV, and
FFZ are roadmap items and currently remain plain chat text.

## Changes do not appear in OBS

Saved settings should update an open overlay immediately after the studio shows
“Saved live.” If they do not, confirm the overlay is online, verify that your
reverse proxy does not buffer `text/event-stream`, and then use OBS's **Refresh
cache of current page**. The URL does not need to be recopied unless it was
rotated. A paused overlay intentionally returns 404 until it is resumed.
