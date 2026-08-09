import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, OverlayEvent } from "../../shared/events";
import { defaultSettings, type OverlaySettings } from "../../shared/settings";
import { ChatCanvas } from "./ChatCanvas";
import { demoMessages } from "./demo";

export function OverlayPage() {
  const key = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
  const query = new URLSearchParams(window.location.search);
  const demo = key === "demo" || query.has("demo");
  const requestedPreset = query.get("preset");
  const demoPreset = ["minimal", "glass", "bubble", "terminal"].includes(
    requestedPreset ?? "",
  )
    ? (requestedPreset as OverlaySettings["preset"])
    : defaultSettings.preset;
  const [settings, setSettings] = useState<OverlaySettings>({
    ...defaultSettings,
    preset: demoPreset,
  });
  const [messages, setMessages] = useState<ChatMessage[]>(
    demo ? demoMessages : [],
  );
  const [status, setStatus] = useState("connecting");
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applyEvent = useCallback((event: OverlayEvent) => {
    if (event.kind === "state") {
      setStatus(event.state);
      return;
    }
    setMessages((current) => {
      if (event.kind === "clear") return [];
      if (event.kind === "delete")
        return current.filter((item) => item.id !== event.messageId);
      if (event.kind === "clear-user")
        return current.filter((item) => item.userId !== event.userId);
      const next =
        event.kind === "notice"
          ? {
              kind: "message" as const,
              id: event.id,
              userId: "twitch",
              userName: "Twitch",
              userColor: settingsRef.current.accent,
              badges: [],
              fragments: [{ type: "text" as const, text: event.text }],
              text: event.text,
              sentAt: event.sentAt,
              action: true,
            }
          : event.kind === "message"
            ? event
            : undefined;
      if (
        !next ||
        (settingsRef.current.hideCommands && next.text.startsWith("!"))
      )
        return current;
      return [...current, next].slice(-settingsRef.current.maxMessages);
    });
  }, []);

  useEffect(() => {
    if (demo) return;
    let source: EventSource | undefined;
    void fetch(`/api/overlay/${encodeURIComponent(key)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Overlay not found");
        const data = (await response.json()) as { settings: OverlaySettings };
        setSettings(data.settings);
        source = new EventSource(
          `/api/overlay/${encodeURIComponent(key)}/events`,
        );
        source.onmessage = (message) =>
          applyEvent(JSON.parse(message.data) as OverlayEvent);
        source.onerror = () => setStatus("error");
      })
      .catch(() => setStatus("error"));
    return () => source?.close();
  }, [applyEvent, demo, key]);

  useEffect(() => {
    if (!settings.messageLifetime || demo) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - settings.messageLifetime * 1_000;
      setMessages((current) =>
        current.filter((message) => Date.parse(message.sentAt) > cutoff),
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, [settings.messageLifetime, demo]);

  return <ChatCanvas settings={settings} messages={messages} status={status} />;
}
