import type { ChatMessage, OverlayEvent } from "../../shared/events";
import type { OverlaySettings } from "../../shared/settings";

export function reduceOverlayEvent(
  current: ChatMessage[],
  event: OverlayEvent,
  settings: OverlaySettings,
) {
  if (event.kind === "clear") return [];
  if (event.kind === "delete")
    return current.filter((item) => item.id !== event.messageId);
  if (event.kind === "clear-user")
    return current.filter((item) => item.userId !== event.userId);

  const next =
    event.kind === "notice" && settings.showNotices
      ? {
          kind: "message" as const,
          id: event.id,
          userId: event.userId ?? "twitch",
          userName: event.userName ?? "Twitch",
          userColor: event.userColor ?? settings.accent,
          badges: event.badges ?? [],
          fragments: event.fragments ?? [
            { type: "text" as const, text: event.text },
          ],
          text: event.text,
          sentAt: event.sentAt,
          action: true,
          firstMessage: false,
        }
      : event.kind === "message"
        ? event
        : undefined;
  if (!next) return current;
  const text = next.text.toLocaleLowerCase();
  const user = next.userName.toLocaleLowerCase().replace(/^@/, "");
  if (settings.hideCommands && next.text.trimStart().startsWith("!"))
    return current;
  if (
    settings.blockedUsers.some(
      (value) => value.toLocaleLowerCase().replace(/^@/, "") === user,
    )
  )
    return current;
  if (
    settings.blockedWords.some((value) =>
      text.includes(value.toLocaleLowerCase()),
    )
  )
    return current;
  return [...current, next].slice(-settings.maxMessages);
}
