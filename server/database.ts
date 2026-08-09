import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config, randomToken } from "./config.js";
import { decrypt, encrypt, hashToken } from "./crypto.js";
import { defaultSettings, type OverlaySettings } from "../shared/settings.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
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
    updated_at INTEGER NOT NULL
  );
`);

export interface Account {
  id: string;
  login: string;
  displayName: string;
}

export function saveAccount(
  input: Account & {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  },
) {
  db.prepare(
    `INSERT INTO accounts (id, login, display_name, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
  ).run(
    input.id,
    input.login,
    input.displayName,
    encrypt(input.accessToken),
    encrypt(input.refreshToken),
    input.expiresAt,
    Date.now(),
  );
  db.prepare(
    `INSERT OR IGNORE INTO overlays (account_id, overlay_key, settings, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(input.id, randomToken(), JSON.stringify(defaultSettings), Date.now());
}

export function createSession(accountId: string, expiresAt: number) {
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
  return row && { id: row.id, login: row.login, displayName: row.display_name };
}

export function deleteSession(token?: string) {
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
}

export function getTokens(accountId: string) {
  const row = db
    .prepare(
      "SELECT access_token, refresh_token, expires_at FROM accounts WHERE id=?",
    )
    .get(accountId) as
    | { access_token: string; refresh_token: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  return {
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: row.expires_at,
  };
}

export function updateTokens(
  accountId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
) {
  db.prepare(
    "UPDATE accounts SET access_token=?, refresh_token=?, expires_at=?, updated_at=? WHERE id=?",
  ).run(
    encrypt(accessToken),
    encrypt(refreshToken),
    expiresAt,
    Date.now(),
    accountId,
  );
}

export function getOverlayForAccount(accountId: string) {
  const row = db
    .prepare("SELECT overlay_key, settings FROM overlays WHERE account_id=?")
    .get(accountId) as { overlay_key: string; settings: string } | undefined;
  return (
    row && {
      key: row.overlay_key,
      settings: JSON.parse(row.settings) as OverlaySettings,
    }
  );
}

export function getOverlayByKey(key: string) {
  const row = db
    .prepare(
      `SELECT o.account_id, o.settings, a.display_name FROM overlays o
    JOIN accounts a ON a.id=o.account_id WHERE o.overlay_key=?`,
    )
    .get(key) as
    { account_id: string; settings: string; display_name: string } | undefined;
  return (
    row && {
      accountId: row.account_id,
      channelName: row.display_name,
      settings: JSON.parse(row.settings) as OverlaySettings,
    }
  );
}

export function saveSettings(accountId: string, settings: OverlaySettings) {
  db.prepare(
    "UPDATE overlays SET settings=?, updated_at=? WHERE account_id=?",
  ).run(JSON.stringify(settings), Date.now(), accountId);
}

export function rotateOverlayKey(accountId: string) {
  const next = randomToken();
  db.prepare(
    "UPDATE overlays SET overlay_key=?, updated_at=? WHERE account_id=?",
  ).run(next, Date.now(), accountId);
  return next;
}

export function deleteAccount(accountId: string) {
  db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
}
