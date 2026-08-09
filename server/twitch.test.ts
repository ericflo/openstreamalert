import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import type { OverlayEvent } from "../shared/events";
import {
  createAccessTokenProvider,
  normalizeEvent,
  TwitchChat,
} from "./twitch";

const metadata = {
  message_id: "delivery-1",
  message_type: "notification",
  message_timestamp: "2026-08-08T12:00:00Z",
};

describe("Twitch event normalization", () => {
  it("preserves Twitch fragments as renderable data instead of HTML", () => {
    const result = normalizeEvent(
      {
        metadata: { ...metadata, subscription_type: "channel.chat.message" },
        payload: {
          event: {
            message_id: "message-1",
            chatter_user_id: "42",
            chatter_user_name: "<b>Ada</b>",
            color: "#9147ff",
            badges: [{ set_id: "moderator", id: "1" }],
            message_type: "text",
            message: {
              text: "hi Kappa",
              fragments: [
                { type: "text", text: "<script>" },
                { type: "emote", text: "Kappa", emote: { id: "25" } },
              ],
            },
          },
        },
      },
      new Map([
        [
          "moderator:1",
          {
            imageUrl: "https://static-cdn.jtvnw.net/badge.png",
            title: "Moderator",
          },
        ],
      ]),
    );

    expect(result).toMatchObject({
      kind: "message",
      userName: "<b>Ada</b>",
      badges: [{ title: "Moderator" }],
    });
    expect(result && result.kind === "message" && result.fragments).toEqual([
      { type: "text", text: "<script>" },
      { type: "emote", text: "Kappa", id: "25" },
    ]);
  });

  it("normalizes moderation deletion events", () => {
    expect(
      normalizeEvent({
        metadata: {
          ...metadata,
          subscription_type: "channel.chat.message_delete",
        },
        payload: { event: { message_id: "gone" } },
      }),
    ).toEqual({ kind: "delete", messageId: "gone" });
  });

  it.each(["sub", "resub"])(
    "preserves structured identity and message fragments for %s notices",
    (noticeType) => {
      const result = normalizeEvent(
        {
          metadata: {
            ...metadata,
            subscription_type: "channel.chat.notification",
          },
          payload: {
            event: {
              notice_type: noticeType,
              chatter_user_id: "42",
              chatter_user_name: "Ada",
              color: "#9147ff",
              badges: [{ set_id: "subscriber", id: "12" }],
              system_message: "Ada subscribed!",
              message: {
                text: "hello Kappa",
                fragments: [
                  { type: "text", text: "hello " },
                  { type: "emote", text: "Kappa", emote: { id: "25" } },
                ],
              },
            },
          },
        },
        new Map([
          [
            "subscriber:12",
            {
              imageUrl: "https://static-cdn.jtvnw.net/subscriber.png",
              title: "Subscriber",
            },
          ],
        ]),
      );

      expect(result).toMatchObject({
        kind: "notice",
        noticeType,
        userId: "42",
        userName: "Ada",
        userColor: "#9147ff",
        badges: [{ title: "Subscriber" }],
        text: "Ada subscribed! — hello Kappa",
        fragments: [
          { type: "text", text: "Ada subscribed!" },
          { type: "text", text: " — " },
          { type: "text", text: "hello " },
          { type: "emote", text: "Kappa", id: "25" },
        ],
      });
    },
  );
});

class MockSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  closeCalls = 0;
  terminateCalls = 0;

  message(value: unknown) {
    this.emit(
      "message",
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
    );
  }

  close() {
    this.closeCalls += 1;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  terminate() {
    this.terminateCalls += 1;
  }
}

function envelope(messageType: string, payload: Record<string, unknown> = {}) {
  return {
    metadata: {
      ...metadata,
      message_type: messageType,
    },
    payload,
  };
}

