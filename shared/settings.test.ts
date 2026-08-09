import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  overlaySettingsSchema,
  parseSettings,
} from "./settings";

describe("overlay settings", () => {
  it("keeps the shipped defaults valid", () => {
    expect(overlaySettingsSchema.parse(defaultSettings)).toEqual(
      defaultSettings,
    );
  });

  it("rejects unsafe colors and unreasonable layout values", () => {
    expect(
      overlaySettingsSchema.safeParse({ ...defaultSettings, accent: "red" })
        .success,
    ).toBe(false);
    expect(
      overlaySettingsSchema.safeParse({
        ...defaultSettings,
        maxMessages: 10_000,
      }).success,
    ).toBe(false);
  });

  it("migrates older stored settings by filling new defaults", () => {
    const old = { ...defaultSettings } as Record<string, unknown>;
    delete old.showNotices;
    delete old.blockedUsers;
    expect(parseSettings(old)).toMatchObject({
      showNotices: true,
      blockedUsers: [],
    });
  });

  it("falls back safely when persisted settings are malformed", () => {
    expect(parseSettings({ ...defaultSettings, maxMessages: "many" })).toEqual(
      defaultSettings,
    );
  });
});
