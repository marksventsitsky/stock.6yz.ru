import "./runtime/net.js";
import express from "express";
import { z } from "zod";
import { openDb } from "./storage/db.js";
import {
  addAdminUser,
  addManualDirectoryEntry,
  deletePromotion,
  getPortalAuth,
  getSelection,
  getSetting,
  isAdminUserAllowed,
  listAdminUsers,
  listDirectory,
  listPromotions,
  removeAdminUser,
  removeDirectoryEntry,
  replaceDirectory,
  setSetting,
  upsertPortalAuth,
  upsertPromotion,
  upsertSelection,
} from "./storage/repo.js";
import { PromotionSchema, SelectionSchema, promoIsActiveToday, selectionToJson } from "./domain/promo.js";
import { renderPromoWidgetPage } from "./web/promoWidgetPage.js";
import { renderAdminPage } from "./web/adminPage.js";
import { setupPromoFields, catalogFacets, type FieldCodes } from "./b24/setup.js";
import { resolveEnumIds, ensureEnumHasValues } from "./b24/enumSync.js";
import { checkIsAdmin, searchPortalUsers } from "./b24/adminAuth.js";
import { discoverLists, fetchListElements } from "./b24/bitrixLists.js";
import { exchangeCodeForToken } from "./b24/oauth.js";
import { callB24 } from "./b24/rest.js";

const PORT = Number(process.env.PORT || 8788);
const DB_PATH = process.env.DB_PATH || "data.sqlite";
const API_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const SETUP_SECRET = process.env.SETUP_SECRET || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

const FIELD_CODES: FieldCodes = {
  jsonField: process.env.PROMO_JSON_FIELD || "UF_CRM_PROMO_JSON",
  cityField: process.env.PROMO_CITY_FIELD || "UF_CRM_PROMO_CITY",
  brandField: process.env.PROMO_BRAND_FIELD || "UF_CRM_PROMO_BRAND",
  typeField: process.env.PROMO_TYPE_FIELD || "UF_CRM_PROMO_TYPE",
  nameField: process.env.PROMO_NAME_FIELD || "UF_CRM_PROMO_NAME",
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const db = openDb(DB_PATH);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (code) {
    const domainHint = typeof req.query.domain === "string" ? req.query.domain : undefined;
    const result = await exchangeCodeForToken(db, { code, serverDomainHint: domainHint });
    if (!result.ok) return res.status(400).send(`OAuth error: ${result.error}`);
    return res.status(200).send(`OK (saved tokens for member_id=${result.memberId}). Now call POST /api/b24/setup.`);
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(
    [
      "b24-stock-promo service",
      "",
      "Health: /health",
      "Dev preview: /dev/field-preview",
      "Promo tab handler: /b24/promo-tab",
      "Admin panel: /b24/admin",
      "Setup: POST /api/b24/setup",
    ].join("\n"),
  );
});

function captureAuthFromRequest(body: Record<string, unknown>) {
  const domain = String(body?.DOMAIN ?? "");
  const memberId = String(body?.member_id ?? body?.memberId ?? "");
  const authId = String(body?.AUTH_ID ?? "");
  const refreshId = body?.REFRESH_ID ? String(body.REFRESH_ID) : null;
  if (memberId && domain && authId) {
    upsertPortalAuth(db, { memberId, domain, accessToken: authId, refreshToken: refreshId, expiresAtMs: null });
  }
  return { domain, memberId, authId, refreshId };
}

