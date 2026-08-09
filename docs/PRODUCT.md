# Product brief

## The promise

OpenStreamAlert turns Twitch chat into a beautiful OBS overlay without an
account at another overlay company, a subscription, or a pasted access token.
Connect Twitch, make it yours, copy one browser-source URL, and stream.

## Product principles

1. **One calm path.** The primary journey has three verbs: connect, style,
   copy.
2. **Safe by default.** Twitch credentials never enter an overlay URL. Overlay
   keys are revocable and disclose no account secrets.
3. **Looks intentional immediately.** Every preset is broadcast-ready before a
   slider is touched.
4. **OBS is the target, not an afterthought.** Transparent rendering, reconnect
   behavior, fixed viewports, and low activity are first-class constraints.
5. **Own your stack.** A single small server and SQLite database are enough for
   a personal instance. Docker is a supported path, not a hosted upsell.
6. **Accessible controls, expressive output.** The studio works by keyboard and
   clearly labels controls; the overlay remains legible over unpredictable
   video.

## Version-one scope

- Twitch OAuth with the minimum read-chat permission
- EventSub WebSocket chat ingestion and automatic reconnection
- A revocable, secret overlay URL for OBS
- Native Twitch emotes, badges, replies, actions, and message deletion/clear
- Live preview with useful demo chat before Twitch is configured
- Carefully designed presets plus typography, color, spacing, motion, message
  lifetime, and alignment controls
- Responsive setup studio and transparent, fixed-viewport overlay route
- Docker and local Node deployment
- Tests, CI, security notes, contribution guidance, and architecture docs

## Explicit non-goals for version one

- Sending or moderating chat
- Third-party emote providers
- Alerts for follows, subscriptions, tips, raids, or channel points
- Multi-platform chat aggregation
- A hosted SaaS control plane or billing

The name deliberately leaves room for alerts later. Chat is the wedge and must
be excellent before the product expands.

## Success criteria

- A new self-hoster can reach the demo studio in under three minutes.
- A configured broadcaster can copy a working OBS URL in one session.
- No Twitch access token, refresh token, or client secret reaches browser logs,
  overlay URLs, or client storage.
- The overlay recovers from Twitch-requested reconnects and ordinary network
  interruption without user action.
- Empty, loading, offline, and authentication-expired states are understandable.
- The default overlay remains readable at 320 px wide over bright and dark video.

