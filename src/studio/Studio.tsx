import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/events";
import { defaultSettings, type OverlaySettings } from "../../shared/settings";
import { Brand } from "../components/Brand";
import { ChatCanvas } from "../overlay/ChatCanvas";
import { demoMessages, makeDemoMessage } from "../overlay/demo";

interface Status {
  configured: boolean;
  account: { id: string; login: string; displayName: string } | null;
  overlay: { settings: OverlaySettings; url: string } | null;
}

const presets: Array<{
  id: OverlaySettings["preset"];
  name: string;
  description: string;
}> = [
  { id: "minimal", name: "Minimal", description: "Bare, bright, focused" },
  { id: "glass", name: "Glass", description: "Soft depth, our signature" },
  { id: "bubble", name: "Bubble", description: "Playful conversation" },
  { id: "terminal", name: "Terminal", description: "Quietly technical" },
];

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
      <i />
    </label>
  );
}

export function Studio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [messages, setMessages] = useState<ChatMessage[]>(demoMessages);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const testIndex = useRef(0);

  useEffect(() => {
    void loadStatus();
  }, []);
  async function loadStatus() {
    const response = await fetch("/api/status");
    const data = (await response.json()) as Status;
    setStatus(data);
    if (data.overlay) setSettings(data.overlay.settings);
  }

  function update<K extends keyof OverlaySettings>(
    key: K,
    value: OverlaySettings[K],
  ) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (!status?.account) return;
    setSaved("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
        .then((response) => {
          if (!response.ok) throw new Error();
          setSaved("saved");
          setTimeout(() => setSaved("idle"), 1800);
        })
        .catch(() => setSaved("error"));
    }, 350);
  }

  function testMessage() {
    const event = makeDemoMessage(testIndex.current++);
    if (event.kind === "message")
      setMessages((current) =>
        [...current, event].slice(-settings.maxMessages),
      );
  }

  async function copyUrl() {
    const url =
      status?.overlay?.url ?? `${window.location.origin}/overlay/demo?demo=1`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function rotateUrl() {
    if (
      !confirm(
        "Rotate the overlay URL? The current URL will stop working immediately.",
      )
    )
      return;
    const response = await fetch("/api/overlay-key/rotate", { method: "POST" });
    const data = (await response.json()) as { url: string };
    setStatus((current) =>
      current && current.overlay
        ? { ...current, overlay: { ...current.overlay, url: data.url } }
        : current,
    );
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    await loadStatus();
  }

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
              Disconnect
            </button>
          )}
        </nav>
      </header>

      <main className="studio">
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
                  <small>Connected as</small>
                  <strong>{status.account.displayName}</strong>
                </div>
                <span className="connected-pill">Connected</span>
              </>
            ) : (
              <>
                <span className="twitch-icon">✦</span>
                <div>
                  <small>
                    {status.configured ? "Ready when you are" : "Demo studio"}
                  </small>
                  <strong>
                    {status.configured
                      ? "Connect Twitch"
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
                    href="https://github.com/ericflo/openstreamalert#quick-start"
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
              <span className={`save-state ${saved}`}>
                {saved === "saving"
                  ? "Saving…"
                  : saved === "saved"
                    ? "Saved"
                    : saved === "error"
                      ? "Save failed"
                      : ""}
              </span>
            </div>
            <div className="preset-grid">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={settings.preset === preset.id ? "selected" : ""}
                  onClick={() => update("preset", preset.id)}
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
                  min="12"
                  max="36"
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
                  min="0"
                  max="60"
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
                  min="3"
                  max="50"
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
                  className={settings.alignment === "left" ? "selected" : ""}
                  onClick={() => update("alignment", "left")}
                >
                  Left aligned
                </button>
                <button
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
            </div>
          </aside>

          <section className="preview-column">
            <div className="preview-toolbar">
              <div>
                <span className="status-light" /> Live preview{" "}
                <small>500 × 700</small>
              </div>
              <button onClick={testMessage}>+ Test message</button>
            </div>
            <div className="preview-stage">
              <div className="preview-glow one" />
              <div className="preview-glow two" />
              <ChatCanvas settings={settings} messages={messages} />
            </div>
            <div className="obs-card">
              <span className="step-number">04</span>
              <div>
                <h2>Add to OBS</h2>
                <p>Sources → Browser · 500 × 700 · 30 FPS</p>
                <div className="url-field">
                  <code>
                    {status?.overlay?.url ??
                      `${window.location.origin}/overlay/demo?demo=1`}
                  </code>
                  <button onClick={copyUrl}>
                    {copied ? "Copied!" : "Copy URL"}
                  </button>
                </div>
                <p className="obs-note">
                  Keep “Shutdown source when not visible” and “Refresh browser
                  when active” off. Your URL is a secret.
                </p>
                {status?.account && (
                  <button className="rotate-button" onClick={rotateUrl}>
                    Rotate private URL
                  </button>
                )}
              </div>
            </div>
          </section>
        </section>
      </main>
      <footer>
        <span>Open source, from first pixel to final frame.</span>
        <span>Chat is shown live and never stored.</span>
      </footer>
    </div>
  );
}