function parsePlacementOptions(req: express.Request): Record<string, unknown> {
  const raw = req.body?.PLACEMENT_OPTIONS ?? req.query?.PLACEMENT_OPTIONS;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

const RESTRICTED_PIPELINE_HTML = `<!doctype html>
<html lang="ru"><body style="font:14px sans-serif;padding:16px;color:#6b7280;">
Вкладка «Акции» пока доступна только для сделок в воронке «Продажи».
</body></html>`;

// Bitrix24 CRM_DEAL_DETAIL_TAB placement handler: the "Акции" tab.
// Deals only for now, and only within the "Продажи" pipeline (CATEGORY_ID 0).
app.all("/b24/promo-tab", async (req, res) => {
  const merged = { ...req.query, ...req.body } as Record<string, unknown>;
  const { domain, memberId, authId, refreshId } = captureAuthFromRequest(merged);
  const lang = String(merged.LANG ?? "ru");
  const placement = String(merged.PLACEMENT ?? "CRM_DEAL_DETAIL_TAB");
  const entityType: "DEAL" | "LEAD" = placement.includes("LEAD") ? "LEAD" : "DEAL";

  const placementOptions = parsePlacementOptions(req);
  const entityId =
    Number(placementOptions.ID ?? placementOptions.ENTITY_VALUE_ID ?? placementOptions.ENTITY_ID ?? 0) || 0;

  if (entityType === "DEAL" && entityId && domain && authId) {
    const dealRes = await callB24<{ CATEGORY_ID?: string }>(db, {
      domain,
      memberId,
      accessToken: authId,
      method: "crm.deal.get",
      body: { id: entityId },
    });
    const categoryId = dealRes.ok ? Number(dealRes.result.CATEGORY_ID ?? 0) : 0;
    if (categoryId !== 0) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(RESTRICTED_PIPELINE_HTML);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const catalog = listPromotions(db).filter((p) => promoIsActiveToday(p, today));
  const initialSelection = memberId && entityId ? (getSelection(db, memberId, entityType, entityId) ?? []) : [];

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderPromoWidgetPage(
      {
        domain,
        lang,
        entityType,
        entityId,
        authId,
        refreshId: refreshId ?? undefined,
        memberId,
        catalog,
        initialSelection,
      },
      API_BASE_URL,
    ),
  );
});

// Install handler: Bitrix24 POSTs here right after "Установить" on the local-app form.
// Captures the portal's member_id/domain/tokens, then tells Bitrix the install is done.
app.post("/b24/install", (req, res) => {
  const merged = { ...req.query, ...req.body } as Record<string, unknown>;
  captureAuthFromRequest(merged);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/>
<script src="//api.bitrix24.com/api/v1/dev/"></script>
</head><body style="font:14px sans-serif;padding:16px;">
<div id="msg">Устанавливаем…</div>
<script>
  BX24.init(function () {
    BX24.installFinish();
    document.getElementById("msg").textContent = "Готово. Можно закрыть это окно.";
  });
</script>
</body></html>`);
});

// Placement/menu handler for the marketing admin panel (list/edit/delete the promo catalog).
app.all("/b24/admin", (req, res) => {
  const merged = { ...req.query, ...req.body } as Record<string, unknown>;
  const { domain, memberId, authId } = captureAuthFromRequest(merged);
  const lang = String(merged.LANG ?? "ru");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderAdminPage({ domain, lang, memberId, authId }, API_BASE_URL));
});

app.get("/dev/field-preview", (req, res) => {
  const entityType = String(req.query.entityType || "DEAL") === "LEAD" ? "LEAD" : "DEAL";
  const entityId = Number(req.query.entityId || 123);

  const placement = entityType === "LEAD" ? "CRM_LEAD_DETAIL_TAB" : "CRM_DEAL_DETAIL_TAB";
  const placementOptions = { ID: entityId };
  const q = new URLSearchParams({
    DOMAIN: "dev.local",
    LANG: "ru",
    PLACEMENT: placement,
    AUTH_ID: "dev-token",
    member_id: "dev-member",
    PLACEMENT_OPTIONS: JSON.stringify(placementOptions),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/><title>Dev preview</title>
<style>body{font:14px sans-serif;margin:16px;}iframe{width:100%;height:750px;border:1px solid #e5e7eb;border-radius:10px;}</style>
</head><body>
<h2>Предпросмотр вкладки «Акции»</h2>
<div class="muted">entityType=${entityType}, entityId=${entityId}</div>
<iframe src="/b24/promo-tab?${q.toString()}"></iframe>
</body></html>`);
});

const SaveSelectionSchema = z.object({
  memberId: z.string().min(1),
  domain: z.string().optional().default(""),
  accessToken: z.string().optional().default(""),
  entityType: z.enum(["DEAL", "LEAD"]),
  entityId: z.number().int().positive(),
  selection: SelectionSchema,
});

