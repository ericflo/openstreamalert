import { describe, expect, it } from "vitest";
import { normalizeEvent } from "./twitch";

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
});
