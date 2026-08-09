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
});
