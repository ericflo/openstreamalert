import { describe, expect, it, vi } from "vitest";
import { DeviceAuthorizationManager } from "./device-auth";

const deviceResponse = {
  device_code: "secret-device-code",
  user_code: "ABCD-EFGH",
  verification_uri: "https://www.twitch.tv/activate",
  expires_in: 600,
  interval: 5,
};

describe("DeviceAuthorizationManager", () => {
  it("keeps the device code server-side and completes a public-client grant", async () => {
    let now = 1_000;
    const twitchFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(deviceResponse))
      .mockResolvedValueOnce(
        Response.json({ message: "authorization_pending" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 14_400,
        }),
      );
    const manager = new DeviceAuthorizationManager(
      "public-client",
      twitchFetch,
      () => now,
    );

    const { state } = await manager.start();
    expect(manager.snapshot(state)).toEqual({
      userCode: "ABCD-EFGH",
      verificationUri: "https://www.twitch.tv/activate",
      expiresAt: 601_000,
      intervalMs: 5_000,
    });
    expect(JSON.stringify(manager.snapshot(state))).not.toContain(
      "secret-device-code",
    );

    await expect(manager.poll(state)).resolves.toEqual({
      state: "pending",
      retryAfterMs: 5_000,
    });
    await expect(manager.poll(state)).resolves.toEqual({
      state: "pending",
      retryAfterMs: 5_000,
    });
    expect(twitchFetch).toHaveBeenCalledTimes(2);

    now += 5_000;
    await expect(manager.poll(state)).resolves.toEqual({
      state: "authorized",
      token: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 14_400,
      },
    });
    const tokenBody = String(twitchFetch.mock.calls[2][1]?.body);
    expect(tokenBody).toContain("client_id=public-client");
    expect(tokenBody).toContain("scopes=user%3Aread%3Achat");
    expect(tokenBody).not.toContain("client_secret");
    expect(manager.snapshot(state)).toBeUndefined();
  });

  it("honors slow-down responses and expires abandoned grants", async () => {
    let now = 0;
    const twitchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...deviceResponse, expires_in: 20, interval: 1 }),
      )
      .mockResolvedValueOnce(
        Response.json({ message: "slow_down" }, { status: 400 }),
      );
    const manager = new DeviceAuthorizationManager(
      "public-client",
      twitchFetch,
      () => now,
    );
    const { state } = await manager.start();
    await expect(manager.poll(state)).resolves.toEqual({
      state: "pending",
      retryAfterMs: 6_000,
    });
    now = 20_001;
    await expect(manager.poll(state)).resolves.toEqual({ state: "expired" });
  });

  it("rejects an unexpected activation origin", async () => {
    const manager = new DeviceAuthorizationManager(
      "public-client",
      vi.fn().mockResolvedValue(
        Response.json({
          ...deviceResponse,
          verification_uri: "https://example.com/activate",
        }),
      ),
    );
    await expect(manager.start()).rejects.toThrow(
      "unexpected verification address",
    );
  });

  it("keeps an authorization alive through a transient Twitch outage", async () => {
    let now = 0;
    const twitchFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...deviceResponse, interval: 1 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const manager = new DeviceAuthorizationManager(
      "public-client",
      twitchFetch,
      () => now,
    );
    const { state } = await manager.start();
    await expect(manager.poll(state)).resolves.toEqual({
      state: "pending",
      retryAfterMs: 1_000,
    });
    expect(manager.snapshot(state)).toBeDefined();
    now += 1_000;
    await expect(manager.poll(state)).resolves.toEqual({
      state: "pending",
      retryAfterMs: 1_000,
    });
    expect(manager.snapshot(state)).toBeDefined();
  });
});