// Saves the widget's own JSON snapshot AND writes the same choices into plain
// enumeration/string sibling fields, so standard CRM reports/filters can use them.
app.post("/api/b24/save-selection", async (req, res) => {
  try {
    const body = SaveSelectionSchema.parse(req.body);
    const stored = getPortalAuth(db, body.memberId);
    const domain = body.domain || stored?.domain || "";
    const accessToken = body.accessToken || stored?.accessToken || "";
    if (!domain) return res.status(400).json({ error: "missing_domain" });
    if (!accessToken) return res.status(400).json({ error: "missing_access_token" });

    upsertPortalAuth(db, { memberId: body.memberId, domain, accessToken, refreshToken: null, expiresAtMs: null });
    upsertSelection(db, {
      memberId: body.memberId,
      entityType: body.entityType,
      entityId: body.entityId,
      selectionJson: selectionToJson(body.selection),
    });

    const entity = body.entityType === "DEAL" ? "deal" : "lead";
    const cities = body.selection.map((s) => s.city).filter(Boolean);
    const brands = body.selection.map((s) => s.brand).filter(Boolean);
    const types = body.selection.map((s) => s.type).filter(Boolean);
    const names = Array.from(new Set(body.selection.map((s) => s.title).filter(Boolean)));

    const [cityIds, brandIds, typeIds] = await Promise.all([
      resolveEnumIds(db, {
        domain,
        memberId: body.memberId,
        accessToken,
        entity,
        fieldCode: FIELD_CODES.cityField.replace(/^UF_CRM_/, ""),
        entityTypeLabel: body.entityType,
        values: cities,
      }),
      resolveEnumIds(db, {
        domain,
        memberId: body.memberId,
        accessToken,
        entity,
        fieldCode: FIELD_CODES.brandField.replace(/^UF_CRM_/, ""),
        entityTypeLabel: body.entityType,
        values: brands,
      }),
      resolveEnumIds(db, {
        domain,
        memberId: body.memberId,
        accessToken,
        entity,
        fieldCode: FIELD_CODES.typeField.replace(/^UF_CRM_/, ""),
        entityTypeLabel: body.entityType,
        values: types,
      }),
    ]);

    const updateMethod = body.entityType === "DEAL" ? "crm.deal.update" : "crm.lead.update";
    const r = await callB24<boolean>(db, {
      domain,
      memberId: body.memberId,
      accessToken,
      method: updateMethod,
      body: {
        id: body.entityId,
        fields: {
          [FIELD_CODES.jsonField]: selectionToJson(body.selection),
          [FIELD_CODES.cityField]: cityIds,
          [FIELD_CODES.brandField]: brandIds,
          [FIELD_CODES.typeField]: typeIds,
          [FIELD_CODES.nameField]: names,
        },
      },
    });
    if (!r.ok) return res.status(400).json({ error: r.error, errorDescription: r.errorDescription });

    return res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "bad_request";
    return res.status(400).json({ error: msg });
  }
});

app.get("/api/b24/load-selection", (req, res) => {
  const memberId = String(req.query.memberId || "");
  const entityType = String(req.query.entityType || "") as "DEAL" | "LEAD";
  const entityId = Number(req.query.entityId || 0);
  if (!memberId || (entityType !== "DEAL" && entityType !== "LEAD") || !entityId) {
    return res.status(400).json({ error: "bad_request" });
  }
  const selection = getSelection(db, memberId, entityType, entityId) ?? [];
  return res.json({ ok: true, selection });
});

const AuthBodySchema = z.object({
  memberId: z.string().min(1),
  domain: z.string().optional().default(""),
  accessToken: z.string().optional().default(""),
  userId: z.number().optional().default(0),
});

type AdminAuth = {
  ok: boolean; // allowed to use the catalog CRUD (portal admin OR on the allowlist)
  isPortalAdmin: boolean; // allowed to manage the allowlist itself
  domain: string;
  memberId: string;
  accessToken: string;
  userId: number;
};

async function resolveAdminAuth(req: express.Request): Promise<AdminAuth> {
  const parsed = AuthBodySchema.safeParse(req.body);
  const memberId = parsed.success ? parsed.data.memberId : "";
  const stored = memberId ? getPortalAuth(db, memberId) : null;
  const domain = (parsed.success && parsed.data.domain) || stored?.domain || "";
  const accessToken = (parsed.success && parsed.data.accessToken) || stored?.accessToken || "";
  const userId = parsed.success ? parsed.data.userId : 0;

  const secretHeader = String(req.header("x-admin-secret") || "");
  if (ADMIN_SECRET && secretHeader === ADMIN_SECRET) {
    return { ok: true, isPortalAdmin: true, domain, memberId, accessToken, userId };
  }
  const isPortalAdmin = await checkIsAdmin(db, { domain, memberId, accessToken });
  const isAllowedUser = !isPortalAdmin && userId > 0 && isAdminUserAllowed(db, memberId, userId);
  return { ok: isPortalAdmin || isAllowedUser, isPortalAdmin, domain, memberId, accessToken, userId };
}

app.post("/api/admin/whoami", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  return res.json({ ok: true, isAdmin: auth.ok, isPortalAdmin: auth.isPortalAdmin });
});

