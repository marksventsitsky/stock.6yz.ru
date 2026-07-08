export type AdminPageContext = {
  domain: string;
  lang: string;
  memberId: string;
  authId: string;
};

export function renderAdminPage(ctx: AdminPageContext, apiBaseUrl: string): string {
  const safeJson = (obj: unknown) => JSON.stringify(obj).replaceAll("</script>", "<\\/script>");
  const bootstrapJson = safeJson({
    apiBaseUrl,
    domain: ctx.domain,
    memberId: ctx.memberId,
    authId: ctx.authId,
  });

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="//api.bitrix24.com/api/v1/dev/"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <title>Акции — админка</title>
    <style>
      body { background: #f8fafc; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
      table.catalog input[type="text"], table.catalog textarea, table.catalog input[type="date"], table.catalog select {
        width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; font: inherit; box-sizing: border-box; background: #fff;
      }
      table.catalog textarea { resize: vertical; min-height: 32px; }
    </style>
  </head>
  <body class="text-sm text-slate-800">
    <div class="max-w-[1500px] mx-auto p-5"><div id="app">Загрузка…</div></div>
    <script id="bootstrap-json" type="application/json">${bootstrapJson}</script>
    <script>
      (function () {
        const appEl = document.getElementById("app");
        function readJsonScript(id) { const el = document.getElementById(id); return el ? JSON.parse(el.textContent || "null") : null; }
        const BOOTSTRAP = readJsonScript("bootstrap-json");

        function escapeHtml(s) {
          return String(s ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
        }
        function showFatal(title, detail) {
          appEl.innerHTML = '<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700"><b>' + escapeHtml(title) + '</b><pre class="whitespace-pre-wrap mt-2 text-xs">' + escapeHtml(String(detail)) + '</pre></div>';
        }
        window.addEventListener("error", (ev) => { try { showFatal("JS error", (ev.error && ev.error.stack) || String(ev.message || ev)); } catch {} });
        window.addEventListener("unhandledrejection", (ev) => { try { showFatal("Unhandled rejection", (ev.reason && ev.reason.stack) || String(ev.reason)); } catch {} });

        function auth() {
          let authId = BOOTSTRAP.authId, domain = BOOTSTRAP.domain, memberId = BOOTSTRAP.memberId, userId = 0;
          try {
            if (window.BX24 && BX24.getAuth) {
              const a = BX24.getAuth();
              if (a) {
                authId = a.access_token || authId;
                domain = a.domain || domain;
                memberId = a.member_id || memberId;
                userId = Number(a.user_id || a.USER_ID || a.USERID || 0) || 0;
              }
            }
          } catch {}
          return { memberId, domain, accessToken: authId, userId };
        }

        let catalog = [];
        let isAdmin = false;
        let isPortalAdmin = false;
        let accessUsers = [];
        let userSearchResults = [];
        let cityConfig = { iblockTypeId: null, iblockId: null, entries: [] };
        let discoveredLists = [];
        let statusText = "", statusKind = "";
        let tab = "catalog"; // catalog | access | cities

        function setStatus(kind, text) { statusKind = kind; statusText = text || ""; render(); }

        async function api(path, opts) {
          const resp = await fetch(BOOTSTRAP.apiBaseUrl + path, {
            method: (opts && opts.method) || "GET",
            headers: { "Content-Type": "application/json" },
            body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error((data && data.error) || "request_failed");
          return data;
        }

        function cityOptions() {
          if (cityConfig.entries && cityConfig.entries.length) return cityConfig.entries.map((e) => e.name);
          const set = new Set();
          catalog.forEach((p) => (p.cities || []).forEach((c) => { if (c !== "Все") set.add(c); }));
          return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
        }

        async function loadAll() {
          setStatus("muted", "Загрузка…");
          const a = auth();
          try {
            const check = await api("/api/admin/whoami", { method: "POST", body: a });
            isAdmin = !!check.isAdmin;
            isPortalAdmin = !!check.isPortalAdmin;
            const list = await api("/api/admin/catalog", { method: "POST", body: a });
            catalog = list.items || [];
            if (isPortalAdmin) {
              const acc = await api("/api/admin/access/list", { method: "POST", body: a });
              accessUsers = acc.items || [];
              const cfg = await api("/api/admin/citylist/config", { method: "POST", body: a });
              cityConfig = { iblockTypeId: cfg.iblockTypeId, iblockId: cfg.iblockId, entries: cfg.entries || [] };
            }
            setStatus("", "");
          } catch (e) {
            setStatus("error", "Ошибка загрузки: " + (e && e.message ? e.message : String(e)));
          }
        }

        function blankRow() {
          return { id: "", brand: "", cities: [], type: "", title: "", description: "", periodStart: null, periodEnd: null, placements: [], department: "", active: true, sort: catalog.length, __new: true };
        }

        async function saveRow(row) {
          const a = auth();
          setStatus("muted", "Сохранение…");
          try {
            const payload = { ...a, promotion: {
              id: row.id && row.id.trim() ? row.id.trim() : "promo-" + Date.now().toString(36),
              brand: row.brand || "",
              cities: row.cities || [],
              type: row.type || "",
              title: row.title || "",
              description: row.description || "",
              periodStart: row.periodStart || null,
              periodEnd: row.periodEnd || null,
              placements: (row.placementsText || (row.placements || []).join(", ")).split(",").map((s) => s.trim()).filter(Boolean),
              department: row.department || "",
              active: !!row.active,
              sort: Number(row.sort || 0),
            } };
            await api("/api/admin/catalog/upsert", { method: "POST", body: payload });
            setStatus("ok", "Сохранено");
            await loadAll();
          } catch (e) {
            setStatus("error", "Ошибка сохранения: " + (e && e.message ? e.message : String(e)));
          }
        }

        async function deleteRow(id) {
          if (!confirm("Удалить акцию «" + id + "»?")) return;
          const a = auth();
          setStatus("muted", "Удаление…");
          try {
            await api("/api/admin/catalog/delete", { method: "POST", body: { ...a, id } });
            setStatus("ok", "Удалено");
            await loadAll();
          } catch (e) {
            setStatus("error", "Ошибка удаления: " + (e && e.message ? e.message : String(e)));
          }
        }

        async function resyncFields() {
          const a = auth();
          setStatus("muted", "Синхронизация справочников Bitrix…");
          try {
            const res = await api("/api/admin/resync-fields", { method: "POST", body: a });
            setStatus("ok", "Справочники синхронизированы: " + JSON.stringify(res.result || {}));
          } catch (e) {
            setStatus("error", "Ошибка синхронизации: " + (e && e.message ? e.message : String(e)));
          }
        }

        let accessQuery = "";
        async function searchUsers() {
          const a = auth();
          try {
            const res = await api("/api/admin/access/search", { method: "POST", body: { ...a, query: accessQuery } });
            userSearchResults = res.users || [];
            render();
          } catch (e) { setStatus("error", "Ошибка поиска: " + (e && e.message ? e.message : String(e))); }
        }
        async function addAccessUser(userId, name) {
          const a = auth();
          setStatus("muted", "Добавление доступа…");
          try {
            await api("/api/admin/access/add", { method: "POST", body: { ...a, userId, name } });
            userSearchResults = []; accessQuery = "";
            setStatus("ok", "Доступ выдан");
            await loadAll();
          } catch (e) { setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e))); }
        }
        async function removeAccessUser(userId) {
          if (!confirm("Забрать доступ у этого пользователя?")) return;
          const a = auth();
          setStatus("muted", "Удаление доступа…");
          try {
            await api("/api/admin/access/remove", { method: "POST", body: { ...a, userId } });
            setStatus("ok", "Доступ отозван");
            await loadAll();
          } catch (e) { setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e))); }
        }

        async function discoverCityLists() {
          const a = auth();
          setStatus("muted", "Ищу списки в Битрикс24…");
          try {
            const res = await api("/api/admin/citylist/discover", { method: "POST", body: a });
            discoveredLists = res.lists || [];
            setStatus("", discoveredLists.length ? "" : "Списки не найдены (проверьте scope 'lists' у приложения)");
            render();
          } catch (e) { setStatus("error", "Ошибка поиска списков: " + (e && e.message ? e.message : String(e))); }
        }
        async function syncCityList(iblockTypeId, iblockId) {
          const a = auth();
          setStatus("muted", "Синхронизирую города…");
          try {
            const res = await api("/api/admin/citylist/sync", { method: "POST", body: { ...a, iblockTypeId, iblockId } });
            setStatus("ok", "Загружено городов: " + res.count);
            await loadAll();
          } catch (e) { setStatus("error", "Ошибка синхронизации: " + (e && e.message ? e.message : String(e))); }
        }

        let draftNewRow = null;

        function tabBtn(key, label) {
          const activeCls = tab === key ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50";
          return '<button type="button" data-tab="' + key + '" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 ' + activeCls + '">' + label + '</button>';
        }

        function render() {
          const statusHtml = statusText
            ? '<div class="mb-3 text-sm ' + (statusKind === "error" ? "text-red-600" : statusKind === "ok" ? "text-emerald-600" : "text-slate-500") + '">' + escapeHtml(statusText) + "</div>"
            : "";

          if (!isAdmin) {
            appEl.innerHTML = '<h1 class="text-lg font-semibold mb-3">Акции — админка</h1><div class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">У вас нет доступа к этому разделу. Обратитесь к администратору портала, чтобы он выдал вам доступ.</div>' + statusHtml;
            return;
          }

          const tabsHtml = isPortalAdmin
            ? '<div class="flex gap-2 mb-4">' + tabBtn("catalog", "Каталог акций") + tabBtn("access", "Доступ") + tabBtn("cities", "Города") + '</div>'
            : "";

          let bodyHtml = "";
          if (tab === "access" && isPortalAdmin) bodyHtml = accessTabHtml();
          else if (tab === "cities" && isPortalAdmin) bodyHtml = citiesTabHtml();
          else bodyHtml = catalogTabHtml();

          appEl.innerHTML = \`
            <div class="flex items-center justify-between mb-1">
              <h1 class="text-lg font-semibold text-slate-900">Акции <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">\${catalog.length}</span></h1>
            </div>
            <p class="text-xs text-slate-400 mb-4">Изменения пишутся в JSON-снапшот и в обычные поля направления/бренда/типа/названия акции на лидах и сделках.</p>
            \${tabsHtml}
            \${statusHtml}
            \${bodyHtml}
          \`;

          appEl.querySelectorAll(".tab-btn").forEach((el) => el.addEventListener("click", (e) => { tab = e.currentTarget.getAttribute("data-tab"); render(); }));
          wireCatalogTab();
          wireAccessTab();
          wireCitiesTab();
        }

        function catalogTabHtml() {
          const rows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;
          return \`
            <div class="flex gap-2 mb-3">
              <button id="addRowBtn" type="button" class="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">+ Добавить акцию</button>
              <button id="resyncBtn" type="button" class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Синхронизировать справочники в Bitrix</button>
            </div>
            <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table class="catalog w-full text-xs border-collapse">
                <thead>
                  <tr class="bg-slate-50 text-slate-500 text-left">
                    <th class="p-2 w-24">ID</th>
                    <th class="p-2 w-24">Бренд</th>
                    <th class="p-2 w-40">Города</th>
                    <th class="p-2 w-32">Тип</th>
                    <th class="p-2 w-52">Название</th>
                    <th class="p-2">Описание</th>
                    <th class="p-2 w-28">С</th>
                    <th class="p-2 w-28">По</th>
                    <th class="p-2 w-32">Размещения</th>
                    <th class="p-2 w-24">Отдел</th>
                    <th class="p-2 w-12">Вкл</th>
                    <th class="p-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>\${rows.map((r, i) => rowHtml(r, i)).join("")}</tbody>
              </table>
            </div>
          \`;
        }

        function rowHtml(r, i) {
          const prefix = "row" + i + "_";
          const idField = r.__new
            ? '<input type="text" id="' + prefix + 'id" placeholder="авто" value="' + escapeHtml(r.id || "") + '"/>'
            : '<span class="text-slate-400">' + escapeHtml(r.id) + '</span>';
          const cities = cityOptions();
          const citySelected = new Set(r.cities || []);
          const cityOptsHtml = ['Все'].concat(cities).map((c) =>
            '<option value="' + escapeHtml(c) + '" ' + (citySelected.has(c) ? "selected" : "") + '>' + escapeHtml(c) + '</option>'
          ).join("");
          return \`
            <tr class="border-t border-slate-100 hover:bg-slate-50/60 align-top">
              <td class="p-2">\${idField}</td>
              <td class="p-2"><input type="text" id="\${prefix}brand" value="\${escapeHtml(r.brand || "")}"/></td>
              <td class="p-2"><select id="\${prefix}cities" multiple size="3">\${cityOptsHtml}</select></td>
              <td class="p-2"><input type="text" id="\${prefix}type" value="\${escapeHtml(r.type || "")}"/></td>
              <td class="p-2"><textarea id="\${prefix}title">\${escapeHtml(r.title || "")}</textarea></td>
              <td class="p-2"><textarea id="\${prefix}description">\${escapeHtml(r.description || "")}</textarea></td>
              <td class="p-2"><input type="date" id="\${prefix}periodStart" value="\${escapeHtml(r.periodStart || "")}"/></td>
              <td class="p-2"><input type="date" id="\${prefix}periodEnd" value="\${escapeHtml(r.periodEnd || "")}"/></td>
              <td class="p-2"><input type="text" id="\${prefix}placementsText" value="\${escapeHtml((r.placements || []).join(", "))}"/></td>
              <td class="p-2"><input type="text" id="\${prefix}department" value="\${escapeHtml(r.department || "")}"/></td>
              <td class="p-2 text-center"><input type="checkbox" id="\${prefix}active" \${r.active ? "checked" : ""}/></td>
              <td class="p-2">
                <div class="flex gap-1">
                  <button id="\${prefix}save" type="button" class="rounded-md bg-indigo-600 text-white px-2 py-1 hover:bg-indigo-700">💾</button>
                  \${r.__new ? "" : '<button id="' + prefix + 'del" type="button" class="rounded-md bg-red-600 text-white px-2 py-1 hover:bg-red-700">✕</button>'}
                </div>
              </td>
            </tr>\`;
        }

        function wireCatalogTab() {
          const rows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;
          const addRowBtn = document.getElementById("addRowBtn");
          if (addRowBtn) addRowBtn.addEventListener("click", () => { draftNewRow = blankRow(); render(); });
          const resyncBtn = document.getElementById("resyncBtn");
          if (resyncBtn) resyncBtn.addEventListener("click", resyncFields);

          rows.forEach((r, i) => {
            const prefix = "row" + i + "_";
            ["id","brand","type","title","description","periodStart","periodEnd","placementsText","department"].forEach((k) => {
              const el = document.getElementById(prefix + k);
              if (el) el.addEventListener("change", (e) => { r[k] = e.target.value; });
            });
            const citiesEl = document.getElementById(prefix + "cities");
            if (citiesEl) citiesEl.addEventListener("change", (e) => {
              r.cities = Array.from(e.target.selectedOptions).map((o) => o.value);
            });
            const active = document.getElementById(prefix + "active");
            if (active) active.addEventListener("change", (e) => { r.active = e.target.checked; });
            const saveBtn = document.getElementById(prefix + "save");
            if (saveBtn) saveBtn.addEventListener("click", async () => { await saveRow(r); if (r.__new) draftNewRow = null; });
            const delBtn = document.getElementById(prefix + "del");
            if (delBtn) delBtn.addEventListener("click", () => deleteRow(r.id));
          });
        }

        function accessTabHtml() {
          return \`
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-w-xl">
              <h3 class="text-sm font-semibold text-slate-800 mb-1">Доступ к админке (кроме администраторов портала)</h3>
              <p class="text-xs text-slate-400 mb-3">Выдайте доступ конкретному сотруднику, не делая его полным администратором портала Bitrix24.</p>
              <div class="flex gap-2 mb-3">
                <input type="text" id="accessQuery" placeholder="Имя или email сотрудника…" value="\${escapeHtml(accessQuery)}"
                  class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
                <button id="accessSearchBtn" type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Найти</button>
              </div>
              \${userSearchResults.length ? '<div class="flex flex-wrap gap-2 mb-3">' +
                userSearchResults.map((u) => '<button type="button" class="add-access-btn rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-1 text-xs font-medium hover:bg-emerald-100" data-uid="' + u.userId + '" data-name="' + escapeHtml(u.name) + '">+ ' + escapeHtml(u.name) + '</button>').join("") +
                '</div>' : ""}
              <table class="w-full text-xs">
                <thead><tr class="text-left text-slate-500"><th class="py-1">Пользователь</th><th class="py-1 w-20">ID</th><th class="py-1 w-12"></th></tr></thead>
                <tbody>
                  \${accessUsers.length ? accessUsers.map((u) => \`
                    <tr class="border-t border-slate-100"><td class="py-1.5">\${escapeHtml(u.name)}</td><td class="py-1.5">\${u.userId}</td>
                      <td class="py-1.5"><button type="button" class="remove-access-btn rounded-md bg-red-600 text-white px-2 py-0.5" data-uid="\${u.userId}">✕</button></td></tr>
                  \`).join("") : '<tr><td colspan="3" class="py-2 text-slate-400">Пока никому, кроме админов портала, доступ не выдан.</td></tr>'}
                </tbody>
              </table>
            </div>\`;
        }

        function wireAccessTab() {
          const accessQueryEl = document.getElementById("accessQuery");
          if (accessQueryEl) accessQueryEl.addEventListener("change", (e) => { accessQuery = e.target.value; });
          const accessSearchBtn = document.getElementById("accessSearchBtn");
          if (accessSearchBtn) accessSearchBtn.addEventListener("click", searchUsers);
          appEl.querySelectorAll(".add-access-btn").forEach((el) => el.addEventListener("click", (e) => addAccessUser(Number(e.currentTarget.getAttribute("data-uid")), e.currentTarget.getAttribute("data-name"))));
          appEl.querySelectorAll(".remove-access-btn").forEach((el) => el.addEventListener("click", (e) => removeAccessUser(Number(e.currentTarget.getAttribute("data-uid")))));
        }

        function citiesTabHtml() {
          const configured = cityConfig.iblockId ? \`Источник: IBLOCK_TYPE_ID=\${escapeHtml(cityConfig.iblockTypeId)}, IBLOCK_ID=\${escapeHtml(cityConfig.iblockId)} · загружено городов: \${cityConfig.entries.length}\` : "Источник ещё не выбран — города берутся из уже введённых в акциях значений.";
          return \`
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-w-2xl">
              <h3 class="text-sm font-semibold text-slate-800 mb-1">Города из Bitrix24 «Списки»</h3>
              <p class="text-xs text-slate-400 mb-3">\${configured}</p>
              <button id="discoverBtn" type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 mb-3">Найти списки в Битрикс24</button>
              \${discoveredLists.length ? '<div class="space-y-1.5 mb-3">' + discoveredLists.map((l) =>
                '<div class="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-xs">' +
                  '<div>' + escapeHtml(l.NAME) + ' <span class="text-slate-400">(type=' + escapeHtml(l.IBLOCK_TYPE_ID) + ', id=' + escapeHtml(l.IBLOCK_ID) + ')</span></div>' +
                  '<button type="button" class="sync-list-btn rounded-md bg-indigo-600 text-white px-2 py-1" data-type="' + escapeHtml(l.IBLOCK_TYPE_ID) + '" data-id="' + escapeHtml(l.IBLOCK_ID) + '">Использовать этот</button>' +
                '</div>').join("") + '</div>' : ""}
              \${cityConfig.entries.length ? '<div class="flex flex-wrap gap-1.5">' + cityConfig.entries.slice(0, 40).map((e) =>
                '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">' + escapeHtml(e.name) + '</span>').join("") + '</div>' : ""}
            </div>\`;
        }

        function wireCitiesTab() {
          const discoverBtn = document.getElementById("discoverBtn");
          if (discoverBtn) discoverBtn.addEventListener("click", discoverCityLists);
          appEl.querySelectorAll(".sync-list-btn").forEach((el) => el.addEventListener("click", (e) =>
            syncCityList(e.currentTarget.getAttribute("data-type"), e.currentTarget.getAttribute("data-id"))));
        }

        loadAll().then(render);
      })();
    </script>
  </body>
</html>`;
}
