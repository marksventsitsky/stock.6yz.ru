import type { Promotion } from "../domain/promo.js";
import type { Selection } from "../domain/promo.js";

export type PromoWidgetContext = {
  domain: string;
  lang: string;
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
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background: #f8fafc; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
    </style>
  </head>
  <body class="text-sm text-slate-800">
    <div class="p-4 max-w-3xl mx-auto"><div id="app">Загрузка…</div></div>
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
          appEl.innerHTML = '<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700"><b>' + escapeHtml(title) + '</b><pre class="whitespace-pre-wrap mt-2 text-xs">' + escapeHtml(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)) + '</pre></div>';
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
          render();
        }
        function removeSelected(idx) { selection = selection.filter((_, i) => i !== idx); render(); }

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

        function chip(label) {
          return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">' + escapeHtml(label) + '</span>';
        }

        function render() {
          const cities = distinctCities();
          const types = draftCity ? typesForCity(draftCity) : [];
          const promos = draftCity && draftType ? promosForCityType(draftCity, draftType) : [];

          const cardsHtml = selection.length
            ? selection.map((s, i) => \`
              <div class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-slate-900">\${escapeHtml(s.title)}</div>
                  <div class="mt-1.5 flex flex-wrap gap-1.5">
                    \${chip(s.city || "—")}\${chip(s.brand || "—")}\${chip(s.type || "—")}
                  </div>
                </div>
                <button type="button" data-act="remove" data-idx="\${i}" class="shrink-0 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 text-xs font-medium transition">Удалить</button>
              </div>\`).join("")
            : '<div class="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-400">Пока не выбрано ни одной акции</div>';

          const selectCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400";
          const labelCls = "block text-xs font-medium text-slate-500 mb-1";

          const statusHtml = statusText
            ? '<div class="mt-3 text-sm ' + (statusKind === "error" ? "text-red-600" : statusKind === "ok" ? "text-emerald-600" : "text-slate-500") + '">' + escapeHtml(statusText) + "</div>"
            : "";

          appEl.innerHTML = \`
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-base font-semibold text-slate-900">Акции</h1>
              <div class="text-xs text-slate-400">\${entityType} #\${entityId || "—"}</div>
            </div>

            <div class="space-y-2 mb-4">\${cardsHtml}</div>

            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-800 mb-3">Добавить акцию</h3>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="\${labelCls}">Направление (город)</label>
                  <select id="citySel" class="\${selectCls}">
                    <option value="">— выберите —</option>
                    \${cities.map((c) => \`<option value="\${escapeHtml(c)}" \${c === draftCity ? "selected" : ""}>\${escapeHtml(c)}</option>\`).join("")}
                  </select>
                </div>
                <div>
                  <label class="\${labelCls}">Тип акции</label>
                  <select id="typeSel" class="\${selectCls}" \${draftCity ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${types.map((t) => \`<option value="\${escapeHtml(t)}" \${t === draftType ? "selected" : ""}>\${escapeHtml(t)}</option>\`).join("")}
                  </select>
                </div>
                <div>
                  <label class="\${labelCls}">Акция</label>
                  <select id="promoSel" class="\${selectCls}" \${draftType ? "" : "disabled"}>
                    <option value="">— выберите —</option>
                    \${promos.map((p) => \`<option value="\${escapeHtml(p.id)}" \${p.id === draftPromoId ? "selected" : ""}>\${escapeHtml(p.title)}</option>\`).join("")}
                  </select>
                </div>
              </div>
              <button id="addBtn" type="button" \${draftPromoId ? "" : "disabled"}
                class="mt-3 inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                + Добавить в список
              </button>
            </div>

            <div class="mt-4 flex items-center gap-3">
              <button id="saveBtn" type="button" \${saving ? "disabled" : ""}
                class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
                \${saving ? "Сохранение…" : "Сохранить в CRM"}
              </button>
              \${statusHtml}
            </div>
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
      })();
    </script>
  </body>
</html>`;
}