app.post("/api/admin/access/list", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  return res.json({ ok: true, items: listAdminUsers(db, auth.memberId) });
});

app.post("/api/admin/access/search", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  if (!auth.domain || !auth.accessToken) return res.status(400).json({ error: "missing_access_token" });
  const query = String(req.body?.query || "");
  const users = await searchPortalUsers(db, { domain: auth.domain, memberId: auth.memberId, accessToken: auth.accessToken, query });
  return res.json({ ok: true, users });
});

app.post("/api/admin/access/add", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  const userId = Number(req.body?.userId || 0);
  const name = String(req.body?.name || "");
  if (!userId) return res.status(400).json({ error: "missing_user_id" });
  addAdminUser(db, auth.memberId, userId, name);
  return res.json({ ok: true });
});

app.post("/api/admin/access/remove", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  const userId = Number(req.body?.userId || 0);
  if (!userId) return res.status(400).json({ error: "missing_user_id" });
  removeAdminUser(db, auth.memberId, userId);
  return res.json({ ok: true });
});

app.post("/api/admin/catalog", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.ok) return res.status(403).json({ error: "forbidden" });
  return res.json({ ok: true, items: listPromotions(db) });
});

app.post("/api/admin/catalog/upsert", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.ok) return res.status(403).json({ error: "forbidden" });
  try {
    const promo = PromotionSchema.parse(req.body?.promotion);
    upsertPromotion(db, promo);
    return res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "bad_request";
    return res.status(400).json({ error: msg });
  }
});

app.post("/api/admin/catalog/delete", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.ok) return res.status(403).json({ error: "forbidden" });
  const id = String(req.body?.id || "");
  if (!id) return res.status(400).json({ error: "missing_id" });
  deletePromotion(db, id);
  return res.json({ ok: true });
});

// Grows the Bitrix enumeration fields (direction/brand/type) with any new catalog values,
// so newly added promotions are immediately selectable as standard-field options too.
app.post("/api/admin/resync-fields", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.ok) return res.status(403).json({ error: "forbidden" });
  if (!auth.domain || !auth.accessToken) return res.status(400).json({ error: "missing_access_token" });

  const facets = catalogFacets(listPromotions(db));
  const result: Record<string, unknown> = {};
  for (const entity of ["deal", "lead"] as const) {
    const entityTypeLabel = entity === "deal" ? "DEAL" : "LEAD";
    const cityRes = await ensureEnumHasValues(db, {
      domain: auth.domain,
      memberId: auth.memberId,
      accessToken: auth.accessToken,
      entity,
      fieldCode: FIELD_CODES.cityField.replace(/^UF_CRM_/, ""),
      entityTypeLabel,
      requiredValues: facets.cities,
    });
    const brandRes = await ensureEnumHasValues(db, {
      domain: auth.domain,
      memberId: auth.memberId,
      accessToken: auth.accessToken,
      entity,
      fieldCode: FIELD_CODES.brandField.replace(/^UF_CRM_/, ""),
      entityTypeLabel,
      requiredValues: facets.brands,
    });
    const typeRes = await ensureEnumHasValues(db, {
      domain: auth.domain,
      memberId: auth.memberId,
      accessToken: auth.accessToken,
      entity,
      fieldCode: FIELD_CODES.typeField.replace(/^UF_CRM_/, ""),
      entityTypeLabel,
      requiredValues: facets.types,
    });
    result[entity] = { city: cityRes.ok, brand: brandRes.ok, type: typeRes.ok };
  }
  return res.json({ ok: true, result });
});

const DIRECTORY_KINDS = new Set(["city", "direction", "placement"]);
function directorySettingKeys(kind: string) {
  return { typeKey: `${kind}_list_iblock_type_id`, idKey: `${kind}_list_iblock_id` };
}

// Enumerates the portal's Bitrix24 "Списки" (universal lists) so an admin can pick which one
// holds a canonical directory (cities, sales directions, ...).
app.post("/api/admin/directory/discover", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  if (!auth.domain || !auth.accessToken) return res.status(400).json({ error: "missing_access_token" });
  const lists = await discoverLists(db, { domain: auth.domain, memberId: auth.memberId, accessToken: auth.accessToken });
  return res.json({ ok: true, lists });
});

