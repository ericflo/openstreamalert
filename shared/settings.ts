import { z } from "zod";

export const overlaySettingsSchema = z.object({
  preset: z.enum(["minimal", "glass", "bubble", "terminal"]),
  font: z.enum(["sans", "rounded", "mono"]),
  fontSize: z.number().int().min(12).max(48),
  backgroundOpacity: z.number().min(0).max(1),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  messageLifetime: z.number().int().min(0).max(120),
  maxMessages: z.number().int().min(3).max(100),
  animation: z.enum(["slide", "fade", "none"]),
  alignment: z.enum(["left", "right"]),
  direction: z.enum(["bottom", "top"]),
  showBadges: z.boolean(),
  showTimestamps: z.boolean(),
  showReplies: z.boolean(),
  readableColors: z.boolean(),
  hideCommands: z.boolean(),
  showNotices: z.boolean(),
  showFirstMessage: z.boolean(),
  blockedUsers: z.array(z.string().trim().min(1).max(50)).max(50),
  blockedWords: z.array(z.string().trim().min(1).max(80)).max(50),
});

export type OverlaySettings = z.infer<typeof overlaySettingsSchema>;

export const defaultSettings: OverlaySettings = {
  preset: "glass",
  font: "sans",
  fontSize: 20,
  backgroundOpacity: 0.72,
  accent: "#a78bfa",
  messageLifetime: 24,
  maxMessages: 30,
  animation: "slide",
  alignment: "left",
  direction: "bottom",
  showBadges: true,
  showTimestamps: false,
  showReplies: true,
  readableColors: true,
  hideCommands: true,
  showNotices: true,
  showFirstMessage: true,
  blockedUsers: [],
  blockedWords: [],
};

export function parseSettings(value: unknown): OverlaySettings {
  const candidate =
    value && typeof value === "object"
      ? { ...defaultSettings, ...(value as Record<string, unknown>) }
      : defaultSettings;
  const parsed = overlaySettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaultSettings;
}
