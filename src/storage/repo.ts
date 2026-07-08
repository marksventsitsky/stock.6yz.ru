import type { Db } from "./db.js";
import type { Promotion, Selection } from "../domain/promo.js";

export type PortalAuth = {
  memberId: string;
  domain: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAtMs: number | null;
};

export function upsertPortalAuth(db: Db, auth: PortalAuth) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO portals (member_id, domain, access_token, refresh_token, expires_at_ms, created_at_ms, updated_at_ms)
    VALUES (@memberId, @domain, @accessToken, @refreshToken, @expiresAtMs, @now, @now)
    ON CONFLICT(member_id) DO UPDATE SET
      domain=excluded.domain,
      access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, portals.refresh_token),
      expires_at_ms=excluded.expires_at_ms,
      updated_at_ms=@now
  `,
  ).run({ ...auth, now });
}

export function getPortalAuth(db: Db, memberId: string): PortalAuth | null {
  const row = db
    .prepare(`SELECT member_id, domain, access_token, refresh_token, expires_at_ms FROM portals WHERE member_id = ?`)
    .get(memberId) as
    | {
        member_id: string;
        domain: string;
        access_token: string | null;
        refresh_token: string | null;
        expires_at_ms: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    memberId: row.member_id,
    domain: row.domain,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAtMs: row.expires_at_ms,
  };
}

type PromotionRow = {
  id: string;
  brand: string;
  cities_json: string;
  type: string;
  title: string;
  description: string;
  period_start: string | null;
  period_end: string | null;
  placements_json: string;
  department: string;
  active: number;
  sort: number;
};

function rowToPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    brand: row.brand,
    cities: JSON.parse(row.cities_json) as string[],
    type: row.type,
    title: row.title,
    description: row.description,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    placements: JSON.parse(row.placements_json) as string[],
    department: row.department,
    active: !!row.active,
    sort: row.sort,
  };
}

export function listPromotions(db: Db): Promotion[] {
  const rows = db
    .prepare(`SELECT * FROM promotions ORDER BY sort ASC, brand ASC, type ASC, title ASC`)
    .all() as PromotionRow[];
  return rows.map(rowToPromotion);
}

export function getPromotion(db: Db, id: string): Promotion | null {
  const row = db.prepare(`SELECT * FROM promotions WHERE id = ?`).get(id) as PromotionRow | undefined;
  return row ? rowToPromotion(row) : null;
}

export function upsertPromotion(db: Db, promo: Promotion) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO promotions
      (id, brand, cities_json, type, title, description, period_start, period_end, placements_json, department, active, sort, created_at_ms, updated_at_ms)
    VALUES
      (@id, @brand, @citiesJson, @type, @title, @description, @periodStart, @periodEnd, @placementsJson, @department, @active, @sort, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      brand=excluded.brand,
      cities_json=excluded.cities_json,
      type=excluded.type,
      title=excluded.title,
      description=excluded.description,
      period_start=excluded.period_start,
      period_end=excluded.period_end,
      placements_json=excluded.placements_json,
      department=excluded.department,
      active=excluded.active,
      sort=excluded.sort,
      updated_at_ms=@now
  `,
  ).run({
    id: promo.id,
    brand: promo.brand,
    citiesJson: JSON.stringify(promo.cities),
    type: promo.type,
    title: promo.title,
    description: promo.description,
    periodStart: promo.periodStart,
    periodEnd: promo.periodEnd,
    placementsJson: JSON.stringify(promo.placements),
    department: promo.department,
    active: promo.active ? 1 : 0,
    sort: promo.sort,
    now,
  });
}

export function deletePromotion(db: Db, id: string) {
  db.prepare(`DELETE FROM promotions WHERE id = ?`).run(id);
}

export type SelectionRow = {
  memberId: string;
  entityType: "DEAL" | "LEAD";
  entityId: number;
  selectionJson: string;
};

export function upsertSelection(db: Db, row: SelectionRow) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO promo_selections (member_id, entity_type, entity_id, selection_json, updated_at_ms)
    VALUES (@memberId, @entityType, @entityId, @selectionJson, @now)
    ON CONFLICT(member_id, entity_type, entity_id) DO UPDATE SET
      selection_json=excluded.selection_json,
      updated_at_ms=@now
  `,
  ).run({ ...row, now });
}

export function upsertEnumValue(
  db: Db,
  params: { memberId: string; entityType: "DEAL" | "LEAD"; fieldCode: string; valueText: string; enumId: string },
) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO enum_values (member_id, entity_type, field_code, value_text, enum_id, updated_at_ms)
    VALUES (@memberId, @entityType, @fieldCode, @valueText, @enumId, @now)
    ON CONFLICT(member_id, entity_type, field_code, value_text) DO UPDATE SET
      enum_id=excluded.enum_id,
      updated_at_ms=@now
  `,
  ).run({ ...params, now });
}

