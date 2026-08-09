import WebSocket from "ws";
import type {
  ChatFragment,
  ChatMessage,
  OverlayEvent,
} from "../shared/events.js";
import { config } from "./config.js";
import {
  deleteSessionsForAccount,
  getTokens,
  markTokenValidated,
  updateTokens,
} from "./database.js";
import { fetchWithTimeout } from "./http.js";

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
type ConnectionState = Extract<OverlayEvent, { kind: "state" }>;

interface TwitchEnvelope {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
    subscription_type?: string;
  };
  payload: Record<string, any>;
}

class AuthorizationExpiredError extends Error {}

export interface AccessTokenDependencies {
  getTokens: typeof getTokens;
  markTokenValidated: typeof markTokenValidated;
  updateTokens: typeof updateTokens;
  deleteSessionsForAccount: typeof deleteSessionsForAccount;
  fetch: typeof fetchWithTimeout;
  now(): number;
  clientId: string;
  clientSecret: string;
}

export function createAccessTokenProvider(
  dependencies: AccessTokenDependencies,
) {
  const tasks = new Map<string, Promise<string>>();

  return function accessToken(accountId: string, forceValidation = false) {
    const active = tasks.get(accountId);
    if (active) return active;
    const task = ensureValidAccessToken(
      accountId,
      forceValidation,
      dependencies,
    ).finally(() => {
      if (tasks.get(accountId) === task) tasks.delete(accountId);
    });
    tasks.set(accountId, task);
    return task;
  };
}

async function ensureValidAccessToken(
  accountId: string,
  forceValidation: boolean,
  dependencies: AccessTokenDependencies,
): Promise<string> {
  const tokens = dependencies.getTokens(accountId);
  if (!tokens) throw new Error("Twitch account no longer exists");

  const now = dependencies.now();
  const shouldValidate =
    forceValidation || tokens.validatedAt < now - 55 * 60_000;
  if (tokens.expiresAt > now + 60_000 && shouldValidate) {
    const validation = await dependencies.fetch(
      "https://id.twitch.tv/oauth2/validate",
      { headers: { Authorization: `OAuth ${tokens.accessToken}` } },
    );
    if (validation.ok) {
      dependencies.markTokenValidated(accountId);
      return tokens.accessToken;
    }
    if (validation.status !== 401)
      throw new Error(`Twitch token validation failed (${validation.status})`);
  } else if (tokens.expiresAt > now + 60_000) {
    return tokens.accessToken;
  }

  const response = await dependencies.fetch(
    "https://id.twitch.tv/oauth2/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: dependencies.clientId,
        client_secret: dependencies.clientSecret,
      }),
    },
  );
  if (!response.ok) {
    if (response.status === 400 || response.status === 401)
      dependencies.deleteSessionsForAccount(accountId);
    throw new AuthorizationExpiredError(
      `Twitch authorization expired (${response.status})`,
    );
  }
  const refreshed = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!refreshed.access_token || !refreshed.refresh_token)
    throw new Error("Twitch returned an incomplete token response");
  dependencies.updateTokens(
    accountId,
    refreshed.access_token,
    refreshed.refresh_token,
    dependencies.now() + refreshed.expires_in * 1000,
  );
  return refreshed.access_token;
}

export const validAccessToken = createAccessTokenProvider({
  getTokens,
  markTokenValidated,
  updateTokens,
  deleteSessionsForAccount,
  fetch: fetchWithTimeout,
  now: Date.now,
  clientId: config.twitchClientId,
  clientSecret: config.twitchClientSecret,
});

function parseEnvelope(raw: WebSocket.RawData): TwitchEnvelope {
  const value = JSON.parse(raw.toString()) as unknown;
  if (!value || typeof value !== "object")
    throw new Error("Invalid Twitch EventSub frame");
  const candidate = value as Partial<TwitchEnvelope>;
  if (
    !candidate.metadata ||
    typeof candidate.metadata.message_id !== "string" ||
    typeof candidate.metadata.message_type !== "string" ||
    typeof candidate.metadata.message_timestamp !== "string" ||
    !candidate.payload ||
    typeof candidate.payload !== "object"
  )
    throw new Error("Invalid Twitch EventSub envelope");
  return candidate as TwitchEnvelope;
}

export interface TwitchChatDependencies {
  createSocket(url: string): WebSocket;
  accessToken(accountId: string, forceValidation: boolean): Promise<string>;
  fetch(
    input: string | URL,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<Response>;
  random(): number;
  authorizationLost(accountId: string): void;
}

const defaultTwitchChatDependencies: TwitchChatDependencies = {
  createSocket: (url) => new WebSocket(url),
  accessToken: validAccessToken,
  fetch: fetchWithTimeout,
  random: Math.random,
  authorizationLost: deleteSessionsForAccount,
};

export class TwitchChat {
  private listeners = new Set<Listener>();
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private validationTimer?: NodeJS.Timeout;
  private attempt = 0;
  private stopped = true;
  private seen = new Map<string, number>();
  private badges = new Map<string, { imageUrl: string; title: string }>();
  private state: ConnectionState = { kind: "state", state: "connecting" };
  private lastEventAt?: string;
  private minimumReconnectDelay = 0;
  private terminalAuthorization = false;
  private readonly dependencies: TwitchChatDependencies;

