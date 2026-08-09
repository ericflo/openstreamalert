# Setup and deployment

## 1. Register a Twitch application

Open the [Twitch developer console](https://dev.twitch.tv/console/apps), enable
two-factor authentication if required, and create an application. Add one exact
OAuth redirect URL:

- Local: `http://localhost:5173/auth/callback`
- Hosted: `https://chat.example.com/auth/callback`

Choose an application category appropriate for a website integration. Copy the
client ID and generate a client secret. Never commit the secret.

## 2. Configure OpenStreamAlert

```bash
cp .env.example .env
openssl rand -base64 32
```

Set `APP_URL` to the origin users will actually open, without a trailing slash.
Set the Twitch values and paste the generated encryption key. Changing that key
after an account connects makes its stored credentials unreadable; keep an
encrypted backup.

For local development:

```bash
npm ci
npm run dev
```

For a production Node process:

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

For Docker:

```bash
docker compose up -d --build
docker compose logs -f openstreamalert
```

Back up the Docker volume or the configured `DATABASE_PATH`. SQLite uses WAL;
use a SQLite-aware backup or stop the service before copying its database files.

## 3. Put HTTPS in front

Remote OAuth and overlays should use HTTPS. A reverse proxy must:

- forward the original host and HTTPS scheme;
- disable buffering for `text/event-stream` responses;
- allow long-lived responses and send no intermediary HTML;
- avoid logging full `/overlay/:key` paths, or redact them;
- proxy to port 5173 and keep the application single-instance.

The included `X-Accel-Buffering: no` header handles common nginx setups, but
verify that a test message appears immediately through your actual proxy.

## 4. Add the Browser Source

In OBS 31 or later:

1. Add **Browser** under **Sources**.
2. Paste the private overlay URL.
3. Use dimensions matching its final pixel footprint. Start with 500×700 for a
   sidebar or 1920×1080 if positioning chat across the full canvas.
4. Leave **Use custom frame rate** off, or choose 30 FPS.
5. Leave **Shutdown source when not visible** off.
6. Leave **Refresh browser source when scene becomes active** off.
7. Leave audio routing off and set **Page Permissions** to None if available.

Resize the browser viewport in its properties; avoid enlarging an 800×600 source
with an OBS transform because that softens text. Use **Refresh cache of current
page** after changing saved settings or when troubleshooting.

The design studio is interactive in a normal browser. OBS's Browser Source is
intended as output; right-click it and choose **Interact** only for diagnostics.
