import WebSocket from "ws";
import type {
  OverlayEvent,
  ChatFragment,
  ChatMessage,
} from "../shared/events.js";
import { config } from "./config.js";
import { getTokens, markTokenValidated, updateTokens } from "./database.js";

const EVENTSUB_URL =
  "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const SUBSCRIPTIONS = [
  "channel.chat.message",
  "channel.chat.notification",
  "channel.chat.message_delete",
  "channel.chat.clear_user_messages",
  "channel.chat.clear",
] as const;

type Listener = (event: OverlayEvent) => void;

interface TwitchEnvelope {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
    subscription_type?: string;
  };
  payload: Record<string, any>;
}

async function validAccessToken(accountId: string): Promise<string> {
  const tokens = getTokens(accountId);
  if (!tokens) throw new Error("Twitch account no longer exists");
  if (tokens.expiresAt > Date.now() + 60_000) {
    if (tokens.validatedAt >= Date.now() - 60 * 60_000)
      return tokens.accessToken;
    const validation = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${tokens.accessToken}` },
    });
    if (validation.ok) {
      markTokenValidated(accountId);
      return tokens.accessToken;
    }
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body,
  });
  if (!response.ok)
    throw new Error(`Twitch authorization expired (${response.status})`);
  const refreshed = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  updateTokens(
    accountId,
    refreshed.access_token,
    refreshed.refresh_token,
    Date.now() + refreshed.expires_in * 1000,
  );
  return refreshed.access_token;
}

export class TwitchChat {
  private listeners = new Set<Listener>();
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private validationTimer?: NodeJS.Timeout;
  private attempt = 0;
  private stopped = true;
  private seen = new Set<string>();
  private badges = new Map<string, { imageUrl: string; title: string }>();

  constructor(private accountId: string) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stopped) {
      this.stopped = false;
      void this.connect(EVENTSUB_URL, false);
      this.validationTimer = setInterval(() => {
        void validAccessToken(this.accountId).catch(() => {
          this.emit({
            kind: "state",
            state: "error",
            detail: "Twitch authorization expired. Reconnect in the studio.",
          });
          this.socket?.close();
        });
      }, 60 * 60_000);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size)
        this.idleTimer = setTimeout(() => this.stop(), 30_000);
    };
  }

  private emit(event: OverlayEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private async connect(url: string, carryingSubscriptions: boolean) {
    if (this.stopped) return;
    this.emit({
      kind: "state",
      state: this.attempt ? "reconnecting" : "connecting",
    });
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;
    let watchdog = setTimeout(() => socket.terminate(), 15_000);

    socket.on("message", (raw) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => socket.terminate(), 45_000);
      void this.handle(
        JSON.parse(raw.toString()) as TwitchEnvelope,
        socket,
        previous,
        carryingSubscriptions,
      ).catch((error: unknown) => {
        this.emit({
          kind: "state",
          state: "error",
          detail:
            error instanceof Error ? error.message : "Twitch connection failed",
        });
        socket.close();
      });
    });
    socket.on("error", () => {
      /* close handles recovery; never expose credentials */
    });
    socket.on("close", () => {
      clearTimeout(watchdog);
      if (socket !== this.socket || this.stopped) return;
      this.emit({ kind: "state", state: "reconnecting" });
      const delay =
        Math.min(30_000, 1_000 * 2 ** this.attempt++) +
        Math.floor(Math.random() * 500);
      this.reconnectTimer = setTimeout(
        () => void this.connect(EVENTSUB_URL, false),
        delay,
      );
    });
  }

  private async handle(
    envelope: TwitchEnvelope,
    socket: WebSocket,
    previous: WebSocket | undefined,
    carrying: boolean,
  ) {
    const type = envelope.metadata.message_type;
    if (type === "session_welcome") {
      this.attempt = 0;
      previous?.close();
      if (!carrying)
        await this.createSubscriptions(envelope.payload.session.id as string);
      this.emit({ kind: "state", state: "connected" });
      return;
    }
    if (type === "session_reconnect") {
      await this.connect(
        envelope.payload.session.reconnect_url as string,
        true,
      );
      return;
    }
    if (type === "revocation") {
      this.emit({
        kind: "state",
        state: "error",
        detail: "Twitch revoked chat access. Reconnect in the studio.",
      });
      return;
    }
    if (type !== "notification" || this.seen.has(envelope.metadata.message_id))
      return;
    this.seen.add(envelope.metadata.message_id);
    if (this.seen.size > 1_000)
      this.seen.delete(this.seen.values().next().value!);
    const event = normalizeEvent(envelope, this.badges);
    if (event) this.emit(event);
    if (socket !== this.socket) socket.close();
  }

  private async createSubscriptions(sessionId: string) {
    const token = await validAccessToken(this.accountId);
    for (const type of SUBSCRIPTIONS) {
      const response = await fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Client-Id": config.twitchClientId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type,
            version: "1",
            condition: {
              broadcaster_user_id: this.accountId,
              user_id: this.accountId,
            },
            transport: { method: "websocket", session_id: sessionId },
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Unable to subscribe to ${type} (${response.status})`);
    }
    await this.loadBadges(token);
  }

  private async loadBadges(token: string) {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Client-Id": config.twitchClientId,
    };
    const urls = [
      "https://api.twitch.tv/helix/chat/badges/global",
      `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(this.accountId)}`,
    ];
    const responses = await Promise.all(
      urls.map((url) => fetch(url, { headers })),
    );
    for (const response of responses) {
      if (!response.ok) continue;
      const body = (await response.json()) as {
        data: Array<{
          set_id: string;
          versions: Array<{ id: string; image_url_2x: string; title: string }>;
        }>;
      };
      for (const set of body.data)
        for (const version of set.versions) {
          this.badges.set(`${set.set_id}:${version.id}`, {
            imageUrl: version.image_url_2x,
            title: version.title,
          });
        }
    }
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.socket?.close();
    this.socket = undefined;
    this.emit({ kind: "state", state: "connecting" });
  }
}