function harness(accessToken = vi.fn().mockResolvedValue("token")) {
  const sockets: MockSocket[] = [];
  const authorizationLost = vi.fn();
  const chat = new TwitchChat("42", {
    createSocket: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    accessToken,
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
    random: () => 0,
    authorizationLost,
  });
  return { authorizationLost, chat, sockets };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Twitch EventSub lifecycle", () => {
  it("contains malformed upstream JSON and reports an error", () => {
    const { chat, sockets } = harness();
    const events: OverlayEvent[] = [];
    chat.subscribe((event) => events.push(event));

    sockets[0].message("{not-json");

    expect(sockets[0].terminateCalls).toBe(1);
    expect(events).toContainEqual({
      kind: "state",
      state: "error",
      detail: expect.stringContaining("JSON"),
    });
    chat.stop();
  });

  it("keeps the old socket open until the replacement welcomes it", async () => {
    const { chat, sockets } = harness();
    const events: OverlayEvent[] = [];
    chat.subscribe((event) => events.push(event));
    const oldSocket = sockets[0];

    oldSocket.message(
      envelope("session_reconnect", {
        session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" },
      }),
    );
    const replacement = sockets[1];
    oldSocket.message({
      metadata: {
        ...metadata,
        message_id: "delivery-during-handoff",
        subscription_type: "channel.chat.message_delete",
      },
      payload: { event: { message_id: "still-delivered" } },
    });

    expect(oldSocket.closeCalls).toBe(0);
    expect(events).toContainEqual({
      kind: "delete",
      messageId: "still-delivered",
    });

    replacement.message(
      envelope("session_welcome", { session: { id: "replacement" } }),
    );
    await settle();

    expect(oldSocket.closeCalls).toBe(1);
    expect(events.at(-1)).toEqual({ kind: "state", state: "connected" });
    chat.stop();
  });

  it("replays retained connection state to late subscribers", async () => {
    const { chat, sockets } = harness();
    chat.subscribe(() => undefined);
    sockets[0].message(
      envelope("session_reconnect", {
        session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" },
      }),
    );
    sockets[1].message(
      envelope("session_welcome", { session: { id: "replacement" } }),
    );
    await settle();

    const lateEvents: OverlayEvent[] = [];
    chat.subscribe((event) => lateEvents.push(event));

    expect(lateEvents[0]).toEqual({ kind: "state", state: "connected" });
    chat.stop();
  });

  it("ends the local authorization session when Twitch revokes it", () => {
    const { authorizationLost, chat, sockets } = harness();
    const events: OverlayEvent[] = [];
    chat.subscribe((event) => events.push(event));

    sockets[0].message(
      envelope("revocation", {
        subscription: { status: "authorization_revoked" },
      }),
    );

    expect(authorizationLost).toHaveBeenCalledWith("42");
    expect(sockets[0].closeCalls).toBe(1);
    expect(events.at(-1)).toEqual({
      kind: "state",
      state: "error",
      detail: expect.stringContaining("authorization_revoked"),
    });
    chat.stop();
  });

  it("does not let stale subscription work overwrite a new generation", async () => {
    let resolveToken!: (token: string) => void;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const { chat, sockets } = harness(vi.fn(() => token));
    const events: OverlayEvent[] = [];
    chat.subscribe((event) => events.push(event));
    sockets[0].message(
      envelope("session_welcome", { session: { id: "initial" } }),
    );
    sockets[0].message(
      envelope("session_reconnect", {
        session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" },
      }),
    );
    sockets[1].message(
      envelope("session_welcome", { session: { id: "replacement" } }),
    );
    await settle();

    resolveToken("token");
    await settle();

    expect(
      events.filter(
        (event) => event.kind === "state" && event.state === "connected",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)).toEqual({ kind: "state", state: "connected" });
    chat.stop();
  });
});

describe("Twitch access tokens", () => {
  it("coalesces concurrent refreshes for the same account", async () => {
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetch = vi.fn(() => refresh);
    const updateTokens = vi.fn();
    const provider = createAccessTokenProvider({
      getTokens: vi.fn(() => ({
        accessToken: "expired-access",
        refreshToken: "refresh-token",
        expiresAt: 0,
        validatedAt: 0,
      })),
      markTokenValidated: vi.fn(),
      updateTokens,
      deleteSessionsForAccount: vi.fn(),
      fetch,
      now: () => 1_000_000,
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const first = provider("42");
    const second = provider("42");

    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveRefresh(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      "new-access",
      "new-access",
    ]);
    expect(updateTokens).toHaveBeenCalledTimes(1);
    expect(updateTokens).toHaveBeenCalledWith(
      "42",
      "new-access",
      "new-refresh",
      4_600_000,
    );
  });
});
