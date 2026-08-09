import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../shared/settings";
import { decodeSettings, encodeSettings } from "./config-url";

describe("portable demo settings", () => {
  it("round-trips unicode filters in a URL-safe encoding", () => {
    const settings = { ...defaultSettings, blockedWords: ["spoiler ✨"] };
    const encoded = encodeSettings(settings);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeSettings(encoded)).toEqual(settings);
  });

  it("rejects malformed payloads", () => {
    expect(decodeSettings("not-valid-%%%")).toBeUndefined();
  });
});
