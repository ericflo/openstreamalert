import { describe, expect, it } from "vitest";
import { defaultSettings, overlaySettingsSchema } from "./settings";

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
});
