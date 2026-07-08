import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portals (
      member_id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      cities_json TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      period_start TEXT,
      period_end TEXT,
      placements_json TEXT NOT NULL DEFAULT '[]',
      department TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promo_selections (
      member_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, -- 'DEAL' | 'LEAD'
      entity_id INTEGER NOT NULL,
      selection_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (member_id, entity_type, entity_id),
      FOREIGN KEY (member_id) REFERENCES portals(member_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(active);

    -- Bitrix enumeration fields address list options by a portal-specific numeric ID, not by
    -- their text value. We keep a local value->ID mirror so the widget can resolve IDs to write.
    CREATE TABLE IF NOT EXISTS enum_values (
      member_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, -- 'DEAL' | 'LEAD'
      field_code TEXT NOT NULL,
      value_text TEXT NOT NULL,
      enum_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (member_id, entity_type, field_code, value_text)
    );
  `);
}