  constructor(
    private accountId: string,
    dependencies: Partial<TwitchChatDependencies> = {},
  ) {
    this.dependencies = { ...defaultTwitchChatDependencies, ...dependencies };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stopped && !this.terminalAuthorization) {
      this.stopped = false;
      void this.connect(EVENTSUB_URL, false);
      this.validationTimer = setInterval(() => {
        void this.dependencies
          .accessToken(this.accountId, true)
          .catch((error: unknown) => {
            if (error instanceof AuthorizationExpiredError && this.socket) {
              this.endAuthorization(this.socket, safeError(error));
              return;
            }
            this.setState("error", safeError(error));
            this.socket?.close();
          });
      }, 55 * 60_000);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size)
        this.idleTimer = setTimeout(() => this.stop(), 30_000);
    };
  }

  snapshot() {
    return {
      state: this.state.state,
      detail: this.state.detail,
      viewers: this.listeners.size,
      lastEventAt: this.lastEventAt ?? null,
    };
  }

  private emit(event: OverlayEvent) {
    if (event.kind !== "state") this.lastEventAt = new Date().toISOString();
    for (const listener of this.listeners) listener(event);
  }

  private setState(state: ConnectionState["state"], detail?: string) {
    this.state = { kind: "state", state, ...(detail ? { detail } : {}) };
    this.emit(this.state);
  }

  private async connect(url: string, carryingSubscriptions: boolean) {
    if (this.stopped) return;
    this.setState(this.attempt ? "reconnecting" : "connecting");
    const socket = this.dependencies.createSocket(url);
    const previous = this.socket;
    const abort = new AbortController();
    this.socket = socket;
    let watchdog = setTimeout(() => socket.terminate(), 15_000);

    socket.on("message", (raw) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => socket.terminate(), 45_000);
      let envelope: TwitchEnvelope;
      try {
        envelope = parseEnvelope(raw);
      } catch (error) {
        this.setState("error", safeError(error));
        socket.terminate();
        return;
      }
      void this.handle(
        envelope,
        socket,
        previous,
        carryingSubscriptions,
        abort.signal,
      ).catch((error: unknown) => {
        if (abort.signal.aborted) return;
        if (error instanceof AuthorizationExpiredError) {
          this.endAuthorization(socket, safeError(error));
          return;
        }
        this.setState("error", safeError(error));
        socket.close();
      });
    });
    socket.on("error", () => {
      /* close handles recovery; never log a token or overlay key */
    });
    socket.on("close", () => {
      clearTimeout(watchdog);
      abort.abort();
      if (socket !== this.socket || this.stopped) return;
      const delay = Math.max(
        this.minimumReconnectDelay,
        Math.min(30_000, 1_000 * 2 ** this.attempt++) +
          Math.floor(this.dependencies.random() * 500),
      );
      this.minimumReconnectDelay = 0;
      this.setState("reconnecting", `Retrying in ${Math.ceil(delay / 1000)}s`);
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
    signal: AbortSignal,
  ) {
    const type = envelope.metadata.message_type;
    if (type === "session_welcome") {
      if (socket !== this.socket || this.stopped) return;
      previous?.close();
      if (!carrying) {
        const sessionId = envelope.payload.session?.id;
        if (typeof sessionId !== "string")
          throw new Error("Twitch welcome omitted a session ID");
        await this.createSubscriptions(sessionId, socket, signal);
      }
      if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
        this.attempt = 0;
        this.setState("connected");
      }
      return;
    }
    if (type === "session_reconnect") {
      const reconnectUrl = envelope.payload.session?.reconnect_url;
      if (socket === this.socket && typeof reconnectUrl === "string")
        await this.connect(reconnectUrl, true);
      return;
    }
    if (type === "revocation") {
      const status = envelope.payload.subscription?.status;
      if (status === "authorization_revoked" || status === "user_removed") {
        this.dependencies.authorizationLost(this.accountId);
        this.endAuthorization(
          socket,
          `Twitch authorization ended${status ? ` (${status})` : ""}. Reconnect in the studio.`,
        );
        return;
      }
      this.setState(
        "error",
        `Twitch revoked a chat subscription${status ? ` (${status})` : ""}. Reconnect in the studio.`,
      );
      return;
    }
    if (type !== "notification" || this.seen.has(envelope.metadata.message_id))
      return;
    const now = Date.now();
    this.seen.set(envelope.metadata.message_id, now);
    if (this.seen.size > 20_000) {
      const cutoff = now - 10 * 60_000;
      for (const [id, receivedAt] of this.seen) {
        if (receivedAt >= cutoff && this.seen.size <= 10_000) break;
        this.seen.delete(id);
      }
    }
    const event = normalizeEvent(envelope, this.badges);
    if (event) this.emit(event);
    // During Twitch-directed migration the old socket remains readable until
    // the replacement sends Welcome. Only that Welcome closes the old socket.
  }

  private async createSubscriptions(
    sessionId: string,
    socket: WebSocket,
    signal: AbortSignal,
  ) {
    const token = await this.dependencies.accessToken(this.accountId, true);
    if (socket !== this.socket || signal.aborted) return;
    for (const type of SUBSCRIPTIONS) {
      const response = await this.dependencies.fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
          method: "POST",
          signal,
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
        if (response.status === 401 || response.status === 403) {
          this.dependencies.authorizationLost(this.accountId);
          throw new AuthorizationExpiredError(
            `Twitch authorization expired (${response.status})`,
          );
        } else {
          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(retryAfter) && retryAfter > 0)
              this.minimumReconnectDelay = retryAfter * 1_000;
          }
          throw new Error(
            `Unable to subscribe to ${type} (${response.status})`,
          );
        }
      if (socket !== this.socket || signal.aborted) return;
    }
    void this.loadBadges(token, signal).catch(() => undefined);
  }

  private async loadBadges(token: string, signal: AbortSignal) {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Client-Id": config.twitchClientId,
    };
    const urls = [
      "https://api.twitch.tv/helix/chat/badges/global",
      `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(this.accountId)}`,
    ];
    const responses = await Promise.all(
      urls.map((url) => this.dependencies.fetch(url, { headers, signal })),
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
        for (const version of set.versions)
          this.badges.set(`${set.set_id}:${version.id}`, {
            imageUrl: version.image_url_2x,
            title: version.title,
          });
    }
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.socket?.close();
    this.socket = undefined;
    this.state = { kind: "state", state: "connecting" };
  }

  private endAuthorization(socket: WebSocket, detail: string) {
    this.stopped = true;
    this.terminalAuthorization = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.validationTimer) clearInterval(this.validationTimer);
    socket.close();
    this.setState("error", detail);
  }
}

