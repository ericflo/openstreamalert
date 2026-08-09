import { useEffect, useRef, useState } from "react";
import type { ChatMessage, OverlayEvent } from "../../shared/events";
import {
  defaultSettings,
  overlaySettingsSchema,
  parseSettings,
  type OverlaySettings,
} from "../../shared/settings";
import { Brand } from "../components/Brand";
import { ChatCanvas } from "../overlay/ChatCanvas";
import { encodeSettings } from "../overlay/config-url";
import { demoMessages, makeDemoMessage } from "../overlay/demo";
import { applySettingsToMessages, reduceOverlayEvent } from "../overlay/feed";

type FeedStatus = {
  state:
    "idle" | "connecting" | "connected" | "reconnecting" | "paused" | "error";
  detail?: string;
  viewers?: number;
  lastEventAt?: string | null;
};

interface Status {
  configured: boolean;
  account: { id: string; login: string; displayName: string } | null;
  overlay: { settings: OverlaySettings; url: string; enabled: boolean } | null;
  connection: FeedStatus | null;
  version: string;
  runtimeMode: "development" | "hosted" | "desktop";
}

const presets: Array<{
  id: OverlaySettings["preset"];
  name: string;
  description: string;
  values: Partial<OverlaySettings>;
}> = [
  {
    id: "minimal",
    name: "Minimal",
    description: "Bare, bright, focused",
    values: { preset: "minimal", font: "sans", backgroundOpacity: 0 },
  },
  {
    id: "glass",
    name: "Glass",
    description: "Soft depth, our signature",
    values: { preset: "glass", font: "sans", backgroundOpacity: 0.72 },
  },
  {
    id: "bubble",
    name: "Bubble",
    description: "Playful conversation",
    values: { preset: "bubble", font: "rounded", backgroundOpacity: 0.82 },
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Quietly technical",
    values: { preset: "terminal", font: "mono", backgroundOpacity: 0.78 },
  },
];

const authErrors: Record<string, string> = {
  "not-configured":
    "This instance needs Twitch credentials before it can connect.",
  "oauth-state":
    "The Twitch sign-in expired or failed its security check. Try again.",
  "oauth-failed":
    "Twitch sign-in could not be completed. Check the server logs and retry.",
  "oauth-denied": "Twitch connection was cancelled. Nothing was changed.",
  "not-allowed":
    "This Twitch account is not allowed to use this private instance.",
};

