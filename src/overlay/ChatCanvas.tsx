import type { CSSProperties } from "react";
import type { ChatMessage } from "../../shared/events";
import type { OverlaySettings } from "../../shared/settings";

function safeColor(color: string, readable: boolean) {
  if (!readable) return color || "#a78bfa";
  const hex = (color || "#a78bfa").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#c4b5fd";
  const [r, g, b] = [0, 2, 4].map((offset) =>
    parseInt(hex.slice(offset, offset + 2), 16),
  );
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.42 ? `color-mix(in srgb, ${color} 55%, white)` : color;
}

function Message({
  message,
  settings,
}: {
  message: ChatMessage;
  settings: OverlaySettings;
}) {
  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <article
      className={`chat-message ${message.action ? "is-action" : ""}`}
      data-message-id={message.id}
    >
      {settings.showReplies && message.reply && (
        <div className="reply">
          ↳ {message.reply.userName}: {message.reply.text}
        </div>
      )}
      <div className="message-line">
        {settings.showTimestamps && <time>{time}</time>}
        {settings.showBadges &&
          message.badges.map((badge) =>
            badge.imageUrl ? (
              <img
                className="badge"
                src={badge.imageUrl}
                alt={badge.title ?? badge.setId}
                key={`${badge.setId}-${badge.id}`}
              />
            ) : (
              <span
                className="badge-fallback"
                title={badge.setId}
                key={`${badge.setId}-${badge.id}`}
              />
            ),
          )}
        <strong
          style={{
            color: safeColor(message.userColor, settings.readableColors),
          }}
        >
          {message.userName}
        </strong>
        <span className="separator">:</span>
        <span className="message-body">
          {message.fragments.map((fragment, index) =>
            fragment.type === "emote" ? (
              <img
                className="emote"
                src={`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(fragment.id)}/default/dark/2.0`}
                alt={fragment.text}
                key={index}
              />
            ) : (
              <span
                className={fragment.type === "mention" ? "mention" : undefined}
                key={index}
              >
                {fragment.text}
              </span>
            ),
          )}
        </span>
      </div>
    </article>
  );
}

export function ChatCanvas({
  settings,
  messages,
  status = "connected",
}: {
  settings: OverlaySettings;
  messages: ChatMessage[];
  status?: string;
}) {
  const style = {
    "--font-size": `${settings.fontSize}px`,
    "--panel-alpha": settings.backgroundOpacity,
    "--accent": settings.accent,
  } as CSSProperties;
  return (
    <main
      className={`chat-canvas preset-${settings.preset} font-${settings.font} align-${settings.alignment} direction-${settings.direction} motion-${settings.animation}`}
      style={style}
      aria-live="polite"
    >
      <div className="chat-stack">
        {messages.map((message) => (
          <Message message={message} settings={settings} key={message.id} />
        ))}
      </div>
      {status === "error" && (
        <div className="overlay-status">Chat is reconnecting…</div>
      )}
    </main>
  );
}