function safeError(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "Twitch did not respond in time";
  return error instanceof Error ? error.message : "Twitch connection failed";
}

export function normalizeEvent(
  envelope: TwitchEnvelope,
  badgeMap = new Map<string, { imageUrl: string; title: string }>(),
): OverlayEvent | undefined {
  const event = envelope.payload.event as Record<string, any>;
  const sentAt = envelope.metadata.message_timestamp;
  switch (envelope.metadata.subscription_type) {
    case "channel.chat.message": {
      const fragments = normalizeFragments(event.message.fragments ?? []);
      return {
        kind: "message",
        id: event.message_id,
        userId: event.chatter_user_id,
        userName: event.chatter_user_name,
        userColor: event.color || "#a78bfa",
        badges: normalizeBadges(event.badges ?? [], badgeMap),
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
        firstMessage: Boolean(event.first_message),
      } satisfies ChatMessage;
    }
    case "channel.chat.notification": {
      const systemMessage =
        event.system_message ?? "A Twitch chat event occurred";
      const messageText = event.message?.text as string | undefined;
      const normalizedMessageFragments = normalizeFragments(
        event.message?.fragments ?? [],
      );
      const messageFragments = normalizedMessageFragments.length
        ? normalizedMessageFragments
        : messageText
          ? ([{ type: "text", text: messageText }] satisfies ChatFragment[])
          : [];
      const fragments: ChatFragment[] = [
        { type: "text", text: systemMessage },
        ...(messageText
          ? [{ type: "text" as const, text: " — " }, ...messageFragments]
          : []),
      ];
      return {
        kind: "notice",
        id: envelope.metadata.message_id,
        text: messageText ? `${systemMessage} — ${messageText}` : systemMessage,
        sentAt,
        noticeType: event.notice_type,
        userId: event.chatter_user_id || undefined,
        userName: event.chatter_user_name || undefined,
        userColor: event.color || undefined,
        badges: normalizeBadges(event.badges ?? [], badgeMap),
        fragments,
      };
    }
    case "channel.chat.message_delete":
      return { kind: "delete", messageId: event.message_id };
    case "channel.chat.clear_user_messages":
      return { kind: "clear-user", userId: event.target_user_id };
    case "channel.chat.clear":
      return { kind: "clear" };
  }
}

function normalizeFragments(fragments: any[]): ChatFragment[] {
  return fragments.map((fragment) => {
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
  });
}

function normalizeBadges(
  badges: any[],
  badgeMap: Map<string, { imageUrl: string; title: string }>,
): ChatMessage["badges"] {
  return badges.map((badge) => ({
    setId: badge.set_id,
    id: badge.id,
    ...badgeMap.get(`${badge.set_id}:${badge.id}`),
  }));
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
  snapshot(accountId: string) {
    return (
      this.chats.get(accountId)?.snapshot() ?? {
        state: "idle",
        detail: undefined,
        viewers: 0,
        lastEventAt: null,
      }
    );
  }
  stop(accountId: string) {
    this.chats.get(accountId)?.stop();
    this.chats.delete(accountId);
  }
  stopAll() {
    for (const chat of this.chats.values()) chat.stop();
    this.chats.clear();
  }
}

export const chats = new ChatManager();
