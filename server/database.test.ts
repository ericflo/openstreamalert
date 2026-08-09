import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "./database";

describe("database migrations", () => {
  it("creates the current schema transactionally", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    expect(database.pragma("user_version", { simple: true })).toBe(2);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual([
      "accounts",
      "overlays",
      "sessions",
    ]);
    database.close();
  });

  it("upgrades the legacy account table without losing rows", () => {
    const database = new Database(":memory:");
    database.exec(`CREATE TABLE accounts (
      id TEXT PRIMARY KEY, login TEXT NOT NULL, display_name TEXT NOT NULL,
      access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    database
      .prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("1", "ada", "Ada", "access", "refresh", 1, 1);
    migrateDatabase(database);
    const columns = database.pragma("table_info(accounts)") as Array<{
      name: string;
    }>;
    expect(columns.some((column) => column.name === "validated_at")).toBe(true);
    const overlayColumns = database.pragma("table_info(overlays)") as Array<{
      name: string;
    }>;
    expect(overlayColumns.some((column) => column.name === "enabled")).toBe(
      true,
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM accounts").get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});
