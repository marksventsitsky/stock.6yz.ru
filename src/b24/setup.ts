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

const DUPLICATE_ERRORS = new Set(["ERROR_FIELD_NAME", "ERROR_DUPLICATE", "ERROR_USER_TYPE_ID"]);

function isDuplicateOk(res: { ok: true } | { ok: false; error: string; errorDescription?: string }): boolean {
  if (res.ok) return true;
  if (DUPLICATE_ERRORS.has(res.error)) return true;
  return String(res.errorDescription ?? "").toLowerCase().includes("already binded");
}

function placementBindMethod(): string {
  return "placement.bind";
}

/**
 * Shows the promo picker as a tab on the deal/lead detail card (`placement.bind`).
 * We deliberately don't use a custom USERFIELD_TYPE widget: registering a brand-new field
 * TYPE (`userfieldtype.add`) needs a higher-privilege scope than plain field/placement
 * registration and was rejected (`insufficient_scope`) on this portal even with `crm`+`user`.
 */
async function ensurePlacement(
  db: Db,
  params: { domain: string; memberId: string; accessToken: string; placement: string; handlerUrl: string },
) {
  return callB24<unknown>(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    method: placementBindMethod(),
    body: {
      PLACEMENT: params.placement,
      HANDLER: params.handlerUrl,
      TITLE: "Акции",
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
  const handlerUrl = `${params.publicBaseUrl.replace(/\/+$/, "")}/b24/promo-tab`;

  const dealTab = await ensurePlacement(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    placement: "CRM_DEAL_DETAIL_TAB",
    handlerUrl,
  });
  if (!isDuplicateOk(dealTab)) return dealTab;

  const leadTab = await ensurePlacement(db, {
    domain: params.domain,
    memberId: params.memberId,
    accessToken: params.accessToken,
    placement: "CRM_LEAD_DETAIL_TAB",
    handlerUrl,
  });
  if (!isDuplicateOk(leadTab)) return leadTab;

  // Bitrix uses the same UF_CRM_ namespace for every CRM entity, so one set of short field
  // names produces identical field codes on both the deal and the lead.
  const codes = params.codes;
  const shortJsonName = codes.jsonField.replace(/^UF_CRM_/, "");
  const cityShort = codes.cityField.replace(/^UF_CRM_/, "");
  const brandShort = codes.brandField.replace(/^UF_CRM_/, "");
  const typeShort = codes.typeField.replace(/^UF_CRM_/, "");
  const nameShort = codes.nameField.replace(/^UF_CRM_/, "");

  for (const entity of ["deal", "lead"] as const) {
    // 1) Plain (non-custom-type) string field: stores the full JSON snapshot for audit/history.
    //    Edited only through our own "Акции" tab (placement above), not inline on the card.
    const jsonRes = await ensureField(db, {
      domain: params.domain,
      memberId: params.memberId,
      accessToken: params.accessToken,
      entity,
      fields: {
        USER_TYPE_ID: "string",
        FIELD_NAME: shortJsonName,
        XML_ID: shortJsonName,
        MANDATORY: "N",
        SHOW_IN_LIST: "N",
        EDIT_IN_LIST: "N",
        EDIT_FORM_LABEL: "Выбор акции (JSON)",
        LIST_COLUMN_LABEL: "Выбор акции (JSON)",
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
