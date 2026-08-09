import { useEffect, useRef, useState } from "react";
import { Brand } from "../components/Brand";

interface DeviceAuthorization {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export function DeviceAuth() {
  const [authorization, setAuthorization] =
    useState<DeviceAuthorization | null>(null);
  const [state, setState] = useState<
    "loading" | "waiting" | "offline" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let active = true;
    let countdown: ReturnType<typeof setInterval> | undefined;
    async function begin() {
      try {
        const response = await fetch("/api/auth/device");
        if (!response.ok) throw new Error("This Twitch code has expired.");
        const value = (await response.json()) as DeviceAuthorization;
        if (!active) return;
        setAuthorization(value);
        setMinutesRemaining(
          Math.max(0, Math.ceil((value.expiresAt - Date.now()) / 60_000)),
        );
        countdown = setInterval(
          () =>
            setMinutesRemaining(
              Math.max(0, Math.ceil((value.expiresAt - Date.now()) / 60_000)),
            ),
          1_000,
        );
        setState("waiting");
        timer.current = setTimeout(() => void poll(), value.intervalMs);
      } catch {
        if (active) {
          setErrorMessage("This one-time code expired or is no longer valid.");
          setState("error");
        }
      }
    }
    async function poll() {
      try {
        const response = await fetch("/api/auth/device/poll", {
          method: "POST",
        });
        const value = (await response.json()) as {
          state: "pending" | "authorized" | "denied" | "expired" | "error";
          retryAfterMs?: number;
        };
        if (!active) return;
        if (response.ok && value.state === "authorized") {
          window.location.assign("/?connected=1");
          return;
        }
        if (response.ok && value.state === "pending") {
          setState("waiting");
          timer.current = setTimeout(
            () => void poll(),
            Math.max(1_000, value.retryAfterMs ?? 5_000),
          );
          return;
        }
        setErrorMessage(
          value.state === "denied"
            ? "Twitch connection was declined. Nothing was changed."
            : value.state === "expired"
              ? "This one-time code expired before it was approved."
              : "Twitch could not finish connecting. Your existing settings were not changed.",
        );
        setState("error");
      } catch {
        if (active) {
          setState("offline");
          timer.current = setTimeout(() => void poll(), 5_000);
        }
      }
    }
    void begin();
    return () => {
      active = false;
      if (countdown) clearInterval(countdown);
      clearTimeout(timer.current);
    };
  }, []);

  async function copyCode() {
    if (!authorization) return;
    try {
      await navigator.clipboard.writeText(authorization.userCode);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1_500);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="device-shell">
      <header className="topbar">
        <Brand />
      </header>
      <main className="device-card" aria-live="polite">
        <span className="eyebrow">Secure Twitch connection</span>
        <h1>Connect in your browser.</h1>
        {state === "loading" && <p>Requesting a one-time code from Twitch…</p>}
        {state === "error" && (
          <>
            <p>{errorMessage}</p>
            <a className="button" href="/api/auth/twitch">
              Try again
            </a>
            <a className="device-cancel" href="/">
              Back to studio
            </a>
          </>
        )}
        {(state === "waiting" || state === "offline") && authorization && (
          <>
            <p>
              Copy this one-time code, open Twitch, and approve read-only chat
              access. This window will finish automatically.
            </p>
            <button className="device-code" onClick={() => void copyCode()}>
              <strong>{authorization.userCode}</strong>
              <small>
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed — select the code"
                    : "Click to copy"}
              </small>
            </button>
            <a
              className="button"
              href={authorization.verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              Open Twitch
            </a>
            <small className="device-waiting">
              {state === "offline"
                ? "Twitch is temporarily unreachable. Retrying…"
                : `Waiting securely for Twitch · ${minutesRemaining ?? "—"} min remaining`}
            </small>
            <a className="device-cancel" href="/">
              Cancel
            </a>
          </>
        )}
      </main>
    </div>
  );
}