export function getEnumIds(
  db: Db,
  memberId: string,
  entityType: "DEAL" | "LEAD",
  fieldCode: string,
  values: string[],
): Map<string, string> {
  if (!values.length) return new Map();
  const placeholders = values.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT value_text, enum_id FROM enum_values WHERE member_id = ? AND entity_type = ? AND field_code = ? AND value_text IN (${placeholders})`,
    )
    .all(memberId, entityType, fieldCode, ...values) as Array<{ value_text: string; enum_id: string }>;
  return new Map(rows.map((r) => [r.value_text, r.enum_id]));
}

export function getSelection(db: Db, memberId: string, entityType: "DEAL" | "LEAD", entityId: number): Selection | null {
  const row = db
    .prepare(
      `SELECT selection_json FROM promo_selections WHERE member_id = ? AND entity_type = ? AND entity_id = ?`,
    )
    .get(memberId, entityType, entityId) as { selection_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.selection_json) as Selection;
}

export type AdminUser = { userId: number; name: string; addedAtMs: number };

export function listAdminUsers(db: Db, memberId: string): AdminUser[] {
  const rows = db
    .prepare(`SELECT user_id, name, added_at_ms FROM admin_users WHERE member_id = ? ORDER BY added_at_ms DESC`)
    .all(memberId) as Array<{ user_id: number; name: string; added_at_ms: number }>;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, addedAtMs: r.added_at_ms }));
}

export function isAdminUserAllowed(db: Db, memberId: string, userId: number): boolean {
  const row = db
    .prepare(`SELECT 1 FROM admin_users WHERE member_id = ? AND user_id = ?`)
    .get(memberId, userId) as unknown;
  return !!row;
}

export function addAdminUser(db: Db, memberId: string, userId: number, name: string) {
  db.prepare(
    `
    INSERT INTO admin_users (member_id, user_id, name, added_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(member_id, user_id) DO UPDATE SET name=excluded.name
  `,
  ).run(memberId, userId, name, Date.now());
}

export function removeAdminUser(db: Db, memberId: string, userId: number) {
  db.prepare(`DELETE FROM admin_users WHERE member_id = ? AND user_id = ?`).run(memberId, userId);
}

export function getSetting(db: Db, memberId: string, key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE member_id = ? AND key = ?`).get(memberId, key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, memberId: string, key: string, value: string) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO app_settings (member_id, key, value, updated_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(member_id, key) DO UPDATE SET value=excluded.value, updated_at_ms=excluded.updated_at_ms
  `,
  ).run(memberId, key, value, now);
}

export type DirectoryKind = "city" | "direction" | "placement";
export type DirectoryEntry = { externalId: string; name: string; sort: number };

export function listDirectory(db: Db, memberId: string, kind: DirectoryKind): DirectoryEntry[] {
  const rows = db
    .prepare(`SELECT external_id, name, sort FROM list_directory WHERE member_id = ? AND kind = ? ORDER BY sort ASC, name ASC`)
    .all(memberId, kind) as Array<{ external_id: string; name: string; sort: number }>;
  return rows.map((r) => ({ externalId: r.external_id, name: r.name, sort: r.sort }));
}

export function replaceDirectory(db: Db, memberId: string, kind: DirectoryKind, entries: DirectoryEntry[]) {
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM list_directory WHERE member_id = ? AND kind = ?`).run(memberId, kind);
    const insert = db.prepare(
      `INSERT INTO list_directory (member_id, kind, external_id, name, sort, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const e of entries) insert.run(memberId, kind, e.externalId, e.name, e.sort, now);
  });
  tx();
}

/** Manually-managed directory entries (no Bitrix "Списки" backing), e.g. Размещения. */
export function addManualDirectoryEntry(db: Db, memberId: string, kind: DirectoryKind, name: string) {
  const now = Date.now();
  const externalId = "manual:" + name;
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort), -1) as m FROM list_directory WHERE member_id = ? AND kind = ?`)
    .get(memberId, kind) as { m: number };
  db.prepare(
    `
    INSERT INTO list_directory (member_id, kind, external_id, name, sort, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, kind, external_id) DO UPDATE SET name=excluded.name, updated_at_ms=excluded.updated_at_ms
  `,
  ).run(memberId, kind, externalId, name, row.m + 1, now);
}

export function removeDirectoryEntry(db: Db, memberId: string, kind: DirectoryKind, externalId: string) {
  db.prepare(`DELETE FROM list_directory WHERE member_id = ? AND kind = ? AND external_id = ?`).run(memberId, kind, externalId);
}
