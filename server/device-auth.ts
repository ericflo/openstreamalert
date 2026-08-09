import { randomToken } from "./config.js";
import { fetchWithTimeout } from "./http.js";

interface DeviceGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  polling?: Promise<DevicePollResult>;
}

export type DevicePollResult =
  | { state: "pending"; retryAfterMs: number }
  | { state: "denied" | "expired" }
  | {
      state: "authorized";
      token: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
    };

export interface DeviceAuthorizationSnapshot {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export class DeviceAuthorizationManager {
  private readonly grants = new Map<string, DeviceGrant>();

  constructor(
    private readonly clientId: string,
    private readonly twitchFetch: typeof fetchWithTimeout = fetchWithTimeout,
    private readonly now: () => number = Date.now,
  ) {}

  async start() {
    this.prune();
    if (this.grants.size >= 5)
      throw new Error("Too many device authorization attempts");
    const response = await this.twitchFetch(
      "https://id.twitch.tv/oauth2/device",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          scopes: "user:read:chat",
        }),
      },
    );
    if (!response.ok)
      throw new Error(`device authorization failed (${response.status})`);
    const value = (await response.json()) as Partial<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    }>;
    if (
      !value.device_code ||
      !value.user_code ||
      !value.verification_uri ||
      !Number.isFinite(value.expires_in) ||
      !Number.isFinite(value.interval)
    )
      throw new Error("Twitch returned an incomplete device authorization");
    const verification = new URL(value.verification_uri);
    if (
      verification.protocol !== "https:" ||
      verification.hostname !== "www.twitch.tv"
    )
      throw new Error("Twitch returned an unexpected verification address");
    const state = randomToken(24);
    const intervalMs = Math.max(1_000, Number(value.interval) * 1_000);
    this.grants.set(state, {
      deviceCode: value.device_code,
      userCode: value.user_code,
      verificationUri: verification.toString(),
      expiresAt: this.now() + Number(value.expires_in) * 1_000,
      intervalMs,
      nextPollAt: this.now(),
    });
    return { state, expiresInSeconds: Number(value.expires_in) };
  }

  snapshot(state: string): DeviceAuthorizationSnapshot | undefined {
    const grant = this.grants.get(state);
    if (!grant || grant.expiresAt <= this.now()) {
      this.grants.delete(state);
      return undefined;
    }
    return {
      userCode: grant.userCode,
      verificationUri: grant.verificationUri,
      expiresAt: grant.expiresAt,
      intervalMs: grant.intervalMs,
    };
  }

  async poll(state: string): Promise<DevicePollResult> {
    const grant = this.grants.get(state);
    if (!grant || grant.expiresAt <= this.now()) {
      this.grants.delete(state);
      return { state: "expired" };
    }
    if (grant.polling) return grant.polling;
    if (grant.nextPollAt > this.now())
      return { state: "pending", retryAfterMs: grant.nextPollAt - this.now() };
    grant.polling = this.exchange(state, grant).finally(() => {
      if (this.grants.get(state) === grant) grant.polling = undefined;
    });
    return grant.polling;
  }

  cancel(state: string) {
    this.grants.delete(state);
  }

  private async exchange(
    state: string,
    grant: DeviceGrant,
  ): Promise<DevicePollResult> {
    let response: Response;
    try {
      response = await this.twitchFetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          device_code: grant.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          scopes: "user:read:chat",
        }),
      });
    } catch {
      grant.nextPollAt = this.now() + grant.intervalMs;
      return { state: "pending", retryAfterMs: grant.intervalMs };
    }
    const value = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.ok) {
      if (
        typeof value.access_token !== "string" ||
        typeof value.refresh_token !== "string" ||
        typeof value.expires_in !== "number"
      )
        throw new Error("Twitch returned an incomplete device token");
      this.grants.delete(state);
      return {
        state: "authorized",
        token: {
          access_token: value.access_token,
          refresh_token: value.refresh_token,
          expires_in: value.expires_in,
        },
      };
    }
    if (response.status === 429 || response.status >= 500) {
      grant.nextPollAt = this.now() + grant.intervalMs;
      return { state: "pending", retryAfterMs: grant.intervalMs };
    }
    const error =
      typeof value.message === "string" ? value.message : value.error;
    if (error === "authorization_pending") {
      grant.nextPollAt = this.now() + grant.intervalMs;
      return { state: "pending", retryAfterMs: grant.intervalMs };
    }
    if (error === "slow_down") {
      grant.intervalMs += 5_000;
      grant.nextPollAt = this.now() + grant.intervalMs;
      return { state: "pending", retryAfterMs: grant.intervalMs };
    }
    if (error === "access_denied") {
      this.grants.delete(state);
      return { state: "denied" };
    }
    if (error === "expired_token") {
      this.grants.delete(state);
      return { state: "expired" };
    }
    throw new Error(`device token exchange failed (${response.status})`);
  }

  private prune() {
    for (const [state, grant] of this.grants)
      if (grant.expiresAt <= this.now()) this.grants.delete(state);
  }
}
