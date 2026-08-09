import {
  overlaySettingsSchema,
  parseSettings,
  type OverlaySettings,
} from "../../shared/settings";

export function encodeSettings(settings: OverlaySettings) {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeSettings(value: string | null) {
  if (!value) return undefined;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const candidate = JSON.parse(new TextDecoder().decode(bytes));
    const parsed = overlaySettingsSchema.safeParse(parseSettings(candidate));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