const publicDemo = import.meta.env.VITE_PUBLIC_DEMO === "1";

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="toggle">
      <span>{children}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function listFromInput(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

export function Studio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [blockedUsersDraft, setBlockedUsersDraft] = useState("");
  const [blockedWordsDraft, setBlockedWordsDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(demoMessages);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>({ state: "idle" });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [copied, setCopied] = useState(false);
  const [uiError, setUiError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    return code
      ? (authErrors[code] ?? "Something interrupted setup. Please retry.")
      : null;
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingSave = useRef<OverlaySettings | undefined>(undefined);
  const saving = useRef(false);
  const settingsRef = useRef(settings);
  const importRef = useRef<HTMLInputElement>(null);
  const testIndex = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!settings.messageLifetime) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - settings.messageLifetime * 1_000;
      setMessages((current) =>
        current.filter((message) => Date.parse(message.sentAt) > cutoff),
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, [settings.messageLifetime]);

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!status?.account) return;
    const source = new EventSource("/api/studio/events");
    source.onopen = () => setFeedStatus({ state: "connecting" });
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as OverlayEvent;
        if (event.kind === "state") {
          setFeedStatus({ state: event.state, detail: event.detail });
        } else if (event.kind !== "settings") {
          setMessages((current) =>
            reduceOverlayEvent(current, event, settingsRef.current),
          );
        }
      } catch {
        setFeedStatus({ state: "error", detail: "Invalid live preview event" });
      }
    };
    source.onerror = () =>
      setFeedStatus({
        state: "reconnecting",
        detail: "Live preview is reconnecting…",
      });
    return () => source.close();
  }, [status?.account]);

  async function loadStatus() {
    if (publicDemo) {
      setStatus({
        configured: false,
        account: null,
        overlay: null,
        connection: null,
        version: "public-demo",
        runtimeMode: "hosted",
      });
      setFeedStatus({ state: "idle" });
      return;
    }
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("The studio server is unavailable.");
      const data = (await response.json()) as Status;
      setStatus(data);
      setFeedStatus(data.connection ?? { state: "idle" });
      if (data.overlay) {
        const next = parseSettings(data.overlay.settings);
        setSettings(next);
        setBlockedUsersDraft(next.blockedUsers.join(", "));
        setBlockedWordsDraft(next.blockedWords.join(", "));
        if (data.account) setMessages([]);
      }
    } catch (error) {
      setUiError(
        error instanceof Error ? error.message : "The studio could not load.",
      );
    }
  }

  function applySettings(next: OverlaySettings, persist = true) {
    setSettings(next);
    setMessages((current) => applySettingsToMessages(current, next));
    settingsRef.current = next;
    if (!persist || !status?.account) return;
    pendingSave.current = next;
    setSaved("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSaves(), 300);
  }

  function update<K extends keyof OverlaySettings>(
    key: K,
    value: OverlaySettings[K],
  ) {
    applySettings({ ...settingsRef.current, [key]: value });
  }

  async function flushSaves() {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pendingSave.current) {
        const next = pendingSave.current;
        pendingSave.current = undefined;
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error("Settings could not be saved");
      }
      setSaved("saved");
      setTimeout(() => setSaved("idle"), 1800);
    } catch (error) {
      setSaved("error");
      setUiError(
        error instanceof Error ? error.message : "Settings could not be saved",
      );
    } finally {
      saving.current = false;
      if (pendingSave.current) void flushSaves();
    }
  }

  async function testMessage() {
    if (!status?.account) {
      const event = makeDemoMessage(testIndex.current++);
      if (event.kind === "message")
        setMessages((current) =>
          reduceOverlayEvent(current, event, settingsRef.current),
        );
      return;
    }

    try {
      const response = await fetch("/api/test-message", { method: "POST" });
      const data = (await response.json()) as {
        event?: ChatMessage;
        viewers?: number;
        error?: string;
      };
      if (!response.ok || !data.event)
        throw new Error(data.error ?? "Test message could not be sent");
      setMessages((current) =>
        reduceOverlayEvent(current, data.event!, settingsRef.current),
      );
      if (!data.viewers)
        setUiError(
          "The preview works, but no OBS or browser overlay is connected. Open the copied OBS URL and try again.",
        );
    } catch (error) {
      setUiError(
        error instanceof Error
          ? error.message
          : "Test message could not be sent",
      );
    }
  }

  function overlayUrl() {
    return (
      status?.overlay?.url ??
      `${new URL("overlay/demo", document.baseURI).toString()}?demo=1&config=${encodeSettings(settings)}`
    );
  }

  async function copyUrl() {
    try {
      const value = overlayUrl();
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setUiError("The URL could not be copied. Select it manually instead.");
    }
  }

  function exportSettings() {
    const portable = { version: 1, settings };
    const blob = new Blob([`${JSON.stringify(portable, null, 2)}\n`], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `openstreamalert-${settings.preset}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importSettings(file?: File) {
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text());
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        throw new Error("That file must contain a settings object.");
      const envelope = candidate as Record<string, unknown>;
      if ("version" in envelope && envelope.version !== 1)
        throw new Error("That configuration version is not supported.");
      const values = "settings" in envelope ? envelope.settings : envelope;
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw new Error("That file must contain a settings object.");
      const knownKeys = Object.keys(defaultSettings);
      if (!Object.keys(values).some((key) => knownKeys.includes(key)))
        throw new Error("That file does not contain OpenStreamAlert settings.");
      const parsed = overlaySettingsSchema.safeParse({
        ...defaultSettings,
        ...(values && typeof values === "object" ? values : {}),
      });
      if (!parsed.success)
        throw new Error(
          "That file is not a valid OpenStreamAlert configuration.",
        );
      applySettings(parsed.data);
      setBlockedUsersDraft(parsed.data.blockedUsers.join(", "));
      setBlockedWordsDraft(parsed.data.blockedWords.join(", "));
    } catch (error) {
      setUiError(
        error instanceof Error ? error.message : "Configuration import failed.",
      );
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function rotateUrl() {
    if (
      !confirm(
        "Rotate the overlay URL? The current URL and every open copy will stop immediately.",
      )
    )
      return;
    const response = await fetch("/api/overlay-key/rotate", { method: "POST" });
    if (!response.ok)
      return setUiError("The private URL could not be rotated.");
    const data = (await response.json()) as { url: string };
    setStatus((current) =>
      current?.overlay
        ? { ...current, overlay: { ...current.overlay, url: data.url } }
        : current,
    );
  }

  async function toggleOverlay() {
    if (!status?.overlay) return;
    const enabled = !status.overlay.enabled;
    const response = await fetch("/api/overlay/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok)
      return setUiError("The overlay privacy control could not be updated.");
    setStatus((current) =>
      current?.overlay
        ? { ...current, overlay: { ...current.overlay, enabled } }
        : current,
    );
  }

  async function logout() {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) return setUiError("Sign out failed.");
    setMessages(demoMessages);
    await loadStatus();
  }

  async function deleteData() {
    if (
      !confirm(
        "Delete your data and revoke Twitch access? This cannot be undone.",
      )
    )
      return;
    const response = await fetch("/api/account", { method: "DELETE" });
    if (!response.ok) return setUiError("Account deletion failed.");
    setMessages(demoMessages);
    await loadStatus();
  }

  const connected = feedStatus.state === "connected";
  const connectionLabel: Record<FeedStatus["state"], string> = {
    idle: "Idle",
    connecting: "Connecting",
    connected: "Live",
    reconnecting: "Reconnecting",
    paused: "Paused",
    error: "Needs attention",
  };
  const previewStatus = {
    state:
      feedStatus.state === "idle" ? ("connected" as const) : feedStatus.state,
    detail: feedStatus.detail,
  };

  return (
    <div className="studio-shell">
      <header className="topbar">
        <Brand />
        <nav aria-label="Project links">
          <a
            href="https://github.com/ericflo/openstreamalert"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
          {status?.account && (
            <button className="text-button" onClick={logout}>
              Sign out
            </button>
          )}
        </nav>
      </header>

      <main className="studio">
        {uiError && (
          <div className="error-banner" role="alert">
            <span>{uiError}</span>
            {status?.configured && feedStatus.state === "error" && (
              <a href="/api/auth/twitch">Reconnect Twitch</a>
            )}
            <button onClick={() => setUiError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        <section className="intro">
          <div>
            <span className="eyebrow">
              <i className="live-dot" /> Twitch chat, beautifully open
            </span>
            <h1>
              Your chat belongs
              <br />
              in the <em>scene.</em>
            </h1>
            <p>
              Design a polished Twitch chat overlay, then add it to OBS with one
              private URL. No ads. No chat logs. No subscription.
            </p>
          </div>
          <div className="connection-card">
            {!status ? (
              <span>Checking your studio…</span>
            ) : status.account ? (
              <>
                <span className="avatar">
                  {status.account.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <small>
                    {connected ? "Live Twitch connection" : "Twitch account"}
                  </small>
                  <strong>{status.account.displayName}</strong>
                </div>
                <span className={`connected-pill ${feedStatus.state}`}>
                  {connectionLabel[feedStatus.state]}
                </span>
                {feedStatus.state === "error" && (
                  <a
                    className="button compact secondary"
                    href="/api/auth/twitch"
                  >
                    Reconnect
                  </a>
                )}
              </>
            ) : (
              <>
                <span className="twitch-icon">✦</span>
                <div>
                  <small>
                    {status.configured
                      ? "Ready when you are"
                      : publicDemo
                        ? "Public demo"
                        : "Demo studio"}
                  </small>
                  <strong>
                    {status.configured
                      ? "Connect Twitch"
                      : status.runtimeMode === "desktop"
                        ? "Desktop preview needs a client ID"
                        : publicDemo
                          ? "Try every design control"
                          : "Twitch setup needed"}
                  </strong>
                </div>
                {status.configured ? (
                  <a className="button compact" href="/api/auth/twitch">
                    Connect
                  </a>
                ) : (
                  <a
                    className="button compact secondary"
                    href={
                      status.runtimeMode === "desktop"
                        ? "https://github.com/ericflo/openstreamalert/blob/main/docs/WINDOWS.md"
                        : "https://github.com/ericflo/openstreamalert#quick-start"
                    }
                  >
                    Setup
                  </a>
                )}
              </>
            )}
          </div>
        </section>

        <section className="workspace">
          <aside className="controls">
            <div className="section-heading">
              <div>
                <span>01</span>
                <h2>Choose a mood</h2>
              </div>
              <span
                className={`save-state ${saved}`}
                role="status"
                aria-live="polite"
              >
                {saved === "saving"
                  ? "Saving…"
                  : saved === "saved"
                    ? "Saved live"
                    : saved === "error"
                      ? "Save failed"
                      : ""}
              </span>
            </div>
            <div className="preset-grid">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  aria-pressed={settings.preset === preset.id}
                  className={settings.preset === preset.id ? "selected" : ""}
                  onClick={() =>
                    applySettings({ ...settingsRef.current, ...preset.values })
                  }
                >
                  <i className={`preset-swatch ${preset.id}`} />
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>

            <div className="control-section">
              <div className="section-heading">
                <div>
                  <span>02</span>
                  <h2>Make it yours</h2>
                </div>
              </div>
              <label className="field">
                <span>Typeface</span>
                <select
                  value={settings.font}
                  onChange={(event) =>
                    update(
                      "font",
                      event.target.value as OverlaySettings["font"],
                    )
                  }
                >
                  <option value="sans">Studio Sans</option>
                  <option value="rounded">Soft Rounded</option>
                  <option value="mono">Broadcast Mono</option>
                </select>
              </label>
              <label className="field">
                <span>
                  Text size <output>{settings.fontSize}px</output>
                </span>
                <input
                  type="range"
                  aria-label="Text size"
                  min="12"
                  max="48"
                  value={settings.fontSize}
                  onChange={(event) =>
                    update("fontSize", Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                <span>
                  Panel opacity{" "}
                  <output>
                    {Math.round(settings.backgroundOpacity * 100)}%
                  </output>
                </span>
                <input
                  type="range"
                  aria-label="Panel opacity"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings.backgroundOpacity}
                  onChange={(event) =>
                    update("backgroundOpacity", Number(event.target.value))
                  }
                />
              </label>
              <label className="field color-field">
                <span>Accent</span>
                <input
                  type="color"
                  value={settings.accent}
                  onChange={(event) => update("accent", event.target.value)}
                />
              </label>
              <div className="toggle-grid">
                <Toggle
                  checked={settings.showBadges}
                  onChange={(v) => update("showBadges", v)}
                >
                  Badges
                </Toggle>
                <Toggle
                  checked={settings.showTimestamps}
                  onChange={(v) => update("showTimestamps", v)}
                >
                  Timestamps
                </Toggle>
                <Toggle
                  checked={settings.showReplies}
                  onChange={(v) => update("showReplies", v)}
                >
                  Replies
                </Toggle>
                <Toggle
                  checked={settings.readableColors}
                  onChange={(v) => update("readableColors", v)}
                >
                  Readable colors
                </Toggle>
                <Toggle
                  checked={settings.showFirstMessage}
                  onChange={(v) => update("showFirstMessage", v)}
                >
                  First-message tag
                </Toggle>
                <Toggle
                  checked={settings.showNotices}
                  onChange={(v) => update("showNotices", v)}
                >
                  Twitch notices
                </Toggle>
              </div>
            </div>

            <div className="control-section">
              <div className="section-heading">
                <div>
                  <span>03</span>
                  <h2>Set the rhythm</h2>
                </div>
              </div>
              <label className="field">
                <span>
                  Message lifetime{" "}
                  <output>
                    {settings.messageLifetime
                      ? `${settings.messageLifetime}s`
                      : "Always"}
                  </output>
                </span>
                <input
                  type="range"
                  aria-label="Message lifetime"
                  min="0"
                  max="120"
                  step="2"
                  value={settings.messageLifetime}
                  onChange={(event) =>
                    update("messageLifetime", Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                <span>
                  Messages on screen <output>{settings.maxMessages}</output>
                </span>
                <input
                  type="range"
                  aria-label="Messages on screen"
                  min="3"
                  max="100"
                  value={settings.maxMessages}
                  onChange={(event) =>
                    update("maxMessages", Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                <span>Entrance</span>
                <select
                  value={settings.animation}
                  onChange={(event) =>
                    update(
                      "animation",
                      event.target.value as OverlaySettings["animation"],
                    )
                  }
                >
                  <option value="slide">Soft slide</option>
                  <option value="fade">Fade</option>
                  <option value="none">None</option>
                </select>
              </label>
              <div className="segmented" aria-label="Message alignment">
                <button
                  aria-pressed={settings.alignment === "left"}
                  className={settings.alignment === "left" ? "selected" : ""}
                  onClick={() => update("alignment", "left")}
                >
                  Left aligned
                </button>
                <button
                  aria-pressed={settings.alignment === "right"}
                  className={settings.alignment === "right" ? "selected" : ""}
                  onClick={() => update("alignment", "right")}
                >
                  Right aligned
                </button>
              </div>
              <div className="toggle-grid">
                <Toggle
                  checked={settings.direction === "top"}
                  onChange={(v) => update("direction", v ? "top" : "bottom")}
                >
                  New at top
                </Toggle>
                <Toggle
                  checked={settings.hideCommands}
                  onChange={(v) => update("hideCommands", v)}
                >
                  Hide commands
                </Toggle>
              </div>
              <label className="field">
                <span>
                  Hidden users <small>comma separated</small>
                </span>
                <input
                  className="text-input"
                  value={blockedUsersDraft}
                  placeholder="nightbot, spam_account"
                  onChange={(event) => {
                    setBlockedUsersDraft(event.target.value);
                    update("blockedUsers", listFromInput(event.target.value));
                  }}
                />
              </label>
              <label className="field">
                <span>
                  Hidden words <small>matched as text</small>
                </span>
                <input
                  className="text-input"
                  value={blockedWordsDraft}
                  placeholder="spoiler, unwanted phrase"
                  onChange={(event) => {
                    setBlockedWordsDraft(event.target.value);
                    update("blockedWords", listFromInput(event.target.value));
                  }}
                />
              </label>
              <div className="portable-actions">
                <button onClick={exportSettings}>Export JSON</button>
                <button onClick={() => importRef.current?.click()}>
                  Import JSON
                </button>
                <button
                  onClick={() => {
                    setBlockedUsersDraft("");
                    setBlockedWordsDraft("");
                    applySettings(defaultSettings);
                  }}
                >
                  Reset
                </button>
                <input
                  ref={importRef}
                  hidden
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void importSettings(event.target.files?.[0])
                  }
                />
              </div>
            </div>
          </aside>

          <section className="preview-column">
            <div className="preview-toolbar">
              <div>
                <span className={`status-light ${feedStatus.state}`} />{" "}
                {status?.account ? "Live Twitch preview" : "Interactive demo"}{" "}
                <small>500 × 700 viewport</small>
              </div>
              <button onClick={() => void testMessage()}>+ Test message</button>
            </div>
            <div className="preview-stage">
              <div className="preview-viewport">
                <div className="preview-glow one" />
                <div className="preview-glow two" />
                <ChatCanvas
                  settings={settings}
                  messages={messages}
                  status={previewStatus}
                />
              </div>
            </div>
            <div className="obs-card">
              <span className="step-number">04</span>
              <div>
                <h2>Add to OBS</h2>
                <p>Sources → Browser · 500 × 700 · 30 FPS</p>
                <div className="url-field">
                  <code title={overlayUrl()}>{overlayUrl()}</code>
                  <button onClick={copyUrl} aria-live="polite">
                    {copied
                      ? "Copied!"
                      : status?.account
                        ? "Copy URL"
                        : "Copy demo URL"}
                  </button>
                </div>
                <p className="obs-note">
                  {status?.account
                    ? "Saved changes update open Browser Sources live. "
                    : "Demo URLs are visual-test snapshots; copy again after changing them. "}
                  Keep “Shutdown source when not visible” and “Refresh browser
                  when active” off. Treat this URL as a secret.
                </p>
                {status?.account && (
                  <div className="account-actions">
                    <button className="rotate-button" onClick={toggleOverlay}>
                      {status.overlay?.enabled
                        ? "Pause overlay"
                        : "Resume overlay"}
                    </button>
                    <button className="rotate-button" onClick={rotateUrl}>
                      Rotate private URL
                    </button>
                    <button
                      className="rotate-button danger"
                      onClick={deleteData}
                    >
                      Delete account data
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </section>
      </main>
      <footer>
        <span>Open source, from first pixel to final frame.</span>
        <span>
          Chat is shown live and never stored ·{" "}
          {status?.version ?? "development"}
        </span>
      </footer>
    </div>
  );
}
