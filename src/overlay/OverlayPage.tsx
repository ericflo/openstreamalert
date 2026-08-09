import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, OverlayEvent } from "../../shared/events";
import {
  defaultSettings,
  parseSettings,
  type OverlaySettings,
} from "../../shared/settings";
import { ChatCanvas } from "./ChatCanvas";
import { decodeSettings } from "./config-url";
import { demoMessages } from "./demo";
import { applySettingsToMessages, reduceOverlayEvent } from "./feed";

type FeedStatus = {
  state: "connecting" | "connected" | "reconnecting" | "paused" | "error";
  detail?: string;
};

export function OverlayPage() {
  const key = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
  const query = new URLSearchParams(window.location.search);
  const demo = key === "demo" || query.has("demo");
  const requestedPreset = query.get("preset");
  const encodedSettings = decodeSettings(query.get("config"));
  const demoPreset = ["minimal", "glass", "bubble", "terminal"].includes(
    requestedPreset ?? "",
  )
    ? (requestedPreset as OverlaySettings["preset"])
    : defaultSettings.preset;
  const initialSettings = encodedSettings ?? {
    ...defaultSettings,
    preset: demoPreset,
  };
  const [settings, setSettings] = useState<OverlaySettings>(initialSettings);
  const [messages, setMessages] = useState<ChatMessage[]>(
    demo ? applySettingsToMessages(demoMessages, initialSettings) : [],
  );
  const [status, setStatus] = useState<FeedStatus>(
    demo
      ? { state: "connected", detail: "Demo data" }
      : { state: "connecting" },
  );
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applyEvent = useCallback((event: OverlayEvent) => {
    if (event.kind === "state") {
      if (event.state === "paused") setMessages([]);
      setStatus({ state: event.state, detail: event.detail });
      return;
    }
    if (event.kind === "settings") {
      const next = parseSettings(event.settings);
      settingsRef.current = next;
      setSettings(next);
      setMessages((current) => applySettingsToMessages(current, next));
      return;
    }
    setMessages((current) =>
      reduceOverlayEvent(current, event, settingsRef.current),
    );
    setStatus((current) =>
      current.state === "error" ? { state: "connected" } : current,
    );
  }, []);

  useEffect(() => {
    if (demo) return;
    const abort = new AbortController();
    let source: EventSource | undefined;
    void fetch(`/api/overlay/${encodeURIComponent(key)}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This overlay URL is invalid or has been rotated."
              : "The overlay could not be loaded.",
          );
        const data = (await response.json()) as {
          settings: OverlaySettings;
          enabled: boolean;
        };
        if (abort.signal.aborted) return;
        setSettings(parseSettings(data.settings));
        source = new EventSource(
          `/api/overlay/${encodeURIComponent(key)}/events`,
        );
        source.onopen = () => setStatus({ state: "connecting" });
        source.onmessage = (message) => {
          try {
            applyEvent(JSON.parse(message.data) as OverlayEvent);
          } catch {
            setStatus({ state: "error", detail: "Invalid overlay event" });
          }
        };
        source.onerror = () =>
          setStatus({
            state: "reconnecting",
            detail: "The overlay stream was interrupted. Retrying…",
          });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setStatus({
          state: "error",
          detail: error instanceof Error ? error.message : "Overlay not found",
        });
      });
    return () => {
      abort.abort();
      source?.close();
    };
  }, [applyEvent, demo, key]);

  useEffect(() => {
    if (!settings.messageLifetime) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - settings.messageLifetime * 1_000;
      setMessages((current) =>
        current.filter((message) => Date.parse(message.sentAt) > cutoff),
      );
    }, 500);
    return () => clearInterval(timer);
  }, [settings.messageLifetime]);

  return <ChatCanvas settings={settings} messages={messages} status={status} />;
}
