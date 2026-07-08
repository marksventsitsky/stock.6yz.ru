import type { Promotion } from "../domain/promo.js";

export type PromoWidgetContext = {
  domain: string;
  lang: string;
  placement: string;
  placementOptions: Record<string, unknown>;
  authId: string;
  refreshId?: string;
  memberId: string;
  catalog: Promotion[];
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

  const placementOptionsJson = safeJson(ctx.placementOptions ?? {});
  const bootstrapJson = safeJson({
    apiBaseUrl,
    domain: ctx.domain,
    lang: ctx.lang,
    memberId: ctx.memberId,
    authId: ctx.authId,
    placement: ctx.placement,
    placementOptions: ctx.placementOptions ?? {},
    catalog: ctx.catalog,
    today: new Date().toISOString().slice(0, 10),
  });

  return `<!doctype html>
<html lang="${escapeHtml(ctx.lang || "ru")}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="//api.bitrix24.com/api/v1/dev/"></script>
    <style>
      :root { color-scheme: light; }
      body { margin:0; font: 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; background:#fff; color:#111827; }
      .wrap { padding: 10px 12px; }
      .bar { display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap; }
      .bar .spacer { flex: 1; }
      button { border: 1px solid #d1d5db; background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }
      button.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
      button:disabled { opacity: .6; cursor: not-allowed; }
      select { width:100%; border:1px solid #d1d5db; border-radius:8px; padding:6px 8px; background:#fff; }
      .grid3 { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; align-items:end; }
      .panel { border:1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
      .panel h3 { margin: 0 0 8px 0; font-size: 13px; }
      label.small { font-size:12px; color:#374151; display:block; }
      .muted { color:#6b7280; font-size:12px; }
      .chips { display:flex; flex-direction:column; gap:6px; margin-bottom: 10px; }
      .chip { display:flex; align-items:center; gap:8px; border:1px solid #e5e7eb; border-radius:10px; padding:8px 10px; }
      .chip .meta { color:#6b7280; font-size:11px; }
      .chip .title { font-weight:600; }
      .chip .spacer { flex:1; }
      .error { color:#b91c1c; margin-top:8px; }
      .ok { color:#166534; margin-top:8px; }
    </style>
  </head>
  <body>
    <div class="wrap"><div id="app"></div></div>
    <script id="bootstrap-json" type="application/json">${bootstrapJson}</script>
    <script id="placement-options-json" type="application/json">${placementOptionsJson}</script>
    <script>
      (function() {
        const appEl = document.getElementById("app");

        function escapeHtml(s) {
          return String(s ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
        }
        function showFatal(title, detail) {
          appEl.innerHTML = '<div class="error"><b>' + escapeHtml(title) + '</b><pre style="white-space:pre-wrap;margin:8px 0 0 0;">' +
            escapeHtml(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)) + '</pre></div>';
        }
        window.addEventListener("error", (ev) => { try { showFatal("JS error", (ev.error && ev.error.stack) || String(ev.message || ev)); } catch {} });
        window.addEventListener("unhandledrejection", (ev) => { try { showFatal("Unhandled rejection", (ev.reason && ev.reason.stack) || String(ev.reason)); } catch {} });

        function readJsonScript(id) {
          const el = document.getElementById(id);
          return el ? JSON.parse(el.textContent || "null") : null;
        }

        const BOOTSTRAP = readJsonScript("bootstrap-json");
        const PLACEMENT_OPTIONS = readJsonScript("placement-options-json") || {};
        const CATALOG = BOOTSTRAP.catalog || [];
        const TODAY = BOOTSTRAP.today;

        function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }

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

        function parseSelection(value) {
          if (!value) return [];
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) return [];
            return parsed;
          } catch { return []; }
        }

        const mode = String(PLACEMENT_OPTIONS.MODE || "view");
        const entityId = String(PLACEMENT_OPTIONS.ENTITY_ID || "");
        const entityType = entityId.indexOf("LEAD") !== -1 ? "LEAD" : "DEAL";
        const entityValueId = Number(PLACEMENT_OPTIONS.ENTITY_VALUE_ID || 0);
        const isExpanded = !!PLACEMENT_OPTIONS.__expanded;
        let selection = parseSelection(String(PLACEMENT_OPTIONS.VALUE || ""));

        let draftCity = "";
        let draftType = "";
        let draftPromoId = "";
        let statusKind = "";
        let statusText = "";

        function setStatus(kind, text) { statusKind = kind; statusText = text || ""; render(); }

        function setValueToB24() {
          const value = JSON.stringify(selection);
          if (window.BX24 && BX24.placement && BX24.placement.call) {
            BX24.placement.call("setValue", value);
          }
        }

        function addSelected() {
          if (!draftPromoId) return;
          const promo = CATALOG.find((p) => p.id === draftPromoId);
          if (!promo) return;
          if (selection.some((s) => s.promoId === promo.id && s.city === draftCity)) return;
          selection = selection.concat([{
            promoId: promo.id,
            brand: promo.brand,
            city: draftCity,
            type: promo.type,
            title: promo.title,
            selectedAt: new Date().toISOString(),
          }]);
          draftPromoId = "";
          setValueToB24();
          render();
        }
        function removeSelected(idx) {
          selection = selection.filter((_, i) => i !== idx);
          setValueToB24();
          render();
        }

        function openExpanded() {
          if (!window.BX24 || !BX24.openApplication) { setStatus("error", "BX24.openApplication недоступен"); return; }
          BX24.openApplication({
            bx24_width: 760,
            bx24_title: "Выбор акции",
            entityType,
            entityId: entityValueId,
            valueJson: JSON.stringify(selection),
            openedFrom: "userfield",
          }, function () {});
        }

        async function saveToCrm() {
          if (!entityValueId || !BOOTSTRAP.apiBaseUrl) return;
          setStatus("muted", "Сохранение…");
          try {
            const resp = await fetch(BOOTSTRAP.apiBaseUrl + "/api/b24/save-selection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                memberId: BOOTSTRAP.memberId,
                domain: BOOTSTRAP.domain,
                accessToken: BOOTSTRAP.authId,
                entityType,
                entityId: entityValueId,
                selection,
              }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error((data && data.error) || "save_failed");
            setStatus("ok", "Сохранено: JSON-поле и стандартные поля обновлены");
          } catch (e) {
            setStatus("error", "Ошибка сохранения: " + (e && e.message ? e.message : String(e)));
          }
        }

        function render() {
          const canEdit = mode === "edit";
          const cities = distinctCities();
          const types = draftCity ? typesForCity(draftCity) : [];
          const promos = draftCity && draftType ? promosForCityType(draftCity, draftType) : [];

          const chipsHtml = selection.length
            ? selection.map((s, i) => \`
              <div class="chip">
                <div>
                  <div class="title">\${escapeHtml(s.title)}</div>
                  <div class="meta">\${escapeHtml(s.city || "—")} • \${escapeHtml(s.brand || "—")} • \${escapeHtml(s.type || "—")}</div>
                </div>
                <div class="spacer"></div>
                \${canEdit ? '<button type="button" data-act="remove" data-idx="' + i + '">Удалить</button>' : ""}
              </div>\`).join("")
            : '<div class="muted">Пока не выбрано ни одной акции.</div>';

          const addPanelHtml = canEdit ? \`
            <div class="panel">
              <h3>Добавить акцию</h3>
              <div class="grid3">
                <label class="small">Направление (город)
                  <select id="citySel">
                    <option value="">— выберите —</option>
                    \${cities.map((c) => \`<option value="\${escapeHtml(c)}" \${c === draftCity ? "selected" : ""}>\${escapeHtml(c)}</option>\`).join("")}
                  </select>
                </label>
                <label class="small">Тип акции
                  <select id="typeSel" \${draftCity ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${types.map((t) => \`<option value="\${escapeHtml(t)}" \${t === draftType ? "selected" : ""}>\${escapeHtml(t)}</option>\`).join("")}
                  </select>
                </label>
                <label class="small">Акция
                  <select id="promoSel" \${draftType ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${promos.map((p) => \`<option value="\${escapeHtml(p.id)}" \${p.id === draftPromoId ? "selected" : ""}>\${escapeHtml(p.title)}</option>\`).join("")}
                  </select>
                </label>
              </div>
              <div style="margin-top:8px;">
                <button id="addBtn" class="primary" type="button" \${draftPromoId ? "" : "disabled"}>Добавить в список</button>
              </div>
            </div>\` : "";

          const statusHtml = statusText
            ? \`<div class="\${statusKind === "error" ? "error" : statusKind === "ok" ? "ok" : "muted"}">\${statusText}</div>\`
            : "";

          appEl.innerHTML = \`
            <div class="bar">
              <div class="muted">\${escapeHtml(entityId || entityType)} #\${entityValueId || "—"} • режим: \${escapeHtml(mode)}</div>
              <div class="spacer"></div>
              \${isExpanded ? "" : '<button id="expandBtn" type="button">Развернуть</button>'}
              \${canEdit ? '<button id="saveBtn" class="primary" type="button">Сохранить в CRM</button>' : ""}
            </div>
            <div class="chips">\${chipsHtml}</div>
            \${addPanelHtml}
            \${statusHtml}
          \`;

          const citySel = document.getElementById("citySel");
          if (citySel) citySel.addEventListener("change", (e) => { draftCity = e.target.value; draftType = ""; draftPromoId = ""; render(); });
          const typeSel = document.getElementById("typeSel");
          if (typeSel) typeSel.addEventListener("change", (e) => { draftType = e.target.value; draftPromoId = ""; render(); });
          const promoSel = document.getElementById("promoSel");
          if (promoSel) promoSel.addEventListener("change", (e) => { draftPromoId = e.target.value; render(); });
          const addBtn = document.getElementById("addBtn");
          if (addBtn) addBtn.addEventListener("click", addSelected);
          const expandBtn = document.getElementById("expandBtn");
          if (expandBtn) expandBtn.addEventListener("click", openExpanded);
          const saveBtn = document.getElementById("saveBtn");
          if (saveBtn) saveBtn.addEventListener("click", saveToCrm);
          appEl.querySelectorAll("button[data-act='remove']").forEach((el) => {
            el.addEventListener("click", (e) => removeSelected(Number(e.target.getAttribute("data-idx"))));
          });
        }

        render();
        setValueToB24();
      })();
    </script>
  </body>
</html>`;
}
