import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { config } from "./config";
import { deleteAccount } from "./database";

describe("HTTP application", () => {
  it("reports liveness, database readiness, and demo status", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).get("/livez").expect(200, { ok: true });
    const ready = await request(app).get("/readyz").expect(200);
    expect(ready.body).toMatchObject({ ok: true, database: true });
    const status = await request(app).get("/api/status").expect(200);
    expect(status.body).toMatchObject({ account: null, overlay: null });
    expect(status.headers["cache-control"]).toBe("no-store");
  });

  it("does not disclose whether a random overlay key exists through errors", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).get("/api/overlay/not-a-real-secret").expect(404, {
      error: "Overlay not found",
    });
  });

  it("requires authentication and rejects cross-origin mutations", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).put("/api/settings").send({}).expect(401, {
      error: "Authentication required",
    });
    await request(app)
      .post("/api/logout")
      .set("Origin", "https://malicious.example")
      .expect(403, { error: "Invalid origin" });
  });

  it("returns bounded JSON errors instead of accepting oversized input", async () => {
    const app = await createApp({ serveClient: false });
    const response = await request(app)
      .put("/api/settings")
      .set("Content-Type", "application/json")
      .send({ value: "x".repeat(40_000) })
      .expect(413);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("binds the minimum-scope Twitch authorization request to its state cookie", async () => {
    const previous = {
      clientId: config.twitchClientId,
      clientSecret: config.twitchClientSecret,
      encryptionKey: config.encryptionKey,
    };
    config.twitchClientId = "client-id";
    config.twitchClientSecret = "client-secret";
    config.encryptionKey = Buffer.alloc(32).toString("base64");
    try {
      const app = await createApp({ serveClient: false });
      const response = await request(app).get("/api/auth/twitch").expect(302);
      const authorization = new URL(response.headers.location);
      const state = authorization.searchParams.get("state");

      expect(authorization.origin).toBe("https://id.twitch.tv");
      expect(authorization.pathname).toBe("/oauth2/authorize");
      expect(authorization.searchParams.get("response_type")).toBe("code");
      expect(authorization.searchParams.get("scope")).toBe("user:read:chat");
      expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(response.headers["set-cookie"]?.[0]).toContain(
        `osa_oauth_state=${state}`,
      );
      expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
      expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
    } finally {
      config.twitchClientId = previous.clientId;
      config.twitchClientSecret = previous.clientSecret;
      config.encryptionKey = previous.encryptionKey;
    }
  });

  it("requires matching state even when Twitch reports a denied grant", async () => {
    const app = await createApp({ serveClient: false });
    await request(app)
      .get("/auth/callback?error=access_denied")
      .expect(302)
      .expect("Location", "/?error=oauth-state");

    const denied = await request(app)
      .get("/auth/callback?error=access_denied&state=expected")
      .set("Cookie", "osa_oauth_state=expected")
      .expect(302)
      .expect("Location", "/?error=oauth-denied");
    expect(denied.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
  });

  it("does not contact Twitch when callback state does not match", async () => {
    const twitchFetch = vi.fn();
    const app = await createApp({ serveClient: false, twitchFetch });

    await request(app)
      .get("/auth/callback?code=code&state=attacker")
      .set("Cookie", "osa_oauth_state=expected")
      .expect(302)
      .expect("Location", "/?error=oauth-state");
    expect(twitchFetch).not.toHaveBeenCalled();
  });

  it("exchanges and validates a state-bound code before rejecting a client mismatch", async () => {
    const twitchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user_id: "42",
          login: "ada",
          client_id: "not-this-application",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const app = await createApp({ serveClient: false, twitchFetch });

    const callback = await request(app)
      .get("/auth/callback?code=code&state=expected")
      .set("Cookie", "osa_oauth_state=expected")
      .expect(302)
      .expect("Location", "/?error=oauth-failed");

    expect(callback.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
    expect(twitchFetch).toHaveBeenCalledTimes(3);
    expect(String(twitchFetch.mock.calls[0][0])).toBe(
      "https://id.twitch.tv/oauth2/token",
    );
    expect(twitchFetch.mock.calls[1][1]?.headers).toEqual({
      Authorization: "OAuth access",
    });
    expect(String(twitchFetch.mock.calls[2][0])).toBe(
      "https://id.twitch.tv/oauth2/revoke",
    );
    expect(
      (twitchFetch.mock.calls[2][1]?.body as URLSearchParams).get("token"),
    ).toBe("access");
  });

  it("fails a timed-out token exchange without retaining OAuth state", async () => {
    const twitchFetch = vi
      .fn()
      .mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    const app = await createApp({ serveClient: false, twitchFetch });

    const callback = await request(app)
      .get("/auth/callback?code=code&state=expected")
      .set("Cookie", "osa_oauth_state=expected")
      .expect(302)
      .expect("Location", "/?error=oauth-failed");

    expect(callback.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
    expect(twitchFetch).toHaveBeenCalledTimes(1);
  });

  it("completes desktop device authorization without a client secret", async () => {
    const previous = {
      runtimeMode: config.runtimeMode,
      clientId: config.twitchClientId,
      clientSecret: config.twitchClientSecret,
      encryptionKey: config.encryptionKey,
    };
    config.runtimeMode = "desktop";
    config.twitchClientId = "desktop-client";
    config.twitchClientSecret = "";
    config.encryptionKey = Buffer.alloc(32, 1).toString("base64");
    const twitchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "private-code",
          user_code: "JOIN-NOW",
          verification_uri: "https://www.twitch.tv/activate",
          expires_in: 600,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "desktop-access",
          refresh_token: "desktop-refresh",
          expires_in: 14_400,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user_id: "desktop-user",
          login: "desktop_user",
          client_id: "desktop-client",
          scopes: ["user:read:chat"],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ display_name: "Desktop User" }] }),
      );
    try {
      const app = await createApp({ serveClient: false, twitchFetch });
      const desktopHost = new URL(config.appUrl).host;
      await request(app)
        .get("/readyz")
        .set("Host", "attacker.example")
        .expect(421, { error: "Unexpected desktop host" });
      const start = await request(app)
        .get("/api/auth/twitch")
        .set("Host", desktopHost)
        .expect(302)
        .expect("Location", "/auth/device");
      const cookie = start.headers["set-cookie"]?.[0].split(";")[0];
      expect(cookie).toContain("osa_oauth_state=");
      expect(start.headers["set-cookie"]?.[0]).toContain("Max-Age=600");

      const activation = await request(app)
        .get("/api/auth/device")
        .set("Host", desktopHost)
        .set("Cookie", cookie)
        .expect(200);
      expect(activation.body).toMatchObject({
        userCode: "JOIN-NOW",
        verificationUri: "https://www.twitch.tv/activate",
      });
      expect(JSON.stringify(activation.body)).not.toContain("private-code");

      const connected = await request(app)
        .post("/api/auth/device/poll")
        .set("Host", desktopHost)
        .set("Origin", config.appUrl)
        .set("Cookie", cookie)
        .expect(200, { state: "authorized" });
      expect(connected.headers["set-cookie"].join(";")).toContain(
        "osa_session=",
      );
      expect(String(twitchFetch.mock.calls[1][1]?.body)).not.toContain(
        "client_secret",
      );
    } finally {
      deleteAccount("desktop-user");
      config.runtimeMode = previous.runtimeMode;
      config.twitchClientId = previous.clientId;
      config.twitchClientSecret = previous.clientSecret;
      config.encryptionKey = previous.encryptionKey;
    }
  });
});