app.post("/api/admin/directory/config", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  const kind = String(req.body?.kind || "");
  if (!DIRECTORY_KINDS.has(kind)) return res.status(400).json({ error: "invalid_kind" });
  const { typeKey, idKey } = directorySettingKeys(kind);
  return res.json({
    ok: true,
    iblockTypeId: getSetting(db, auth.memberId, typeKey),
    iblockId: getSetting(db, auth.memberId, idKey),
    entries: listDirectory(db, auth.memberId, kind as "city" | "direction" | "placement"),
  });
});

// Manually-managed directories (no Bitrix "Списки" backing) — e.g. Размещения.
app.post("/api/admin/directory/add-manual", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  const kind = String(req.body?.kind || "");
  const name = String(req.body?.name || "").trim();
  if (!DIRECTORY_KINDS.has(kind)) return res.status(400).json({ error: "invalid_kind" });
  if (!name) return res.status(400).json({ error: "missing_name" });
  addManualDirectoryEntry(db, auth.memberId, kind as "city" | "direction" | "placement", name);
  return res.json({ ok: true });
});

app.post("/api/admin/directory/remove-manual", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  const kind = String(req.body?.kind || "");
  const externalId = String(req.body?.externalId || "");
  if (!DIRECTORY_KINDS.has(kind)) return res.status(400).json({ error: "invalid_kind" });
  if (!externalId) return res.status(400).json({ error: "missing_external_id" });
  removeDirectoryEntry(db, auth.memberId, kind as "city" | "direction" | "placement", externalId);
  return res.json({ ok: true });
});

// Pulls every element from the chosen "Списки" iblock into our local directory mirror.
app.post("/api/admin/directory/sync", async (req, res) => {
  const auth = await resolveAdminAuth(req);
  if (!auth.isPortalAdmin) return res.status(403).json({ error: "forbidden" });
  if (!auth.domain || !auth.accessToken) return res.status(400).json({ error: "missing_access_token" });
  const kind = String(req.body?.kind || "");
  if (!DIRECTORY_KINDS.has(kind)) return res.status(400).json({ error: "invalid_kind" });
  const iblockTypeId = String(req.body?.iblockTypeId || "");
  const iblockId = String(req.body?.iblockId || "");
  if (!iblockTypeId || !iblockId) return res.status(400).json({ error: "missing_iblock" });

  const elements = await fetchListElements(db, {
    domain: auth.domain,
    memberId: auth.memberId,
    accessToken: auth.accessToken,
    iblockTypeId,
    iblockId,
  });
  replaceDirectory(
    db,
    auth.memberId,
    kind as "city" | "direction" | "placement",
    elements.map((e, i) => ({ externalId: e.ID, name: e.NAME, sort: Number(e.SORT || i) })),
  );
  const { typeKey, idKey } = directorySettingKeys(kind);
  setSetting(db, auth.memberId, typeKey, iblockTypeId);
  setSetting(db, auth.memberId, idKey, iblockId);
  return res.json({ ok: true, count: elements.length });
});

const SetupBodySchema = z.object({
  memberId: z.string().min(1),
  domain: z.string().min(1),
  accessToken: z.string().min(1),
});

app.post("/api/b24/setup", async (req, res) => {
  const provided = String(req.header("x-setup-secret") || "");
  if (!SETUP_SECRET || provided !== SETUP_SECRET) return res.status(403).json({ error: "forbidden" });
  try {
    const body = SetupBodySchema.parse(req.body);
    const existing = getPortalAuth(db, body.memberId);
    const accessToken = existing?.accessToken ?? body.accessToken;
    upsertPortalAuth(db, {
      memberId: body.memberId,
      domain: body.domain,
      accessToken,
      refreshToken: null,
      expiresAtMs: null,
    });

    const facets = catalogFacets(listPromotions(db));
    const result = await setupPromoFields(db, {
      domain: body.domain,
      memberId: body.memberId,
      accessToken,
      publicBaseUrl: API_BASE_URL,
      codes: FIELD_CODES,
      cities: facets.cities,
      brands: facets.brands,
      types: facets.types,
    });
    if (!result.ok) return res.status(400).json({ error: result.error, errorDescription: result.errorDescription });
    return res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "bad_request";
    return res.status(400).json({ error: msg });
  }
});

app.get("/b24/oauth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const domainHint = typeof req.query.domain === "string" ? req.query.domain : undefined;
  if (!code) return res.status(400).send("Missing code");
  const result = await exchangeCodeForToken(db, { code, serverDomainHint: domainHint });
  if (!result.ok) return res.status(400).send(`OAuth error: ${result.error}`);
  return res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`[b24-stock-promo] listening on :${PORT}`);
});
