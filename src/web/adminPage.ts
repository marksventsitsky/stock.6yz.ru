import { DESIGN_SYSTEM_CSS } from "./designSystem.js";

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
    <title>Акции — админка</title>
    <style>
      ${DESIGN_SYSTEM_CSS}
      body { margin: 0; }
      /* Bitrix24 already wraps app pages in its own padded card — don't add a second
         layer of max-width/centering on top of it, or you get huge dead gutters. */
      .wrap { width: 100%; box-sizing: border-box; }
      .toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .split { display: flex; align-items: stretch; }
      .table-scroll { flex: 1; min-width: 0; max-height: 70vh; overflow: auto; }
    </style>
  </head>
  <body>
    <div class="wrap"><div id="app">Загрузка…</div></div>
    <script id="bootstrap-json" type="application/json">${bootstrapJson}</script>
    <script>
      (function () {
        const appEl = document.getElementById("app");
        function readJsonScript(id) { const el = document.getElementById(id); return el ? JSON.parse(el.textContent || "null") : null; }
        const BOOTSTRAP = readJsonScript("bootstrap-json");
        const TODAY = new Date().toISOString().slice(0, 10);
        const EXPIRING_SOON_DAYS = 14;

        function escapeHtml(s) {
          return String(s ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
        }
        function showFatal(title, detail) {
          appEl.innerHTML = '<div class="ds-card" style="padding:12px;border-color:#f3c9c9;background:var(--danger-bg);color:var(--danger-text)"><b>' + escapeHtml(title) + '</b><pre style="white-space:pre-wrap;margin-top:8px;font-size:11px">' + escapeHtml(String(detail)) + '</pre></div>';
        }
        window.addEventListener("error", (ev) => { try { showFatal("JS error", (ev.error && ev.error.stack) || String(ev.message || ev)); } catch {} });
        window.addEventListener("unhandledrejection", (ev) => { try { showFatal("Unhandled rejection", (ev.reason && ev.reason.stack) || String(ev.reason)); } catch {} });

        function fmtShort(iso) {
          if (!iso) return "";
          const [y, m, d] = iso.split("-");
          return d + "." + m;
        }
        function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

        function computeStatus(p) {
          if (!p.active) return { kind: "off", label: "Выключена" };
          if (p.periodEnd) {
            if (p.periodEnd < TODAY) return { kind: "expired", label: "Истекла" };
            if (daysBetween(TODAY, p.periodEnd) <= EXPIRING_SOON_DAYS) return { kind: "expiring", label: "Истекает " + fmtShort(p.periodEnd) };
          }
          if (!p.periodStart && !p.periodEnd) return { kind: "permanent", label: "Постоянная" };
          if (p.periodStart && p.periodStart > TODAY) return { kind: "draft", label: "Ещё не началась" };
          return { kind: "active", label: "Активна" };
        }
        function statusPillHtml(status) {
          return '<span class="ds-status ' + status.kind + '"><span class="ds-status-dot"></span>' + escapeHtml(status.label) + '</span>';
        }

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
        let placementConfig = { entries: [] };
        let typeConfig = { entries: [] };
        let discoveredLists = [];
        let statusText = "", statusKind = "";
        let tab = "catalog"; // catalog | access | directories
        let filterText = "";
        let statusFilter = "";
        const dirtyRows = new Set();
        let drawerRowKey = null;
        let drawerDraft = null;

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
        function typeOptions() {
          const set = new Set();
          if (typeConfig.entries) typeConfig.entries.forEach((e) => set.add(e.name));
          catalog.forEach((p) => { if (p.type) set.add(p.type); });
          return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
        }
        function departmentOptions() {
          const set = new Set();
          catalog.forEach((p) => { if (p.department) set.add(p.department); });
          return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
        }
        function placementOptions() {
          if (placementConfig.entries && placementConfig.entries.length) return placementConfig.entries.map((e) => e.name);
          const set = new Set();
          catalog.forEach((p) => (p.placements || []).forEach((x) => set.add(x)));
          ["Сайт", "Директ", "КЦ", "ТВ", "SMM", "Франчайзи"].forEach((x) => set.add(x));
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
              const plCfg = await api("/api/admin/directory/config", { method: "POST", body: { ...a, kind: "placement" } });
              placementConfig = { entries: plCfg.entries || [] };
              const typeCfg = await api("/api/admin/directory/config", { method: "POST", body: { ...a, kind: "type" } });
              typeConfig = { entries: typeCfg.entries || [] };
            }
            setStatus("", "");
          } catch (e) {
            setStatus("error", "Ошибка загрузки: " + (e && e.message ? e.message : String(e)));
          }
        }

        function blankPromo() {
          return { id: "", brand: "", cities: [], type: "", title: "", description: "", periodStart: null, periodEnd: null, placements: [], department: "", active: true, sort: catalog.length };
        }

        function rowKey(row) { return row.id || "__new"; }

        async function persistPromo(promo) {
          const a = auth();
          try {
            const id = promo.id && promo.id.trim() ? promo.id.trim() : "promo-" + Date.now().toString(36);
            await api("/api/admin/catalog/upsert", { method: "POST", body: { ...a, promotion: { ...promo, id } } });
            return true;
          } catch (e) {
            setStatus("error", "Ошибка сохранения «" + (promo.title || promo.id) + "»: " + (e && e.message ? e.message : String(e)));
            return false;
          }
        }

        async function saveAllDirty() {
          const toSave = catalog.filter((r) => dirtyRows.has(rowKey(r)));
          if (!toSave.length) return;
          setStatus("muted", "Сохраняю " + toSave.length + " акций…");
          let ok = 0;
          for (const row of toSave) { if (await persistPromo(row)) ok++; }
          dirtyRows.clear();
          setStatus("ok", "Сохранено: " + ok + " из " + toSave.length);
          await loadAll();
        }

        function discardAllDirty() { dirtyRows.clear(); loadAll().then(render); }

        async function deleteRow(id) {
          if (!confirm("Удалить акцию «" + id + "»?")) return;
          const a = auth();
          setStatus("muted", "Удаление…");
          try {
            await api("/api/admin/catalog/delete", { method: "POST", body: { ...a, id } });
            drawerRowKey = null; drawerDraft = null;
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

        async function addManualEntry(kind, name) {
          if (!name || !name.trim()) return;
          const a = auth();
          try {
            await api("/api/admin/directory/add-manual", { method: "POST", body: { ...a, kind, name: name.trim() } });
            setStatus("ok", "Добавлено");
            await loadAll();
          } catch (e) { setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e))); }
        }
        async function removeManualEntry(kind, externalId) {
          const a = auth();
          try {
            await api("/api/admin/directory/remove-manual", { method: "POST", body: { ...a, kind, externalId } });
            setStatus("ok", "Удалено");
            await loadAll();
          } catch (e) { setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e))); }
        }

        function tabHtml(key, label, count) {
          const cls = "ds-tab" + (tab === key ? " active" : "");
          return '<div class="' + cls + '" data-tab="' + key + '">' + label + (count != null ? ' <span class="count">' + count + '</span>' : '') + '</div>';
        }

        function render() {
          if (!isAdmin) {
            appEl.innerHTML = '<div class="ds-h1" style="margin-bottom:12px">Акции — админка</div><div class="ds-card" style="padding:12px;border-color:#f3c9c9;background:var(--danger-bg);color:var(--danger-text)">У вас нет доступа к этому разделу. Обратитесь к администратору портала, чтобы он выдал вам доступ.</div>';
            return;
          }

          const statusHtml = statusText
            ? '<div style="padding:8px 16px;font-size:12.5px;color:' + (statusKind === "error" ? "var(--danger-text)" : statusKind === "ok" ? "var(--success)" : "var(--text-secondary)") + '">' + escapeHtml(statusText) + "</div>"
            : "";

          const tabsHtml = isPortalAdmin
            ? '<div class="ds-tabbar">' + tabHtml("catalog", "Каталог акций", catalog.length) + tabHtml("access", "Доступ") + tabHtml("directories", "Справочники") + '</div>'
            : "";

          let bodyHtml = "";
          if (tab === "access" && isPortalAdmin) bodyHtml = accessTabHtml();
          else if (tab === "directories" && isPortalAdmin) bodyHtml = directoriesTabHtml();
          else bodyHtml = catalogTabHtml();

          appEl.innerHTML = \`
            <div class="ds-card" style="overflow:hidden">
              \${tabsHtml}
              \${statusHtml}
              \${bodyHtml}
            </div>
          \`;

          appEl.querySelectorAll("[data-tab]").forEach((el) => el.addEventListener("click", (e) => { tab = e.currentTarget.getAttribute("data-tab"); render(); }));
          wireCatalogTab();
          wireAccessTab();
          wireDirectoriesTab();
        }

        function matchesFilter(r) {
          if (statusFilter && computeStatus(r).kind !== statusFilter) return false;
          if (!filterText) return true;
          const q = filterText.toLowerCase();
          const hay = [r.id, r.brand, r.type, r.title, r.description, (r.cities || []).join(" ")].join(" ").toLowerCase();
          return hay.indexOf(q) !== -1;
        }

        function citiesChipHtml(cities) {
          if (!cities || !cities.length) return '<span class="ds-muted">—</span>';
          if (cities.includes("Все")) return '<span class="ds-chip ds-chip-accent">Все города</span>';
          const rest = cities.length > 1 ? ' <span style="font-size:11.5px;color:var(--accent);font-weight:600">+' + (cities.length - 1) + '</span>' : "";
          return '<span class="ds-chip ds-chip-accent">' + escapeHtml(cities[0]) + '</span>' + rest;
        }
        function placementsChipHtml(placements) {
          if (!placements || !placements.length) return '<span class="ds-muted">—</span>';
          const shown = placements.slice(0, 2).map((p) => '<span class="ds-chip ds-chip-neutral">' + escapeHtml(p) + '</span>').join(" ");
          const rest = placements.length > 2 ? ' <span style="font-size:11px;color:var(--text-secondary)">+' + (placements.length - 2) + '</span>' : "";
          return shown + rest;
        }

        function catalogTabHtml() {
          const visible = catalog.filter(matchesFilter);
          const dirtyCount = dirtyRows.size;

          const drawerHtml = drawerDraft ? drawerHtmlFor(drawerDraft) : "";

          return \`
            <div class="toolbar">
              <input id="filterInput" type="text" class="ds-input" style="width:220px" placeholder="Поиск: бренд, название, город…" value="\${escapeHtml(filterText)}"/>
              <select id="statusFilterSel" class="ds-select" style="width:auto">
                <option value="">Статус: все</option>
                <option value="active" \${statusFilter === "active" ? "selected" : ""}>Активна</option>
                <option value="permanent" \${statusFilter === "permanent" ? "selected" : ""}>Постоянная</option>
                <option value="expiring" \${statusFilter === "expiring" ? "selected" : ""}>Истекает</option>
                <option value="expired" \${statusFilter === "expired" ? "selected" : ""}>Истекла</option>
                <option value="off" \${statusFilter === "off" ? "selected" : ""}>Выключена</option>
              </select>
              <div style="flex:1"></div>
              <button id="resyncBtn" type="button" class="ds-btn ds-btn-plain">Синхронизировать справочники</button>
              <button id="addRowBtn" type="button" class="ds-btn ds-btn-outline">+ Акция</button>
              <button id="saveAllBtn" type="button" class="ds-btn ds-btn-primary" \${dirtyCount ? "" : "disabled"}>Сохранить \${dirtyCount ? '<span class="ds-btn-badge">' + dirtyCount + '</span>' : ""}</button>
            </div>
            <div class="split">
              <div class="table-scroll">
                <table class="ds-table">
                  <thead>
                    <tr>
                      <th style="width:36px">Вкл</th>
                      <th style="width:120px">Статус</th>
                      <th>Акция</th>
                      <th style="width:150px">Города</th>
                      <th style="width:84px">С</th>
                      <th style="width:84px">По</th>
                      <th style="width:70px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    \${visible.map((r) => catalogRowHtml(r)).join("") || '<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted)">Ничего не найдено</td></tr>'}
                  </tbody>
                </table>
              </div>
              \${drawerHtml}
            </div>
            \${dirtyCount ? \`
              <div class="ds-unsaved-bar">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--warning)"></span>
                <span style="font-size:12.5px;color:var(--warning-text);font-weight:600">\${dirtyCount} \${dirtyCount === 1 ? "акция" : "акции"} с несохранёнными изменениями</span>
                <span style="font-size:12px;color:#a8894f">\${Array.from(dirtyRows).join(", ")}</span>
                <div style="flex:1"></div>
                <button id="discardAllBtn" type="button" class="ds-btn-text">Отменить всё</button>
                <button id="saveAllBtn2" type="button" class="ds-btn ds-btn-primary">Сохранить \${dirtyCount}</button>
              </div>
            \` : ""}
            <div style="padding:8px 16px;font-size:11.5px;color:var(--text-muted)">Показано \${visible.length} из \${catalog.length}</div>
          \`;
        }

        function catalogRowHtml(r) {
          const key = rowKey(r);
          const isDirty = dirtyRows.has(key);
          const isSelected = drawerRowKey === key;
          const status = computeStatus(r);
          const meta = [r.brand, r.type, r.department].filter(Boolean).join(" · ");
          return \`
            <tr class="\${isDirty ? "dirty" : ""} \${isSelected ? "selected" : ""}" data-key="\${escapeHtml(key)}">
              <td><span class="ds-switch \${r.active ? "on" : ""}" data-act="toggle-active" data-key="\${escapeHtml(key)}"><span class="knob"></span></span></td>
              <td>\${statusPillHtml(status)}\${isDirty ? '<div class="ds-mono">не сохр.</div>' : ""}</td>
              <td>
                <div style="font-size:13px;font-weight:600;color:\${status.kind === "off" || status.kind === "expired" ? "var(--text-secondary)" : "var(--text)"};max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${escapeHtml(r.title || "(без названия)")}</div>
                <div style="font-size:11.5px;color:var(--text-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${meta ? escapeHtml(meta) : '<span class="ds-muted" style="font-style:italic">без деталей</span>'}</div>
              </td>
              <td>\${citiesChipHtml(r.cities)}</td>
              <td><input type="date" class="ds-input-quiet" data-act="edit-date-start" data-key="\${escapeHtml(key)}" value="\${escapeHtml(r.periodStart || "")}"/></td>
              <td><input type="date" class="ds-input-quiet" data-act="edit-date-end" data-key="\${escapeHtml(key)}" value="\${escapeHtml(r.periodEnd || "")}"/></td>
              <td style="text-align:right;white-space:nowrap">
                <span data-act="duplicate-row" data-key="\${escapeHtml(key)}" style="font-size:12px;color:var(--text-secondary);cursor:pointer;margin-right:10px" title="Создать новую акцию на основе этой">Копировать</span>
                <span data-act="open-drawer" data-key="\${escapeHtml(key)}" style="font-size:12px;color:var(--accent);cursor:pointer">Открыть</span>
              </td>
            </tr>\`;
        }

        function drawerHtmlFor(draft) {
          const isNew = !draft.id;
          const brands = brandOptions(), types = typeOptions(), depts = departmentOptions(), placements = placementOptions(), cities = cityOptions();
          const brandOpts = ['']
            .concat(brands.indexOf(draft.brand) === -1 && draft.brand ? [draft.brand] : [])
            .concat(brands)
            .map((b) => '<option value="' + escapeHtml(b) + '" ' + (b === (draft.brand || "") ? "selected" : "") + '>' + (b || "— выберите —") + '</option>').join("");
          const typeOpts = ['']
            .concat(types.indexOf(draft.type) === -1 && draft.type ? [draft.type] : [])
            .concat(types)
            .map((t) => '<option value="' + escapeHtml(t) + '" ' + (t === (draft.type || "") ? "selected" : "") + '>' + (t || "— выберите —") + '</option>').join("");

          const citySet = new Set(draft.cities || []);
          const cityChips = (draft.cities || []).map((c) => '<span class="ds-chip ds-chip-accent">' + escapeHtml(c) + ' <span class="ds-chip-remove" data-act="city-remove" data-city="' + escapeHtml(c) + '">×</span></span>').join("");
          const cityPickerOptions = ["Все"].concat(cities).map((c) =>
            '<label style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;cursor:pointer;font-size:12.5px" onmouseover="this.style.background=\\'#fafbfc\\'" onmouseout="this.style.background=\\'\\'">' +
              '<input type="checkbox" class="drawer-city-check" value="' + escapeHtml(c) + '" ' + (citySet.has(c) ? "checked" : "") + '/> ' + escapeHtml(c) +
            '</label>'
          ).join("");

          const placementSet = new Set(draft.placements || []);
          const placementChips = placements.map((p) =>
            '<span class="ds-toggle-chip ' + (placementSet.has(p) ? "on" : "") + '" data-act="placement-toggle" data-val="' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>'
          ).join("");

          return \`
            <div class="ds-drawer">
              <div class="ds-drawer-header">
                <div style="font-size:13.5px;font-weight:700;color:var(--text)">\${isNew ? "Новая акция" : "Редактирование акции"}</div>
                \${draft.id ? '<span class="ds-mono">' + escapeHtml(draft.id) + '</span>' : ''}
                <div style="flex:1"></div>
                <span class="ds-close" data-act="drawer-close">✕</span>
              </div>
              <div class="ds-drawer-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div><div class="ds-label">Бренд</div><select id="drawerBrand" class="ds-select">\${brandOpts}</select></div>
                  <div><div class="ds-label">Тип акции</div><select id="drawerType" class="ds-select">\${typeOpts}</select></div>
                </div>
                <div><div class="ds-label">Название</div><input id="drawerTitle" class="ds-input" value="\${escapeHtml(draft.title || "")}"/></div>
                <div><div class="ds-label">Описание</div><textarea id="drawerDescription" class="ds-textarea" style="height:56px">\${escapeHtml(draft.description || "")}</textarea></div>
                <div>
                  <div class="ds-label">Города</div>
                  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px;border:1px solid var(--border-input);border-radius:4px">
                    \${cityChips}
                    <details class="ds-city-picker" style="position:relative">
                      <summary style="font-size:12px;color:var(--accent)">+ город</summary>
                      <div style="position:absolute;z-index:20;margin-top:4px;max-height:220px;overflow:auto;width:220px;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px">\${cityPickerOptions}</div>
                    </details>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div><div class="ds-label">Действует с</div><input id="drawerPeriodStart" type="date" class="ds-input" value="\${escapeHtml(draft.periodStart || "")}"/></div>
                  <div><div class="ds-label">По</div><input id="drawerPeriodEnd" type="date" class="ds-input" value="\${escapeHtml(draft.periodEnd || "")}"/></div>
                </div>
                <div>
                  <div class="ds-label">Размещения</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">\${placementChips}</div>
                </div>
                <div><div class="ds-label">Отдел</div><input id="drawerDepartment" class="ds-input" list="deptOptionsList" value="\${escapeHtml(draft.department || "")}"/>
                  <datalist id="deptOptionsList">\${depts.map((d) => '<option value="' + escapeHtml(d) + '">').join("")}</datalist>
                </div>
              </div>
              <div class="ds-drawer-footer">
                <button data-act="drawer-apply" type="button" class="ds-btn ds-btn-primary">Применить</button>
                <button data-act="drawer-cancel" type="button" class="ds-btn ds-btn-plain">Отменить</button>
                <div style="flex:1"></div>
                \${!isNew ? '<button data-act="drawer-delete" type="button" class="ds-btn-danger-text">Удалить</button>' : ""}
              </div>
            </div>
          \`;
        }

        function openDrawer(row) {
          drawerRowKey = rowKey(row);
          drawerDraft = JSON.parse(JSON.stringify(row));
          render();
        }
        function openDrawerNew() {
          drawerRowKey = "__new";
          drawerDraft = blankPromo();
          render();
        }
        function duplicateRow(row) {
          const draft = JSON.parse(JSON.stringify(row));
          draft.id = "";
          draft.sort = catalog.length;
          drawerRowKey = "__new";
          drawerDraft = draft;
          render();
        }
        function closeDrawer() { drawerRowKey = null; drawerDraft = null; render(); }

        function wireCatalogTab() {
          const filterInput = document.getElementById("filterInput");
          if (filterInput) {
            filterInput.addEventListener("input", (e) => { filterText = e.target.value; render(); });
            filterInput.focus();
            filterInput.selectionStart = filterInput.selectionEnd = filterInput.value.length;
          }
          const statusFilterSel = document.getElementById("statusFilterSel");
          if (statusFilterSel) statusFilterSel.addEventListener("change", (e) => { statusFilter = e.target.value; render(); });

          const resyncBtn = document.getElementById("resyncBtn");
          if (resyncBtn) resyncBtn.addEventListener("click", resyncFields);
          const addRowBtn = document.getElementById("addRowBtn");
          if (addRowBtn) addRowBtn.addEventListener("click", openDrawerNew);
          ["saveAllBtn", "saveAllBtn2"].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener("click", saveAllDirty); });
          const discardAllBtn = document.getElementById("discardAllBtn");
          if (discardAllBtn) discardAllBtn.addEventListener("click", discardAllDirty);

          appEl.querySelectorAll('[data-act="toggle-active"]').forEach((el) => el.addEventListener("click", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            const row = catalog.find((r) => rowKey(r) === key);
            if (!row) return;
            row.active = !row.active;
            dirtyRows.add(key);
            render();
          }));
          appEl.querySelectorAll('[data-act="edit-date-start"]').forEach((el) => el.addEventListener("change", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            const row = catalog.find((r) => rowKey(r) === key);
            if (!row) return;
            row.periodStart = e.currentTarget.value || null;
            dirtyRows.add(key);
            render();
          }));
          appEl.querySelectorAll('[data-act="edit-date-end"]').forEach((el) => el.addEventListener("change", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            const row = catalog.find((r) => rowKey(r) === key);
            if (!row) return;
            row.periodEnd = e.currentTarget.value || null;
            dirtyRows.add(key);
            render();
          }));
          appEl.querySelectorAll('[data-act="open-drawer"]').forEach((el) => el.addEventListener("click", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            const row = catalog.find((r) => rowKey(r) === key);
            if (row) openDrawer(row);
          }));
          appEl.querySelectorAll('[data-act="duplicate-row"]').forEach((el) => el.addEventListener("click", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            const row = catalog.find((r) => rowKey(r) === key);
            if (row) duplicateRow(row);
          }));

          if (drawerDraft) wireDrawer();
        }

        function wireDrawer() {
          const brandEl = document.getElementById("drawerBrand");
          if (brandEl) brandEl.addEventListener("change", (e) => { drawerDraft.brand = e.target.value; });
          const typeEl = document.getElementById("drawerType");
          if (typeEl) typeEl.addEventListener("change", (e) => { drawerDraft.type = e.target.value; });
          const titleEl = document.getElementById("drawerTitle");
          if (titleEl) titleEl.addEventListener("input", (e) => { drawerDraft.title = e.target.value; });
          const descEl = document.getElementById("drawerDescription");
          if (descEl) descEl.addEventListener("input", (e) => { drawerDraft.description = e.target.value; });
          const startEl = document.getElementById("drawerPeriodStart");
          if (startEl) startEl.addEventListener("change", (e) => { drawerDraft.periodStart = e.target.value || null; });
          const endEl = document.getElementById("drawerPeriodEnd");
          if (endEl) endEl.addEventListener("change", (e) => { drawerDraft.periodEnd = e.target.value || null; });
          const deptEl = document.getElementById("drawerDepartment");
          if (deptEl) deptEl.addEventListener("input", (e) => { drawerDraft.department = e.target.value; });

          appEl.querySelectorAll('[data-act="city-remove"]').forEach((el) => el.addEventListener("click", (e) => {
            const city = e.currentTarget.getAttribute("data-city");
            drawerDraft.cities = (drawerDraft.cities || []).filter((c) => c !== city);
            render();
          }));
          appEl.querySelectorAll(".drawer-city-check").forEach((el) => el.addEventListener("change", (e) => {
            const val = e.target.value;
            const set = new Set(drawerDraft.cities || []);
            if (e.target.checked) set.add(val); else set.delete(val);
            drawerDraft.cities = Array.from(set);
            render();
          }));
          appEl.querySelectorAll('[data-act="placement-toggle"]').forEach((el) => el.addEventListener("click", (e) => {
            const val = e.currentTarget.getAttribute("data-val");
            const set = new Set(drawerDraft.placements || []);
            if (set.has(val)) set.delete(val); else set.add(val);
            drawerDraft.placements = Array.from(set);
            render();
          }));

          const applyBtn = document.querySelector('[data-act="drawer-apply"]');
          if (applyBtn) applyBtn.addEventListener("click", () => {
            const key = drawerRowKey;
            if (key === "__new") {
              catalog.push(drawerDraft);
            } else {
              const idx = catalog.findIndex((r) => rowKey(r) === key);
              if (idx !== -1) catalog[idx] = drawerDraft;
            }
            dirtyRows.add(rowKey(drawerDraft));
            drawerRowKey = null; drawerDraft = null;
            render();
          });
          const cancelBtn = document.querySelector('[data-act="drawer-cancel"]');
          if (cancelBtn) cancelBtn.addEventListener("click", closeDrawer);
          const closeBtn = document.querySelector('[data-act="drawer-close"]');
          if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
          const deleteBtn = document.querySelector('[data-act="drawer-delete"]');
          if (deleteBtn) deleteBtn.addEventListener("click", () => deleteRow(drawerDraft.id));
        }

        function accessTabHtml() {
          return \`
            <div style="padding:16px;max-width:560px">
              <div class="ds-h1" style="margin-bottom:4px">Доступ к админке</div>
              <p class="ds-muted" style="margin:0 0 12px">Выдайте доступ конкретному сотруднику, не делая его полным администратором портала Bitrix24.</p>
              <div style="display:flex;gap:8px;margin-bottom:12px">
                <input type="text" id="accessQuery" class="ds-input" placeholder="Имя или email сотрудника…" value="\${escapeHtml(accessQuery)}"/>
                <button id="accessSearchBtn" type="button" class="ds-btn ds-btn-plain">Найти</button>
              </div>
              \${userSearchResults.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
                userSearchResults.map((u) => '<button type="button" class="add-access-btn ds-btn" style="background:var(--success-bg);color:var(--success);border:1px solid #cdeedb" data-uid="' + u.userId + '" data-name="' + escapeHtml(u.name) + '">+ ' + escapeHtml(u.name) + '</button>').join("") +
                '</div>' : ""}
              <table style="width:100%;font-size:12.5px;border-collapse:collapse">
                <thead><tr style="text-align:left;color:var(--text-secondary)"><th style="padding:4px 0">Пользователь</th><th style="width:70px">ID</th><th style="width:40px"></th></tr></thead>
                <tbody>
                  \${accessUsers.length ? accessUsers.map((u) => \`
                    <tr style="border-top:1px solid var(--border)"><td style="padding:6px 0">\${escapeHtml(u.name)}</td><td>\${u.userId}</td>
                      <td><button type="button" class="remove-access-btn ds-btn-danger-text" data-uid="\${u.userId}">✕</button></td></tr>
                  \`).join("") : '<tr><td colspan="3" style="padding:8px 0;color:var(--text-muted)">Пока никому, кроме админов портала, доступ не выдан.</td></tr>'}
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
            <div class="ds-card" style="padding:14px">
              <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">\${title}</div>
              <p class="ds-muted" style="margin:0 0 10px">\${configured}</p>
              \${discoveredLists.length ? '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">' + discoveredLists.map((l) =>
                '<div style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:6px;padding:8px;font-size:12px">' +
                  '<div>' + escapeHtml(l.NAME) + ' <span class="ds-muted">(type=' + escapeHtml(l.IBLOCK_TYPE_ID) + ', id=' + escapeHtml(l.IBLOCK_ID) + ')</span></div>' +
                  '<button type="button" class="sync-list-btn ds-btn ds-btn-primary" data-kind="' + kind + '" data-type="' + escapeHtml(l.IBLOCK_TYPE_ID) + '" data-id="' + escapeHtml(l.IBLOCK_ID) + '">Использовать</button>' +
                '</div>').join("") + '</div>' : ""}
              \${cfg.entries.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + cfg.entries.slice(0, 40).map((e) =>
                '<span class="ds-chip ds-chip-neutral">' + escapeHtml(e.name) + '</span>').join("") + '</div>' : ""}
            </div>\`;
        }

        function manualDirectorySectionHtml(kind, title, cfg) {
          const chips = cfg.entries.map((e) =>
            '<span class="ds-chip ds-chip-neutral">' + escapeHtml(e.name) +
              ' <span class="ds-chip-remove manual-remove-btn" data-kind="' + kind + '" data-id="' + escapeHtml(e.externalId) + '">×</span></span>'
          ).join("");
          return \`
            <div class="ds-card" style="padding:14px">
              <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">\${title}</div>
              <p class="ds-muted" style="margin:0 0 10px">Свой список значений (без привязки к «Спискам» Битрикс24) — добавляйте и убирайте прямо здесь.</p>
              <div style="display:flex;gap:8px;margin-bottom:10px">
                <input type="text" id="manualAddInput_\${kind}" class="ds-input" placeholder="Новое значение…"/>
                <button type="button" class="ds-btn ds-btn-outline manual-add-btn" data-kind="\${kind}">Добавить</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">\${chips || '<span class="ds-muted">Пока пусто — используются значения из уже введённых акций.</span>'}</div>
            </div>\`;
        }

        function directoriesTabHtml() {
          return \`
            <div style="padding:16px">
              <button id="discoverBtn" type="button" class="ds-btn ds-btn-plain" style="margin-bottom:12px">Найти списки в Битрикс24</button>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                \${directorySectionHtml("city", "Города", cityConfig)}
                \${directorySectionHtml("direction", "Направления продаж", directionConfig)}
                \${manualDirectorySectionHtml("placement", "Размещения", placementConfig)}
                \${manualDirectorySectionHtml("type", "Типы акций", typeConfig)}
              </div>
            </div>
          \`;
        }

        function wireDirectoriesTab() {
          const discoverBtn = document.getElementById("discoverBtn");
          if (discoverBtn) discoverBtn.addEventListener("click", discoverDirectoryLists);
          appEl.querySelectorAll(".sync-list-btn").forEach((el) => el.addEventListener("click", (e) =>
            syncDirectory(e.currentTarget.getAttribute("data-kind"), e.currentTarget.getAttribute("data-type"), e.currentTarget.getAttribute("data-id"))));
          appEl.querySelectorAll(".manual-add-btn").forEach((el) => el.addEventListener("click", (e) => {
            const kind = e.currentTarget.getAttribute("data-kind");
            const input = document.getElementById("manualAddInput_" + kind);
            const value = input ? input.value : "";
            addManualEntry(kind, value);
          }));
          appEl.querySelectorAll(".manual-remove-btn").forEach((el) => el.addEventListener("click", (e) =>
            removeManualEntry(e.currentTarget.getAttribute("data-kind"), e.currentTarget.getAttribute("data-id"))));
        }

        loadAll().then(render);
      })();
    </script>
  </body>
</html>`;
}