export function normalizeEvent(
  envelope: TwitchEnvelope,
  badgeMap = new Map<string, { imageUrl: string; title: string }>(),
): OverlayEvent | undefined {
  const event = envelope.payload.event as Record<string, any>;
  const sentAt = envelope.metadata.message_timestamp;
  switch (envelope.metadata.subscription_type) {
    case "channel.chat.message": {
      const fragments: ChatFragment[] = (event.message.fragments ?? []).map(
        (fragment: any) => {
          if (fragment.type === "emote" && fragment.emote?.id)
            return {
              type: "emote",
              text: fragment.text,
              id: fragment.emote.id,
            };
          if (fragment.type === "cheermote")
            return {
              type: "cheermote",
              text: fragment.text,
              bits: Number(fragment.cheermote?.bits ?? 0),
            };
          return {
            type: fragment.type === "mention" ? "mention" : "text",
            text: fragment.text,
          };
        },
      );
      return {
        kind: "message",
        id: event.message_id,
        userId: event.chatter_user_id,
        userName: event.chatter_user_name,
        userColor: event.color || "#a78bfa",
        badges: (event.badges ?? []).map((badge: any) => ({
          setId: badge.set_id,
          id: badge.id,
          ...badgeMap.get(`${badge.set_id}:${badge.id}`),
        })),
        fragments,
        text: event.message.text,
        sentAt,
        reply: event.reply
          ? {
              userName: event.reply.parent_user_name,
              text: event.reply.parent_message_body,
            }
          : undefined,
        action: event.message_type === "action",
      } satisfies ChatMessage;
    }
    case "channel.chat.notification":
      return {
        kind: "notice",
        id: envelope.metadata.message_id,
        text: event.system_message,
        sentAt,
      };
    case "channel.chat.message_delete":
      return { kind: "delete", messageId: event.message_id };
    case "channel.chat.clear_user_messages":
      return { kind: "clear-user", userId: event.target_user_id };
    case "channel.chat.clear":
      return { kind: "clear" };
  }
}

export class ChatManager {
  private chats = new Map<string, TwitchChat>();
  for(accountId: string) {
    let chat = this.chats.get(accountId);
    if (!chat) {
      chat = new TwitchChat(accountId);
      this.chats.set(accountId, chat);
    }
    return chat;
  }
  stop(accountId: string) {
    this.chats.get(accountId)?.stop();
    this.chats.delete(accountId);
  }
}

export const chats = new ChatManager();
