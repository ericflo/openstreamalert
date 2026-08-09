import { describe, expect, it } from "vitest";
import type { ChatMessage, OverlayEvent } from "../../shared/events";
import { defaultSettings } from "../../shared/settings";
import { applySettingsToMessages, reduceOverlayEvent } from "./feed";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    kind: "message",
    id: "one",
    userId: "1",
    userName: "Ada",
    userColor: "#ffffff",
    badges: [],
    fragments: [{ type: "text", text: "hello world" }],
    text: "hello world",
    sentAt: "2026-08-09T00:00:00Z",
    action: false,
    firstMessage: false,
    ...overrides,
  };
}

describe("overlay feed", () => {
  it("filters commands, users, and phrases case-insensitively", () => {
    expect(
      reduceOverlayEvent([], message({ text: "  !uptime" }), defaultSettings),
    ).toEqual([]);
    expect(
      reduceOverlayEvent([], message({ userName: "NightBot" }), {
        ...defaultSettings,
        blockedUsers: ["@nightbot"],
      }),
    ).toEqual([]);
    expect(
      reduceOverlayEvent([], message({ text: "Here is a SPOILER" }), {
        ...defaultSettings,
        blockedWords: ["spoiler"],
      }),
    ).toEqual([]);
  });

  it("turns notices into safe display messages only when enabled", () => {
    const notice: OverlayEvent = {
      kind: "notice",
      id: "notice",
      text: "A viewer subscribed",
      sentAt: "2026-08-09T00:00:00Z",
    };
    expect(reduceOverlayEvent([], notice, defaultSettings)[0]).toMatchObject({
      userName: "Twitch",
      action: true,
    });
    expect(
      reduceOverlayEvent([], notice, {
        ...defaultSettings,
        showNotices: false,
      }),
    ).toEqual([]);
  });

  it("applies moderation events and a bounded message history", () => {
    const messages = [
      message({ id: "one", userId: "a" }),
      message({ id: "two", userId: "b" }),
      message({ id: "three", userId: "a" }),
    ];
    expect(
      reduceOverlayEvent(
        messages,
        { kind: "delete", messageId: "two" },
        defaultSettings,
      ),
    ).toHaveLength(2);
    expect(
      reduceOverlayEvent(
        messages,
        { kind: "clear-user", userId: "a" },
        defaultSettings,
      ),
    ).toEqual([messages[1]]);
    expect(
      reduceOverlayEvent(messages, { kind: "clear" }, defaultSettings),
    ).toEqual([]);
    expect(
      reduceOverlayEvent(messages, message({ id: "four" }), {
        ...defaultSettings,
        maxMessages: 3,
      }).map((item) => item.id),
    ).toEqual(["two", "three", "four"]);
  });

  it("applies changed privacy filters and limits to messages already visible", () => {
    const current = [
      message({ id: "oldest", userName: "Ada" }),
      message({ id: "blocked", userName: "NightBot" }),
      message({ id: "notice", noticeType: "sub" }),
      message({ id: "latest", text: "still visible" }),
    ];
    expect(
      applySettingsToMessages(current, {
        ...defaultSettings,
        blockedUsers: ["nightbot"],
        showNotices: false,
        maxMessages: 3,
      }).map((item) => item.id),
    ).toEqual(["oldest", "latest"]);
  });
});
