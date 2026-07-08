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
      table.catalog textarea { resize: none; height: 44px; }
      table.catalog tbody tr:nth-child(even) { background: #fafbfc; }
      table.catalog tbody tr.dirty { background: #fffbeb; }
      table.catalog thead th { position: sticky; top: 0; z-index: 5; }
      .city-picker[open] summary { border-color: #6366f1; }
      .city-picker summary::-webkit-details-marker { display: none; }
      .city-picker summary { list-style: none; }
    </style>
  </head>
  <body class="text-sm text-slate-800">
    <div class="max-w-[1600px] mx-auto p-5"><div id="app">Загрузка…</div></div>
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
        let directionConfig = { iblockTypeId: null, iblockId: null, entries: [] };
        let discoveredLists = [];
        let statusText = "", statusKind = "";
        let tab = "catalog"; // catalog | access | directories
        let filterText = "";
        const dirtyRows = new Set();

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
        function brandOptions() {
          const set = new Set();
          if (directionConfig.entries) directionConfig.entries.forEach((e) => set.add(e.name));
          catalog.forEach((p) => { if (p.brand) set.add(p.brand); });
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
              const cityCfg = await api("/api/admin/directory/config", { method: "POST", body: { ...a, kind: "city" } });
              cityConfig = { iblockTypeId: cityCfg.iblockTypeId, iblockId: cityCfg.iblockId, entries: cityCfg.entries || [] };
              const dirCfg = await api("/api/admin/directory/config", { method: "POST", body: { ...a, kind: "direction" } });
              directionConfig = { iblockTypeId: dirCfg.iblockTypeId, iblockId: dirCfg.iblockId, entries: dirCfg.entries || [] };
            }
            setStatus("", "");
          } catch (e) {
            setStatus("error", "Ошибка загрузки: " + (e && e.message ? e.message : String(e)));
          }
        }

        function blankRow() {
          return { id: "", brand: "", cities: [], type: "", title: "", description: "", periodStart: null, periodEnd: null, placements: [], department: "", active: true, sort: catalog.length, __new: true };
        }

        function rowKey(row, i) { return row.id && !row.__new ? row.id : "__new_" + i; }

        async function saveRow(row) {
          const a = auth();
          setStatus("muted", "Сохранение…");
          try {
            const promotion = {
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
            };
            await api("/api/admin/catalog/upsert", { method: "POST", body: { ...a, promotion } });
            return true;
          } catch (e) {
            setStatus("error", "Ошибка сохранения «" + (row.id || row.title) + "»: " + (e && e.message ? e.message : String(e)));
            return false;
          }
        }

        async function saveOneRow(row, key) {
          const ok = await saveRow(row);
          if (ok) {
            dirtyRows.delete(key);
            if (row.__new) draftNewRow = null;
            setStatus("ok", "Сохранено");
          }
          await loadAll();
        }

        async function saveAllDirty() {
          const rows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;
          const toSave = rows.filter((r, i) => dirtyRows.has(rowKey(r, i)));
          if (!toSave.length) return;
          setStatus("muted", "Сохраняю " + toSave.length + " акций…");
          let ok = 0;
          for (const row of toSave) { if (await saveRow(row)) ok++; }
          dirtyRows.clear();
          setStatus("ok", "Сохранено: " + ok + " из " + toSave.length);
          await loadAll();
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

        async function discoverDirectoryLists() {
          const a = auth();
          setStatus("muted", "Ищу списки в Битрикс24…");
          try {
            const res = await api("/api/admin/directory/discover", { method: "POST", body: a });
            discoveredLists = res.lists || [];
            setStatus("", discoveredLists.length ? "" : "Списки не найдены (проверьте scope 'lists' у приложения)");
            render();
          } catch (e) { setStatus("error", "Ошибка поиска списков: " + (e && e.message ? e.message : String(e))); }
        }
        async function syncDirectory(kind, iblockTypeId, iblockId) {
          const a = auth();
          setStatus("muted", "Синхронизирую…");
          try {
            const res = await api("/api/admin/directory/sync", { method: "POST", body: { ...a, kind, iblockTypeId, iblockId } });
            setStatus("ok", "Загружено значений: " + res.count);
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
            ? '<div class="flex gap-2 mb-4">' + tabBtn("catalog", "Каталог акций") + tabBtn("access", "Доступ") + tabBtn("directories", "Справочники") + '</div>'
            : "";

          let bodyHtml = "";
          if (tab === "access" && isPortalAdmin) bodyHtml = accessTabHtml();
          else if (tab === "directories" && isPortalAdmin) bodyHtml = directoriesTabHtml();
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
          wireDirectoriesTab();
        }

        function matchesFilter(r) {
          if (!filterText) return true;
          const q = filterText.toLowerCase();
          const hay = [r.id, r.brand, r.type, r.title, r.description, (r.cities || []).join(" ")].join(" ").toLowerCase();
          return hay.indexOf(q) !== -1;
        }

        function catalogTabHtml() {
          const allRows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;
          const visible = allRows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => matchesFilter(r));
          const dirtyCount = dirtyRows.size;

          return \`
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <button id="addRowBtn" type="button" class="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">+ Добавить акцию</button>
              <button id="saveAllBtn" type="button" \${dirtyCount ? "" : "disabled"}
                class="inline-flex items-center rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed">
                💾 Сохранить изменённые\${dirtyCount ? " (" + dirtyCount + ")" : ""}
              </button>
              <button id="resyncBtn" type="button" class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Синхронизировать справочники в Bitrix</button>
              <div class="flex-1"></div>
              <input id="filterInput" type="text" placeholder="Поиск по бренду, типу, названию, городу…" value="\${escapeHtml(filterText)}"
                class="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div class="text-xs text-slate-400 mb-2">Показано \${visible.length} из \${allRows.length}</div>
            <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm max-h-[70vh] overflow-y-auto">
              <table class="catalog w-full text-xs border-collapse">
                <thead>
                  <tr class="bg-slate-50 text-slate-500 text-left">
                    <th class="p-2 w-20">ID</th>
                    <th class="p-2 w-28">Бренд</th>
                    <th class="p-2 w-36">Города</th>
                    <th class="p-2 w-32">Тип</th>
                    <th class="p-2 w-52">Название</th>
                    <th class="p-2">Описание</th>
                    <th class="p-2 w-28">С</th>
                    <th class="p-2 w-28">По</th>
                    <th class="p-2 w-28">Размещения</th>
                    <th class="p-2 w-24">Отдел</th>
                    <th class="p-2 w-12">Вкл</th>
                    <th class="p-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>\${visible.map(({ r, i }) => rowHtml(r, i)).join("") || '<tr><td colspan="12" class="p-4 text-center text-slate-400">Ничего не найдено</td></tr>'}</tbody>
              </table>
            </div>
          \`;
        }

        function rowHtml(r, i) {
          const prefix = "row" + i + "_";
          const key = rowKey(r, i);
          const isDirty = dirtyRows.has(key);
          const idField = r.__new
            ? '<input type="text" id="' + prefix + 'id" placeholder="авто" value="' + escapeHtml(r.id || "") + '"/>'
            : '<span class="text-slate-400">' + escapeHtml(r.id) + '</span>';

          const brands = brandOptions();
          const brandVal = r.brand || "";
          const brandOptsHtml = ['']
            .concat(brands.indexOf(brandVal) === -1 && brandVal ? [brandVal] : [])
            .concat(brands)
            .map((b) => '<option value="' + escapeHtml(b) + '" ' + (b === brandVal ? "selected" : "") + '>' + (b ? escapeHtml(b) : "— выберите —") + '</option>')
            .join("");

          const cities = cityOptions();
          const citySelected = new Set(r.cities || []);
          const allCityValues = ["Все"].concat(cities);
          const cityCheckboxes = allCityValues.map((c) =>
            '<label class="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-slate-50 cursor-pointer">' +
              '<input type="checkbox" class="city-check" data-row="' + i + '" value="' + escapeHtml(c) + '" ' + (citySelected.has(c) ? "checked" : "") + '/>' +
              '<span>' + escapeHtml(c) + '</span>' +
            '</label>'
          ).join("");
          const citySummary = (r.cities || []).length ? (r.cities || []).join(", ") : "Выбрать города";

          return \`
            <tr class="border-t border-slate-100 hover:bg-slate-50/60 align-top \${isDirty ? "dirty" : ""}" data-key="\${escapeHtml(key)}">
              <td class="p-2">\${idField}</td>
              <td class="p-2"><select id="\${prefix}brand">\${brandOptsHtml}</select></td>
              <td class="p-2 relative">
                <details class="city-picker">
                  <summary class="cursor-pointer select-none rounded-md border border-slate-300 bg-white px-2 py-1 text-xs truncate block" title="\${escapeHtml(citySummary)}">\${escapeHtml(citySummary)}</summary>
                  <div class="absolute z-20 mt-1 max-h-56 w-56 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">\${cityCheckboxes}</div>
                </details>
              </td>
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
          const allRows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;
          const visible = allRows.map((r, i) => ({ r, i })).filter(({ r }) => matchesFilter(r));

          const addRowBtn = document.getElementById("addRowBtn");
          if (addRowBtn) addRowBtn.addEventListener("click", () => { draftNewRow = blankRow(); render(); });
          const resyncBtn = document.getElementById("resyncBtn");
          if (resyncBtn) resyncBtn.addEventListener("click", resyncFields);
          const saveAllBtn = document.getElementById("saveAllBtn");
          if (saveAllBtn) saveAllBtn.addEventListener("click", saveAllDirty);
          const filterInput = document.getElementById("filterInput");
          if (filterInput) {
            filterInput.addEventListener("input", (e) => { filterText = e.target.value; render(); });
            filterInput.focus();
            filterInput.selectionStart = filterInput.selectionEnd = filterInput.value.length;
          }

          visible.forEach(({ r, i }) => {
            const prefix = "row" + i + "_";
            const key = rowKey(r, i);
            const markDirty = () => { dirtyRows.add(key); };

            ["id","type","title","description","periodStart","periodEnd","placementsText","department"].forEach((k) => {
              const el = document.getElementById(prefix + k);
              if (el) el.addEventListener("input", (e) => { r[k] = e.target.value; markDirty(); const tr = el.closest("tr"); if (tr) tr.classList.add("dirty"); });
            });
            const brandEl = document.getElementById(prefix + "brand");
            if (brandEl) brandEl.addEventListener("change", (e) => { r.brand = e.target.value; markDirty(); const tr = e.target.closest("tr"); if (tr) tr.classList.add("dirty"); });

            appEl.querySelectorAll('.city-check[data-row="' + i + '"]').forEach((cb) => {
              cb.addEventListener("change", (e) => {
                const val = e.target.value;
                const set = new Set(r.cities || []);
                if (e.target.checked) set.add(val); else set.delete(val);
                r.cities = Array.from(set);
                markDirty();
                render();
              });
            });

            const active = document.getElementById(prefix + "active");
            if (active) active.addEventListener("change", (e) => { r.active = e.target.checked; markDirty(); render(); });
            const saveBtn = document.getElementById(prefix + "save");
            if (saveBtn) saveBtn.addEventListener("click", () => saveOneRow(r, key));
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

        function directorySectionHtml(kind, title, cfg) {
          const configured = cfg.iblockId
            ? \`Источник: type=\${escapeHtml(cfg.iblockTypeId)}, id=\${escapeHtml(cfg.iblockId)} · загружено: \${cfg.entries.length}\`
            : "Источник ещё не выбран — значения берутся из уже введённых в акциях данных.";
          return \`
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-800 mb-1">\${title}</h3>
              <p class="text-xs text-slate-400 mb-3">\${configured}</p>
              \${discoveredLists.length ? '<div class="space-y-1.5 mb-3">' + discoveredLists.map((l) =>
                '<div class="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-xs">' +
                  '<div>' + escapeHtml(l.NAME) + ' <span class="text-slate-400">(type=' + escapeHtml(l.IBLOCK_TYPE_ID) + ', id=' + escapeHtml(l.IBLOCK_ID) + ')</span></div>' +
                  '<button type="button" class="sync-list-btn rounded-md bg-indigo-600 text-white px-2 py-1" data-kind="' + kind + '" data-type="' + escapeHtml(l.IBLOCK_TYPE_ID) + '" data-id="' + escapeHtml(l.IBLOCK_ID) + '">Использовать для «' + title + '»</button>' +
                '</div>').join("") + '</div>' : ""}
              \${cfg.entries.length ? '<div class="flex flex-wrap gap-1.5">' + cfg.entries.slice(0, 40).map((e) =>
                '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">' + escapeHtml(e.name) + '</span>').join("") + '</div>' : ""}
            </div>\`;
        }

        function directoriesTabHtml() {
          return \`
            <button id="discoverBtn" type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 mb-3">Найти списки в Битрикс24</button>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              \${directorySectionHtml("city", "Города", cityConfig)}
              \${directorySectionHtml("direction", "Направления продаж", directionConfig)}
            </div>
          \`;
        }

        function wireDirectoriesTab() {
          const discoverBtn = document.getElementById("discoverBtn");
          if (discoverBtn) discoverBtn.addEventListener("click", discoverDirectoryLists);
          appEl.querySelectorAll(".sync-list-btn").forEach((el) => el.addEventListener("click", (e) =>
            syncDirectory(e.currentTarget.getAttribute("data-kind"), e.currentTarget.getAttribute("data-type"), e.currentTarget.getAttribute("data-id"))));
        }

        loadAll().then(render);
      })();
    </script>
  </body>
</html>`;
}
