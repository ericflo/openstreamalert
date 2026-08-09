import path from "node:path";
import express, { type Request, type Response } from "express";
import { config, randomToken, twitchIsConfigured } from "./config.js";
import {
  clearCookie,
  cookies,
  requireAccount,
  requireSameOrigin,
  session,
  setCookie,
} from "./auth.js";
import {
  createSession,
  deleteAccount,
  deleteSession,
  getOverlayByKey,
  getOverlayForAccount,
  getTokens,
  rotateOverlayKey,
  saveAccount,
  saveSettings,
} from "./database.js";
import { chats } from "./twitch.js";
import { overlaySettingsSchema } from "../shared/settings.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_request, response, next) => {
  response.set({
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  if (config.production) {
    response.set(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; img-src 'self' https://static-cdn.jtvnw.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://id.twitch.tv; frame-ancestors 'self'",
    );
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(session);

app.get("/api/status", (request, response) => {
  const overlay = request.account
    ? getOverlayForAccount(request.account.id)
    : undefined;
  response.json({
    configured: twitchIsConfigured(),
    account: request.account ?? null,
    overlay: overlay
      ? {
          settings: overlay.settings,
          url: `${config.appUrl}/overlay/${overlay.key}`,
        }
      : null,
  });
});

app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.get("/api/auth/twitch", (_request, response) => {
  if (!twitchIsConfigured()) return response.redirect("/?error=not-configured");
  const state = randomToken(24);
  setCookie(response, "osa_oauth_state", state, 600);
  const params = new URLSearchParams({
    client_id: config.twitchClientId,
    redirect_uri: `${config.appUrl}/auth/callback`,
    response_type: "code",
    scope: "user:read:chat",
    state,
  });
  response.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get("/auth/callback", async (request, response, next) => {
  try {
    const code = String(request.query.code ?? "");
    const state = String(request.query.state ?? "");
    if (!code || !state || state !== cookies(request).osa_oauth_state)
      return response.redirect("/?error=oauth-state");
    clearCookie(response, "osa_oauth_state");
    const body = new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${config.appUrl}/auth/callback`,
    });
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body,
    });
    if (!tokenResponse.ok)
      throw new Error(`Twitch token exchange failed (${tokenResponse.status})`);
    const token = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const validationResponse = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      {
        headers: { Authorization: `OAuth ${token.access_token}` },
      },
    );
    if (!validationResponse.ok)
      throw new Error("Twitch returned an invalid access token");
    const user = (await validationResponse.json()) as {
      user_id: string;
      login: string;
      client_id: string;
    };
    if (user.client_id !== config.twitchClientId)
      throw new Error("Twitch client ID mismatch");
    const userResponse = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(user.user_id)}`,
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Client-Id": config.twitchClientId,
        },
      },
    );
    const userData = (await userResponse.json()) as {
      data?: Array<{ display_name: string }>;
    };
    saveAccount({
      id: user.user_id,
      login: user.login,
      displayName: userData.data?.[0]?.display_name ?? user.login,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    const sessionToken = createSession(
      user.user_id,
      Date.now() + config.sessionDays * 86_400_000,
    );
    setCookie(
      response,
      "osa_session",
      sessionToken,
      config.sessionDays * 86_400,
    );
    response.redirect("/?connected=1");
  } catch (error) {
    next(error);
  }
});

app.put(
  "/api/settings",
  requireAccount,
  requireSameOrigin,
  (request, response) => {
    const parsed = overlaySettingsSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        error: "Invalid overlay settings",
        issues: parsed.error.issues,
      });
    saveSettings(request.account!.id, parsed.data);
    response.json({ settings: parsed.data });
  },
);

app.post(
  "/api/overlay-key/rotate",
  requireAccount,
  requireSameOrigin,
  (request, response) => {
    const key = rotateOverlayKey(request.account!.id);
    response.json({ url: `${config.appUrl}/overlay/${key}` });
  },
);

app.post("/api/logout", requireSameOrigin, (request, response) => {
  deleteSession(cookies(request).osa_session);
  clearCookie(response, "osa_session");
  response.status(204).end();
});

app.delete(
  "/api/account",
  requireAccount,
  requireSameOrigin,
  async (request, response) => {
    const tokens = getTokens(request.account!.id);
    if (tokens) {
      await fetch("https://id.twitch.tv/oauth2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.twitchClientId,
          token: tokens.accessToken,
        }),
      }).catch(() => undefined);
    }
    chats.stop(request.account!.id);
    deleteAccount(request.account!.id);
    clearCookie(response, "osa_session");
    response.status(204).end();
  },
);

app.get("/api/overlay/:key", (request, response) => {
  const overlay = getOverlayByKey(request.params.key);
  if (!overlay)
    return response.status(404).json({ error: "Overlay not found" });
  response
    .set("Cache-Control", "no-store")
    .json({ channelName: overlay.channelName, settings: overlay.settings });
});

app.get("/api/overlay/:key/events", (request, response) => {
  const overlay = getOverlayByKey(request.params.key);
  if (!overlay) return response.status(404).end();
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write(": connected\n\n");
  const unsubscribe = chats.for(overlay.accountId).subscribe((event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(
    () => response.write(": heartbeat\n\n"),
    15_000,
  );
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

if (config.production) {
  const clientPath = path.resolve("dist/client");
  app.use(
    express.static(clientPath, { index: false, immutable: true, maxAge: "1y" }),
  );
  app.get("*splat", (_request, response) =>
    response.sendFile(path.join(clientPath, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.use(
  (error: unknown, request: Request, response: Response, _next: unknown) => {
    void _next;
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(`[${request.method} ${request.path}] ${message}`);
    response
      .status(500)
      .json({ error: config.production ? "Something went wrong" : message });
  },
);

app.listen(config.port, () => {
  console.log(`OpenStreamAlert is ready at ${config.appUrl}`);
  if (!twitchIsConfigured())
    console.log(
      "Demo mode is active. Add Twitch credentials to .env to connect chat.",
    );
});
