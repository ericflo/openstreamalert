import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { config } from "./config.js";

function key(): Buffer {
  const decoded = Buffer.from(config.encryptionKey, "base64");
  if (decoded.length !== 32)
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return decoded;
}

export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decrypt(value: string): string {
  const [iv, tag, encrypted] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
