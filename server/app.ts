import path from "node:path";
import express, { type Request, type Response } from "express";
import { overlaySettingsSchema } from "../shared/settings.js";
import {
  clearCookie,
  cookies,
  requireAccount,
  requireSameOrigin,
  session,
  setCookie,
} from "./auth.js";
import {
  config,
  randomToken,
  twitchAuthMode,
  twitchIsConfigured,
} from "./config.js";
import {
  accountCanConnect,
  createSession,
  databaseReady,
  deleteAccount,
  deleteSession,
  getOverlayByKey,
  getOverlayForAccount,
  getTokens,
  rotateOverlayKey,
  saveAccount,
  saveSettings,
  setOverlayEnabled,
} from "./database.js";
import { fetchWithTimeout } from "./http.js";
import { DeviceAuthorizationManager } from "./device-auth.js";
import { overlayStreams } from "./overlay-streams.js";
import { chats } from "./twitch.js";

export interface AppOptions {
  serveClient?: boolean;
  twitchFetch?: typeof fetchWithTimeout;
}

export async function createApp(options: AppOptions = {}) {
  const twitchFetch = options.twitchFetch ?? fetchWithTimeout;
  const deviceAuthorizations = new DeviceAuthorizationManager(
    config.twitchClientId,
    twitchFetch,
  );
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    if (
      config.runtimeMode === "desktop" &&
      request.get("host") !== new URL(config.appUrl).host
    )
      return response.status(421).json({ error: "Unexpected desktop host" });
    response.set({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (request.path.startsWith("/api/"))
      response.set("Cache-Control", "no-store");
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

  app.get("/livez", (_request, response) => response.json({ ok: true }));
  app.get("/readyz", (_request, response) => {
    const database = databaseReady();
    response.status(database ? 200 : 503).json({
      ok: database,
      database,
      mode: twitchIsConfigured() ? "twitch" : "demo",
      version: config.buildVersion,
    });
  });
  app.get("/api/health", (_request, response) => {
    const database = databaseReady();
    response.status(database ? 200 : 503).json({ ok: database });
  });

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
            enabled: overlay.enabled,
          }
        : null,
      connection: request.account ? chats.snapshot(request.account.id) : null,
      version: config.buildVersion,
      runtimeMode: config.runtimeMode,
    });
  });

  app.get("/api/diagnostics", requireAccount, (request, response) => {
    const overlay = getOverlayForAccount(request.account!.id);
    response.json({
      version: config.buildVersion,
      mode: twitchIsConfigured() ? "twitch" : "demo",
      connection: chats.snapshot(request.account!.id),
      overlayViewers: overlay ? overlayStreams.count(overlay.key) : 0,
      database: databaseReady() ? "ready" : "error",
    });
  });

  async function finishAuthorization(
    token: { access_token: string; refresh_token: string; expires_in: number },
    response: Response,
  ) {
    const validationResponse = await twitchFetch(
      "https://id.twitch.tv/oauth2/validate",
      { headers: { Authorization: `OAuth ${token.access_token}` } },
    );
    if (!validationResponse.ok) throw new Error("token validation failed");
    const user = (await validationResponse.json()) as {
      user_id: string;
      login: string;
      client_id: string;
      scopes?: string[];
    };
    if (user.client_id !== config.twitchClientId)
      throw new Error("client ID mismatch");
    if (!user.scopes?.includes("user:read:chat"))
      throw new Error("required Twitch scope missing");
    if (!accountCanConnect(user.user_id, user.login))
      throw new AuthorizationRejectedError();
    const userResponse = await twitchFetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(user.user_id)}`,
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Client-Id": config.twitchClientId,
        },
      },
    );
    if (!userResponse.ok)
      throw new Error(`user lookup failed (${userResponse.status})`);
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
    chats.stop(user.user_id);
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
  }

  app.get("/api/auth/twitch", async (_request, response) => {
    if (!twitchIsConfigured())
      return response.redirect("/?error=not-configured");
    if (twitchAuthMode() === "device") {
      try {
        const authorization = await deviceAuthorizations.start();
        setCookie(
          response,
          "osa_oauth_state",
          authorization.state,
          authorization.expiresInSeconds,
        );
        return response.redirect("/auth/device");
      } catch (error) {
        logAuthorizationError("oauth.device_start_failed", error);
        return response.redirect("/?error=oauth-failed");
      }
    }
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

  app.get("/auth/callback", async (request, response) => {
    let issuedAccessToken: string | undefined;
    try {
      const state = String(request.query.state ?? "");
      if (!state || state !== cookies(request).osa_oauth_state)
        return response.redirect("/?error=oauth-state");
      if (request.query.error === "access_denied") {
        clearCookie(response, "osa_oauth_state");
        return response.redirect("/?error=oauth-denied");
      }
      const code = String(request.query.code ?? "");
      if (!code) return response.redirect("/?error=oauth-state");
      clearCookie(response, "osa_oauth_state");
      const tokenResponse = await twitchFetch(
        "https://id.twitch.tv/oauth2/token",
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: config.twitchClientId,
            client_secret: config.twitchClientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: `${config.appUrl}/auth/callback`,
          }),
        },
      );
      if (!tokenResponse.ok)
        throw new Error(`token exchange failed (${tokenResponse.status})`);
      const token = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      issuedAccessToken = token.access_token;
      await finishAuthorization(token, response);
      issuedAccessToken = undefined;
      response.redirect("/?connected=1");
    } catch (error) {
      if (issuedAccessToken) await revokeToken(issuedAccessToken, twitchFetch);
      if (error instanceof AuthorizationRejectedError)
        return response.redirect("/?error=not-allowed");
      logAuthorizationError("oauth.callback_failed", error);
      response.redirect("/?error=oauth-failed");
    }
  });

  app.get("/api/auth/device", (request, response) => {
    if (twitchAuthMode() !== "device")
      return response
        .status(404)
        .json({ error: "Device authorization unavailable" });
    const state = cookies(request).osa_oauth_state ?? "";
    const authorization = deviceAuthorizations.snapshot(state);
    if (!authorization)
      return response
        .status(410)
        .json({ error: "Device authorization expired" });
    response.json(authorization);
  });

  app.post(
    "/api/auth/device/poll",
    requireSameOrigin,
    async (request, response) => {
      if (twitchAuthMode() !== "device")
        return response
          .status(404)
          .json({ error: "Device authorization unavailable" });
      const state = cookies(request).osa_oauth_state ?? "";
      try {
        const result = await deviceAuthorizations.poll(state);
        if (result.state === "pending") return response.json(result);
        if (result.state !== "authorized") {
          clearCookie(response, "osa_oauth_state");
          return response.status(410).json(result);
        }
        try {
          await finishAuthorization(result.token, response);
        } catch (error) {
          await revokeToken(result.token.access_token, twitchFetch);
          throw error;
        }
        clearCookie(response, "osa_oauth_state");
        response.json({ state: "authorized" });
      } catch (error) {
        deviceAuthorizations.cancel(state);
        clearCookie(response, "osa_oauth_state");
        if (error instanceof AuthorizationRejectedError)
          return response.status(403).json({ state: "denied" });
        logAuthorizationError("oauth.device_poll_failed", error);
        response.status(502).json({ state: "error" });
      }
    },
  );

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
      const overlay = getOverlayForAccount(request.account!.id);
      saveSettings(request.account!.id, parsed.data);
      if (overlay)
        overlayStreams.publish(overlay.key, {
          kind: "settings",
          settings: parsed.data,
        });
      response.json({ settings: parsed.data });
    },
  );

  app.post(
    "/api/overlay-key/rotate",
    requireAccount,
    requireSameOrigin,
    (request, response) => {
      const { next, previous } = rotateOverlayKey(request.account!.id);
      overlayStreams.revoke(previous);
      response.json({ url: `${config.appUrl}/overlay/${next}` });
    },
  );

  app.put(
    "/api/overlay/enabled",
    requireAccount,
    requireSameOrigin,
    (request, response) => {
      if (typeof request.body?.enabled !== "boolean")
        return response.status(400).json({ error: "enabled must be boolean" });
      const current = getOverlayForAccount(request.account!.id);
      const overlay = setOverlayEnabled(
        request.account!.id,
        request.body.enabled,
      );
      if (current) {
        const connection = chats.snapshot(request.account!.id);
        overlayStreams.setEnabled(
          current.key,
          request.body.enabled,
          request.body.enabled
            ? {
                kind: "state",
                state:
                  connection.state === "idle" ? "connecting" : connection.state,
                detail: connection.detail,
              }
            : undefined,
        );
      }
      response.json({ enabled: overlay?.enabled ?? false });
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
      const accountId = request.account!.id;
      const overlay = getOverlayForAccount(accountId);
      const tokens = getTokens(accountId);
      try {
        if (tokens) await revokeToken(tokens.accessToken, twitchFetch);
      } finally {
        if (overlay) overlayStreams.revoke(overlay.key);
        chats.stop(accountId);
        deleteAccount(accountId);
        clearCookie(response, "osa_session");
        response.status(204).end();
      }
    },
  );

  app.get("/api/studio/events", requireAccount, (request, response) => {
    const stream = overlayStreams.attach(
      `studio:${request.account!.id}`,
      response,
    );
    if (!stream)
      return response.status(429).json({ error: "Too many studio viewers" });
    prepareSse(response);
    const unsubscribe = chats
      .for(request.account!.id)
      .subscribe((event) => stream.send(event));
    const heartbeat = setInterval(() => stream.comment("heartbeat"), 15_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      stream.detach();
    });
  });

  app.get("/api/overlay/:key", (request, response) => {
    const overlay = getOverlayByKey(request.params.key);
    if (!overlay)
      return response.status(404).json({ error: "Overlay not found" });
    response.json({
      channelName: overlay.channelName,
      settings: overlay.settings,
      enabled: overlay.enabled,
    });
  });

  app.get("/api/overlay/:key/events", (request, response) => {
    const overlay = getOverlayByKey(request.params.key);
    if (!overlay) return response.status(404).end();
    overlayStreams.configure(request.params.key, overlay.enabled);
    const stream = overlayStreams.attach(request.params.key, response);
    if (!stream)
      return response.status(429).json({ error: "Too many overlay viewers" });
    prepareSse(response);
    stream.comment("connected");
    stream.send({ kind: "settings", settings: overlay.settings });
    if (!overlay.enabled) {
      stream.send({ kind: "clear" });
      stream.send({ kind: "state", state: "paused" });
    }
    const unsubscribe = chats
      .for(overlay.accountId)
      .subscribe((event) => stream.send(event));
    const heartbeat = setInterval(() => stream.comment("heartbeat"), 15_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      stream.detach();
    });
  });

  if (options.serveClient !== false) {
    if (config.production) {
      const clientPath = config.clientPath;
      app.use(
        express.static(clientPath, {
          index: false,
          immutable: true,
          maxAge: "1y",
        }),
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
  }

  app.use(
    (error: unknown, request: Request, response: Response, _next: unknown) => {
      void _next;
      const message = safeError(error);
      const safePath = request.path.replace(
        /\/api\/overlay\/[^/]+/g,
        "/api/overlay/[redacted]",
      );
      console.error(
        JSON.stringify({
          level: "error",
          event: "request.failed",
          method: request.method,
          path: safePath,
          message,
        }),
      );
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 500;
      response.status(status).json({
        error: config.production ? "Something went wrong" : message,
      });
    },
  );

  return app;
}

function prepareSse(response: Response) {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
}

async function revokeToken(token: string, twitchFetch = fetchWithTimeout) {
  await twitchFetch(
    "https://id.twitch.tv/oauth2/revoke",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.twitchClientId,
        token,
      }),
    },
    3_000,
  ).catch(() => undefined);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

class AuthorizationRejectedError extends Error {}

function logAuthorizationError(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      message: safeError(error),
    }),
  );
}
