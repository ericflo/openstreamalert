import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config, randomToken } from "./config.js";
import { decrypt, encrypt, hashToken } from "./crypto.js";
import {
  defaultSettings,
  parseSettings,
  type OverlaySettings,
} from "../shared/settings.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.chmodSync(path.dirname(config.databasePath), 0o700);
const db = new Database(config.databasePath);
fs.chmodSync(config.databasePath, 0o600);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
for (const suffix of ["-wal", "-shm"]) {
  const file = `${config.databasePath}${suffix}`;
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
}
const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    validated_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS overlays (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    overlay_key TEXT UNIQUE NOT NULL,
    settings TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
`;

export function migrateDatabase(target: Database.Database) {
  const migrate = target.transaction(() => {
    const version = target.pragma("user_version", { simple: true }) as number;
    if (version > 2)
      throw new Error(
        `Database schema ${version} is newer than the supported schema 2`,
      );
    if (version < 1) {
      target.exec(INITIAL_SCHEMA);
      const accountColumns = target.pragma("table_info(accounts)") as Array<{
        name: string;
      }>;
      if (!accountColumns.some((column) => column.name === "validated_at"))
        target.exec(
          "ALTER TABLE accounts ADD COLUMN validated_at INTEGER NOT NULL DEFAULT 0",
        );
      target.pragma("user_version = 1");
    }
    if (version < 2) {
      const overlayColumns = target.pragma("table_info(overlays)") as Array<{
        name: string;
      }>;
      if (!overlayColumns.some((column) => column.name === "enabled"))
        target.exec(
          "ALTER TABLE overlays ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
        );
      target.pragma("user_version = 2");
    }
  });
  migrate();
}

migrateDatabase(db);

export interface Account {
  id: string;
  login: string;
  displayName: string;
}

function decodeSettings(value: string) {
  try {
    return parseSettings(JSON.parse(value));
  } catch {
    return defaultSettings;
  }
}

export function saveAccount(
  input: Account & {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  },
) {
  db.prepare(
    `INSERT INTO accounts (id, login, display_name, access_token, refresh_token, expires_at, validated_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      expires_at=excluded.expires_at, validated_at=excluded.validated_at, updated_at=excluded.updated_at`,
  ).run(
    input.id,
    input.login,
    input.displayName,
    encrypt(input.accessToken),
    encrypt(input.refreshToken),
    input.expiresAt,
    Date.now(),
    Date.now(),
  );
  db.prepare(
    `INSERT OR IGNORE INTO overlays (account_id, overlay_key, settings, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(input.id, randomToken(), JSON.stringify(defaultSettings), Date.now());
}

export function createSession(accountId: string, expiresAt: number) {
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
  const token = randomToken();
  db.prepare(
    "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
  ).run(hashToken(token), accountId, expiresAt);
  return token;
}

export function getAccountBySession(token?: string): Account | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT a.id, a.login, a.display_name FROM sessions s
    JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`,
    )
    .get(hashToken(token), Date.now()) as
    { id: string; login: string; display_name: string } | undefined;
  if (
    row &&
    config.allowedTwitchUsers.length &&
    !config.allowedTwitchUsers.includes(row.login.toLowerCase())
  )
    return undefined;
  return row && { id: row.id, login: row.login, displayName: row.display_name };
}

export function accountCanConnect(id: string, login: string) {
  if (config.allowedTwitchUsers.length)
    return config.allowedTwitchUsers.includes(login.toLowerCase());
  const existing = db.prepare("SELECT 1 FROM accounts WHERE id=?").get(id);
  if (existing) return true;
  const row = db.prepare("SELECT COUNT(*) AS count FROM accounts").get() as {
    count: number;
  };
  return !config.production && row.count === 0;
}

export function deleteSession(token?: string) {
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
}

export function deleteSessionsForAccount(accountId: string) {
  db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId);
}

export function getTokens(accountId: string) {
  const row = db
    .prepare(
      "SELECT access_token, refresh_token, expires_at, validated_at FROM accounts WHERE id=?",
    )
    .get(accountId) as
    | {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        validated_at: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: row.expires_at,
    validatedAt: row.validated_at,
  };
}

export function updateTokens(
  accountId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
) {
  db.prepare(
    "UPDATE accounts SET access_token=?, refresh_token=?, expires_at=?, validated_at=?, updated_at=? WHERE id=?",
  ).run(
    encrypt(accessToken),
    encrypt(refreshToken),
    expiresAt,
    Date.now(),
    Date.now(),
    accountId,
  );
}

export function markTokenValidated(accountId: string) {
  db.prepare("UPDATE accounts SET validated_at=?, updated_at=? WHERE id=?").run(
    Date.now(),
    Date.now(),
    accountId,
  );
}

export function getOverlayForAccount(accountId: string) {
  const row = db
    .prepare(
      "SELECT overlay_key, settings, enabled FROM overlays WHERE account_id=?",
    )
    .get(accountId) as
    { overlay_key: string; settings: string; enabled: number } | undefined;
  return (
    row && {
      key: row.overlay_key,
      settings: decodeSettings(row.settings),
      enabled: Boolean(row.enabled),
    }
  );
}

export function getOverlayByKey(key: string) {
  const row = db
    .prepare(
      `SELECT o.account_id, o.settings, o.enabled, a.display_name FROM overlays o
    JOIN accounts a ON a.id=o.account_id WHERE o.overlay_key=?`,
    )
    .get(key) as
    | {
        account_id: string;
        settings: string;
        display_name: string;
        enabled: number;
      }
    | undefined;
  return (
    row && {
      accountId: row.account_id,
      channelName: row.display_name,
      settings: decodeSettings(row.settings),
      enabled: Boolean(row.enabled),
    }
  );
}

export function saveSettings(accountId: string, settings: OverlaySettings) {
  db.prepare(
    "UPDATE overlays SET settings=?, updated_at=? WHERE account_id=?",
  ).run(JSON.stringify(settings), Date.now(), accountId);
}

export function rotateOverlayKey(accountId: string) {
  const previous = getOverlayForAccount(accountId)?.key;
  const next = randomToken();
  db.prepare(
    "UPDATE overlays SET overlay_key=?, updated_at=? WHERE account_id=?",
  ).run(next, Date.now(), accountId);
  return { next, previous };
}

export function setOverlayEnabled(accountId: string, enabled: boolean) {
  db.prepare(
    "UPDATE overlays SET enabled=?, updated_at=? WHERE account_id=?",
  ).run(enabled ? 1 : 0, Date.now(), accountId);
  return getOverlayForAccount(accountId);
}

export function deleteAccount(accountId: string) {
  db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
}

export function databaseReady() {
  try {
    const result = db.pragma("quick_check", { simple: true });
    return result === "ok";
  } catch {
    return false;
  }
}

export function cleanupExpiredSessions() {
  return db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now())
    .changes;
}
