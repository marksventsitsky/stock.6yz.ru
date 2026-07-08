import type { Db } from "../storage/db.js";
import { callB24 } from "./rest.js";
import { syncEnumField } from "./enumSync.js";
import type { Promotion } from "../domain/promo.js";

export type EntityKind = "deal" | "lead";

export type FieldCodes = {
  jsonField: string;
  cityField: string;
  brandField: string;
  typeField: string;
  nameField: string;
};

const USER_TYPE_ID = "promo_selector";

const DUPLICATE_ERRORS = new Set(["ERROR_FIELD_NAME", "ERROR_DUPLICATE", "ERROR_USER_TYPE_ID"]);

function isDuplicateOk(res: { ok: true } | { ok: false; error: string; errorDescription?: string }): boolean {
  if (res.ok) return true;
  if (DUPLICATE_ERRORS.has(res.error)) return true;
  return String(res.errorDescription ?? "").toLowerCase().includes("already binded");
}

/**
 * Registers the custom user-field TYPE that renders the promo picker inline on the deal card
 * (like "График рассрочки" in installment_plans_and_payments). Needs the `placement` scope —
 * with only `crm`+`user` this call returns `insufficient_scope` (that's why an earlier version
 * fell back to a detail-tab placement). Now that the app has `placement`, we use the proper
 * embedded field so it lives inside the main card, not as a separate top tab.
 */
async function ensureUserFieldType(
  db: Db,
  params: { domain: string; memberId: string; accessToken: string; handlerUrl: string },
) {
  return callB24<unknown>(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    method: "userfieldtype.add",
    body: {
      USER_TYPE_ID,
      HANDLER: params.handlerUrl,
      TITLE: "Выбор акции",
      DESCRIPTION: "Виджет выбора акций (направление → тип → акция)",
    },
  });
}

async function ensureField(
  db: Db,
  params: {
    domain: string;
    memberId: string;
    accessToken: string;
    entity: EntityKind;
    fields: Record<string, unknown>;
  },
) {
  const method = params.entity === "deal" ? "crm.deal.userfield.add" : "crm.lead.userfield.add";
  return callB24<unknown>(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    method,
    body: { fields: params.fields },
  });
}

function enumList(values: string[]): Array<{ VALUE: string; DEF: "N" }> {
  return values.map((v) => ({ VALUE: v, DEF: "N" }));
}

export async function setupPromoFields(
  db: Db,
  params: {
    domain: string;
    memberId: string;
    accessToken: string;
    publicBaseUrl: string;
    codes: FieldCodes;
    cities: string[];
    brands: string[];
    types: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string; errorDescription?: string }> {
  const handlerUrl = `${params.publicBaseUrl.replace(/\/+$/, "")}/b24/userfield/promo`;

  // Register the custom field type that renders the embedded picker on the card.
  const addType = await ensureUserFieldType(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    handlerUrl,
  });
  if (!isDuplicateOk(addType)) return addType;

  // Bitrix uses the same UF_CRM_ namespace for every CRM entity, so one set of short field
  // names produces identical field codes on both the deal and the lead.
  const codes = params.codes;
  const shortJsonName = codes.jsonField.replace(/^UF_CRM_/, "");
  const cityShort = codes.cityField.replace(/^UF_CRM_/, "");
  const brandShort = codes.brandField.replace(/^UF_CRM_/, "");
  const typeShort = codes.typeField.replace(/^UF_CRM_/, "");
  const nameShort = codes.nameField.replace(/^UF_CRM_/, "");

  // Only deals for now (sales pipeline "Продажи", category 0) — leads aren't wired up yet.
  for (const entity of ["deal"] as const) {
    // 1) The embedded picker field: a custom-type (promo_selector) field that renders our widget
    //    inline on the card and stores the full JSON snapshot as its value.
    const jsonRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID,
        FIELD_NAME: shortJsonName,
        XML_ID: shortJsonName,
        MANDATORY: "N",
        SHOW_IN_LIST: "N",
        EDIT_IN_LIST: "N",
        EDIT_FORM_LABEL: "Акции",
        LIST_COLUMN_LABEL: "Акции",
        SETTINGS: {},
      },
    });
    if (!isDuplicateOk(jsonRes)) return jsonRes;

    // 2) Plain enumeration fields (multiple) so standard CRM reports/filters/analytics can use them.
    const cityRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID: "enumeration",
        FIELD_NAME: cityShort,
        XML_ID: cityShort,
        MULTIPLE: "Y",
        MANDATORY: "N",
        SHOW_FILTER: "Y",
        SHOW_IN_LIST: "Y",
        EDIT_IN_LIST: "Y",
        EDIT_FORM_LABEL: "Направление (город)",
        LIST_COLUMN_LABEL: "Направление (город)",
        LIST: enumList(params.cities),
      },
    });
    if (!isDuplicateOk(cityRes)) return cityRes;
    await syncEnumField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fieldCode: cityShort,
      entityTypeLabel: entity === "deal" ? "DEAL" : "LEAD",
    });

    const brandRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID: "enumeration",
        FIELD_NAME: brandShort,
        XML_ID: brandShort,
        MULTIPLE: "Y",
        MANDATORY: "N",
        SHOW_FILTER: "Y",
        SHOW_IN_LIST: "Y",
        EDIT_IN_LIST: "Y",
        EDIT_FORM_LABEL: "Бренд акции",
        LIST_COLUMN_LABEL: "Бренд акции",
        LIST: enumList(params.brands),
      },
    });
    if (!isDuplicateOk(brandRes)) return brandRes;
    await syncEnumField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fieldCode: brandShort,
      entityTypeLabel: entity === "deal" ? "DEAL" : "LEAD",
    });

    const typeRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID: "enumeration",
        FIELD_NAME: typeShort,
        XML_ID: typeShort,
        MULTIPLE: "Y",
        MANDATORY: "N",
        SHOW_FILTER: "Y",
        SHOW_IN_LIST: "Y",
        EDIT_IN_LIST: "Y",
        EDIT_FORM_LABEL: "Тип акции",
        LIST_COLUMN_LABEL: "Тип акции",
        LIST: enumList(params.types),
      },
    });
    if (!isDuplicateOk(typeRes)) return typeRes;
    await syncEnumField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fieldCode: typeShort,
      entityTypeLabel: entity === "deal" ? "DEAL" : "LEAD",
    });

    // Promo names change every month, so this is a plain multi-value string field, not enumeration.
    const nameRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID: "string",
        FIELD_NAME: nameShort,
        XML_ID: nameShort,
        MULTIPLE: "Y",
        MANDATORY: "N",
        SHOW_FILTER: "Y",
        SHOW_IN_LIST: "Y",
        EDIT_IN_LIST: "Y",
        EDIT_FORM_LABEL: "Акция",
        LIST_COLUMN_LABEL: "Акция",
        SETTINGS: {},
      },
    });
    if (!isDuplicateOk(nameRes)) return nameRes;
  }

  return { ok: true };
}

export function catalogFacets(promotions: Promotion[]): { cities: string[]; brands: string[]; types: string[] } {
  const cities = new Set<string>();
  const brands = new Set<string>();
  const types = new Set<string>();
  for (const p of promotions) {
    for (const c of p.cities) if (c !== "Все") cities.add(c);
    if (p.brand) brands.add(p.brand);
    if (p.type) types.add(p.type);
  }
  return {
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b, "ru")),
    brands: Array.from(brands).sort((a, b) => a.localeCompare(b, "ru")),
    types: Array.from(types).sort((a, b) => a.localeCompare(b, "ru")),
  };
}
