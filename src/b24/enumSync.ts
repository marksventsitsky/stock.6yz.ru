import type { Db } from "../storage/db.js";
import { callB24 } from "./rest.js";
import { getEnumIds, upsertEnumValue } from "../storage/repo.js";
import type { EntityKind } from "./setup.js";

type UserFieldListItem = {
  ID: string;
  FIELD_NAME: string;
  USER_TYPE_ID: string;
  LIST?: Array<{ ID: string; VALUE: string }>;
};

function listMethod(entity: EntityKind): string {
  return entity === "deal" ? "crm.deal.userfield.list" : "crm.lead.userfield.list";
}
function updateMethod(entity: EntityKind): string {
  return entity === "deal" ? "crm.deal.userfield.update" : "crm.lead.userfield.update";
}

async function fetchField(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string; entity: EntityKind; fieldCode: string },
): Promise<UserFieldListItem | null> {
  // Callers pass the short field code (e.g. "PROMO_CITY") which is what field CREATION uses,
  // but Bitrix stores/filters by the full name it prepends ("UF_CRM_PROMO_CITY") — normalize
  // so the lookup actually matches (otherwise the value->ID mirror never gets populated).
  const fullName = ctx.fieldCode.startsWith("UF_CRM_") ? ctx.fieldCode : `UF_CRM_${ctx.fieldCode}`;
  const res = await callB24<UserFieldListItem[]>(db, {
    domain: ctx.domain,
    memberId: ctx.memberId,
    accessToken: ctx.accessToken,
    method: listMethod(ctx.entity),
    body: { filter: { FIELD_NAME: fullName } },
  });
  if (!res.ok || !res.result.length) return null;
  return res.result[0];
}

/** Pulls the current VALUE -> ID mapping for an enumeration field from Bitrix into our local mirror. */
export async function syncEnumField(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string; entity: EntityKind; fieldCode: string; entityTypeLabel: "DEAL" | "LEAD" },
): Promise<void> {
  const field = await fetchField(db, ctx);
  if (!field?.LIST) return;
  for (const item of field.LIST) {
    upsertEnumValue(db, {
      memberId: ctx.memberId,
      entityType: ctx.entityTypeLabel,
      fieldCode: ctx.fieldCode,
      valueText: item.VALUE,
      enumId: item.ID,
    });
  }
}

/**
 * Makes sure every value in `requiredValues` exists as an option on the Bitrix enumeration field,
 * appending any missing ones (existing options keep their IDs so already-set deals/leads are unaffected),
 * then refreshes our local value->ID mirror.
 */
export async function ensureEnumHasValues(
  db: Db,
  ctx: {
    domain: string;
    memberId: string;
    accessToken: string;
    entity: EntityKind;
    fieldCode: string;
    entityTypeLabel: "DEAL" | "LEAD";
    requiredValues: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string; errorDescription?: string }> {
  const field = await fetchField(db, ctx);
  if (!field) return { ok: false, error: "field_not_found" };

  const existingValues = new Set((field.LIST ?? []).map((i) => i.VALUE));
  const missing = ctx.requiredValues.filter((v) => !existingValues.has(v));

  if (missing.length) {
    const nextList = [
      ...(field.LIST ?? []).map((i) => ({ ID: i.ID, VALUE: i.VALUE, DEF: "N" as const })),
      ...missing.map((v) => ({ VALUE: v, DEF: "N" as const })),
    ];
    const res = await callB24<unknown>(db, {
      domain: ctx.domain,
      memberId: ctx.memberId,
      accessToken: ctx.accessToken,
      method: updateMethod(ctx.entity),
      body: { id: field.ID, fields: { LIST: nextList } },
    });
    if (!res.ok) return res;
  }

  await syncEnumField(db, ctx);
  return { ok: true };
}

/**
 * Resolves text values to Bitrix enum IDs, growing the portal's enum field on the fly for any
 * value the local mirror doesn't know about yet (e.g. a promo added to the catalog after the last sync).
 */
export async function resolveEnumIds(
  db: Db,
  ctx: {
    domain: string;
    memberId: string;
    accessToken: string;
    entity: EntityKind;
    fieldCode: string;
    entityTypeLabel: "DEAL" | "LEAD";
    values: string[];
  },
): Promise<string[]> {
  const distinct = Array.from(new Set(ctx.values.filter(Boolean)));
  if (!distinct.length) return [];

  let map = getEnumIds(db, ctx.memberId, ctx.entityTypeLabel, ctx.fieldCode, distinct);
  const missing = distinct.filter((v) => !map.has(v));
  if (missing.length) {
    await ensureEnumHasValues(db, { ...ctx, requiredValues: missing });
    map = getEnumIds(db, ctx.memberId, ctx.entityTypeLabel, ctx.fieldCode, distinct);
  }
  return distinct.map((v) => map.get(v)).filter((x): x is string => !!x);
}
