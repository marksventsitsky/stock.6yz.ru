import type { Promotion } from "../domain/promo.js";
import type { Selection } from "../domain/promo.js";
import { DESIGN_SYSTEM_CSS } from "./designSystem.js";

export type PromoWidgetContext = {
  domain: string;
  lang: string;
  mode: string; // "edit" | "view"
  entityType: "DEAL" | "LEAD";
  entityId: number;
  authId: string;
  refreshId?: string;
  memberId: string;
  catalog: Promotion[];
  initialSelection: Selection;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderPromoWidgetPage(ctx: PromoWidgetContext, apiBaseUrl: string): string {
  const safeJson = (obj: unknown) => JSON.stringify(obj).replaceAll("</script>", "<\\/script>");

  const bootstrapJson = safeJson({
    apiBaseUrl,
    domain: ctx.domain,
    lang: ctx.lang,
    mode: ctx.mode,
    memberId: ctx.memberId,
    authId: ctx.authId,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    catalog: ctx.catalog,
    initialSelection: ctx.initialSelection,
    today: new Date().toISOString().slice(0, 10),
  });

  return `<!doctype html>
<html lang="${escapeHtml(ctx.lang || "ru")}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="//api.bitrix24.com/api/v1/dev/"></script>
    <style>
      ${DESIGN_SYSTEM_CSS}
      body { margin: 0; background: transparent; }
      .wrap { padding: 8px 2px; }
      .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
      .promo-card { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; }
      .promo-card + .promo-card { border-top: 1px solid #eef1f3; }
      .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    </style>
  </head>
  <body>
    <div class="wrap"><div id="app">Загрузка…</div></div>
    <script id="bootstrap-json" type="application/json">${bootstrapJson}</script>
    <script>
      (function () {
        const appEl = document.getElementById("app");

        function escapeHtml(s) {
          return String(s ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
        }
        function showFatal(title, detail) {
          appEl.innerHTML = '<div class="ds-card" style="padding:12px;border-color:#f3c9c9;background:var(--danger-bg);color:var(--danger-text)"><b>' + escapeHtml(title) + '</b><pre style="white-space:pre-wrap;margin-top:8px;font-size:11px">' + escapeHtml(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)) + '</pre></div>';
        }
        window.addEventListener("error", (ev) => { try { showFatal("JS error", (ev.error && ev.error.stack) || String(ev.message || ev)); } catch {} });
        window.addEventListener("unhandledrejection", (ev) => { try { showFatal("Unhandled rejection", (ev.reason && ev.reason.stack) || String(ev.reason)); } catch {} });

        function readJsonScript(id) {
          const el = document.getElementById(id);
          return el ? JSON.parse(el.textContent || "null") : null;
        }

        const BOOTSTRAP = readJsonScript("bootstrap-json");
        const CATALOG = BOOTSTRAP.catalog || [];
        const TODAY = BOOTSTRAP.today;
        const entityType = BOOTSTRAP.entityType;
        const entityId = BOOTSTRAP.entityId;
        const MODE = BOOTSTRAP.mode || "edit";
        const canEdit = MODE !== "view";

        // Stage the current selection JSON into the Bitrix field, so it's saved when the user
        // saves the deal card (this is the primary persistence path for an embedded field).
        function setFieldValue() {
          const value = JSON.stringify(selection);
          try {
            if (window.BX24 && BX24.placement && BX24.placement.call) {
              BX24.placement.call("setValue", value);
            }
          } catch {}
        }

        function isActive(p) {
          if (!p.active) return false;
          if (p.periodEnd && p.periodEnd < TODAY) return false;
          if (p.periodStart && p.periodStart > TODAY) return false;
          return true;
        }
        function matchesCity(p, city) {
          if (!city) return true;
          if (p.cities.indexOf("Все") !== -1) return true;
          return p.cities.indexOf(city) !== -1;
        }

        function distinctCities() {
          const set = new Set();
          CATALOG.forEach((p) => { if (isActive(p)) p.cities.forEach((c) => { if (c !== "Все") set.add(c); }); });
          return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
        }
        function typesForCity(city) {
          const set = new Set();
          CATALOG.forEach((p) => { if (isActive(p) && matchesCity(p, city)) set.add(p.type || "Без типа"); });
          return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
        }
        function promosForCityType(city, type) {
          return CATALOG.filter((p) => isActive(p) && matchesCity(p, city) && (p.type || "Без типа") === type);
        }

        let selection = Array.isArray(BOOTSTRAP.initialSelection) ? BOOTSTRAP.initialSelection.slice() : [];
        let draftCity = "", draftType = "", draftPromoId = "";
        let statusKind = "", statusText = "";

        function setStatus(kind, text) { statusKind = kind; statusText = text || ""; render(); }

        function addSelected() {
          if (!draftPromoId) return;
          const promo = CATALOG.find((p) => p.id === draftPromoId);
          if (!promo) return;
          if (selection.some((s) => s.promoId === promo.id && s.city === draftCity)) return;
          selection = selection.concat([{
            promoId: promo.id, brand: promo.brand, city: draftCity, type: promo.type,
            title: promo.title, selectedAt: new Date().toISOString(),
          }]);
          draftPromoId = "";
          setFieldValue();
          render();
        }
        function removeSelected(idx) { selection = selection.filter((_, i) => i !== idx); setFieldValue(); render(); }

        let saving = false;

        async function saveToCrm() {
          if (!entityId || !BOOTSTRAP.apiBaseUrl) return;
          saving = true;
          setStatus("muted", "Сохранение…");
          try {
            const resp = await fetch(BOOTSTRAP.apiBaseUrl + "/api/b24/save-selection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                memberId: BOOTSTRAP.memberId, domain: BOOTSTRAP.domain, accessToken: BOOTSTRAP.authId,
                entityType, entityId, selection,
              }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error((data && data.error) || "save_failed");
            saving = false;
            setStatus("ok", "Сохранено: JSON-снапшот и стандартные поля обновлены");
          } catch (e) {
            saving = false;
            setStatus("error", "Ошибка сохранения: " + (e && e.message ? e.message : String(e)));
          }
        }

        function render() {
          const cities = distinctCities();
          const types = draftCity ? typesForCity(draftCity) : [];
          const promos = draftCity && draftType ? promosForCityType(draftCity, draftType) : [];

          const cardsHtml = selection.length
            ? selection.map((s, i) => \`
              <div class="promo-card">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--text)">\${escapeHtml(s.title)}</div>
                  <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:5px">
                    <span class="ds-chip ds-chip-accent">\${escapeHtml(s.city || "—")}</span>
                    <span class="ds-chip ds-chip-neutral">\${escapeHtml(s.brand || "—")}</span>
                    <span class="ds-chip ds-chip-neutral">\${escapeHtml(s.type || "—")}</span>
                  </div>
                </div>
                \${canEdit ? '<button type="button" data-act="remove" data-idx="' + i + '" class="ds-btn-danger-text">Удалить</button>' : ""}
              </div>\`).join("")
            : '<div style="padding:20px;text-align:center;color:var(--text-muted);border:1px dashed var(--border-input);border-radius:8px">Пока не выбрано ни одной акции</div>';

          const statusHtml = statusText
            ? '<div style="margin-top:10px;font-size:12.5px;color:' + (statusKind === "error" ? "var(--danger-text)" : statusKind === "ok" ? "var(--success)" : "var(--text-secondary)") + '">' + escapeHtml(statusText) + "</div>"
            : "";

          const addPanelHtml = canEdit ? \`
            <div class="ds-card" style="padding:14px;margin-bottom:12px">
              <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Добавить акцию</div>
              <div class="grid3">
                <div>
                  <div class="ds-label">Направление (город)</div>
                  <select id="citySel" class="ds-select">
                    <option value="">— выберите —</option>
                    \${cities.map((c) => \`<option value="\${escapeHtml(c)}" \${c === draftCity ? "selected" : ""}>\${escapeHtml(c)}</option>\`).join("")}
                  </select>
                </div>
                <div>
                  <div class="ds-label">Тип акции</div>
                  <select id="typeSel" class="ds-select" \${draftCity ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${types.map((t) => \`<option value="\${escapeHtml(t)}" \${t === draftType ? "selected" : ""}>\${escapeHtml(t)}</option>\`).join("")}
                  </select>
                </div>
                <div>
                  <div class="ds-label">Акция</div>
                  <select id="promoSel" class="ds-select" \${draftType ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${promos.map((p) => \`<option value="\${escapeHtml(p.id)}" \${p.id === draftPromoId ? "selected" : ""}>\${escapeHtml(p.title)}</option>\`).join("")}
                  </select>
                </div>
              </div>
              <button id="addBtn" type="button" class="ds-btn ds-btn-outline" style="margin-top:10px" \${draftPromoId ? "" : "disabled"}>+ Добавить в список</button>
            </div>\` : "";

          const saveBarHtml = canEdit ? \`
            <div style="display:flex;align-items:center;gap:12px">
              <button id="saveBtn" type="button" class="ds-btn ds-btn-primary" \${saving ? "disabled" : ""}>\${saving ? "Сохранение…" : "Записать в поля для аналитики"}</button>
              <span style="font-size:11px;color:var(--text-muted)">Сам выбор сохранится при сохранении сделки; кнопка сразу заполняет поля направление/бренд/тип/акция для фильтров.</span>
              \${statusHtml}
            </div>\` : statusHtml;

          appEl.innerHTML = \`
            <div class="ds-card" style="margin-bottom:12px;overflow:hidden">\${cardsHtml}</div>
            \${addPanelHtml}
            \${saveBarHtml}
          \`;

          const citySel = document.getElementById("citySel");
          if (citySel) citySel.addEventListener("change", (e) => { draftCity = e.target.value; draftType = ""; draftPromoId = ""; render(); });
          const typeSel = document.getElementById("typeSel");
          if (typeSel) typeSel.addEventListener("change", (e) => { draftType = e.target.value; draftPromoId = ""; render(); });
          const promoSel = document.getElementById("promoSel");
          if (promoSel) promoSel.addEventListener("change", (e) => { draftPromoId = e.target.value; render(); });
          const addBtn = document.getElementById("addBtn");
          if (addBtn) addBtn.addEventListener("click", addSelected);
          const saveBtn = document.getElementById("saveBtn");
          if (saveBtn) saveBtn.addEventListener("click", saveToCrm);
          appEl.querySelectorAll("button[data-act='remove']").forEach((el) => {
            el.addEventListener("click", (e) => removeSelected(Number(e.currentTarget.getAttribute("data-idx"))));
          });
        }

        render();
        setFieldValue();
      })();
    </script>
  </body>
</html>`;
}
