import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { overlayStreams } from "./overlay-streams";

function fakeResponse() {
  const writes: string[] = [];
  const response = {
    writableEnded: false,
    write(value: string) {
      writes.push(value);
      return true;
    },
    end() {
      response.writableEnded = true;
    },
  };
  return { response: response as unknown as Response, writes };
}

describe("overlay stream registry", () => {
  it("broadcasts live settings and terminates a rotated key", () => {
    const first = fakeResponse();
    const second = fakeResponse();
    const one = overlayStreams.attach("key", first.response)!;
    const two = overlayStreams.attach("key", second.response)!;
    overlayStreams.publish("key", {
      kind: "state",
      state: "connected",
    });
    expect(first.writes.join("")).toContain('"connected"');
    expect(second.writes.join("")).toContain('"connected"');
    overlayStreams.revoke("key");
    expect(first.response.writableEnded).toBe(true);
    expect(second.response.writableEnded).toBe(true);
    expect(overlayStreams.count("key")).toBe(0);
    one.detach();
    two.detach();
  });

  it("sends a message to only one attached response", () => {
    const first = fakeResponse();
    const second = fakeResponse();
    const one = overlayStreams.attach("isolated", first.response)!;
    const two = overlayStreams.attach("isolated", second.response)!;
    one.send({ kind: "clear" });
    expect(first.writes.join("")).toContain('"clear"');
    expect(second.writes).toEqual([]);
    one.detach();
    two.detach();
  });

  it("keeps paused streams open, clears them, and resumes in place", () => {
    const target = fakeResponse();
    const stream = overlayStreams.attach("pausable", target.response)!;
    overlayStreams.setEnabled("pausable", false);
    stream.send({ kind: "clear" });
    stream.send({
      kind: "message",
      id: "hidden",
      userId: "1",
      userName: "Ada",
      userColor: "#ffffff",
      badges: [],
      fragments: [{ type: "text", text: "secret" }],
      text: "secret",
      sentAt: new Date().toISOString(),
      action: false,
      firstMessage: false,
    });
    expect(target.response.writableEnded).toBe(false);
    expect(target.writes.join("")).not.toContain("secret");
    expect(target.writes.join("")).toContain('"paused"');

    overlayStreams.setEnabled("pausable", true, {
      kind: "state",
      state: "connected",
    });
    stream.send({ kind: "clear" });
    expect(target.writes.join("")).toContain('"connected"');
    stream.detach();
  });
});
