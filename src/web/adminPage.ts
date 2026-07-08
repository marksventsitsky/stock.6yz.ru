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
      :root { color-scheme: light; }
      body { margin:0; font: 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; background:#fafafa; color:#111827; }
      .wrap { padding: 16px; max-width: 1400px; margin: 0 auto; }
      h1 { font-size:18px; margin: 0 0 12px 0; }
      .bar { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
      .bar .spacer { flex:1; }
      button { border: 1px solid #d1d5db; background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }
      button.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
      button.danger { background:#dc2626; border-color:#dc2626; color:#fff; }
      button:disabled { opacity:.6; cursor:not-allowed; }
      table { width:100%; border-collapse: collapse; background:#fff; }
      th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size:12px; }
      th { text-align:left; color:#374151; background:#f3f4f6; position:sticky; top:0; }
      input[type="text"], input[type="date"], textarea { width:100%; border:1px solid #d1d5db; border-radius:6px; padding:4px 6px; font: inherit; box-sizing:border-box; }
      textarea { resize: vertical; min-height: 34px; }
      input[type="checkbox"] { width:16px; height:16px; }
      .muted { color:#6b7280; font-size:12px; }
      .error { color:#b91c1c; }
      .ok { color:#166534; }
      .row-actions { display:flex; gap:4px; }
      .badge { display:inline-block; padding:2px 6px; border-radius:6px; background:#eef2ff; color:#3730a3; font-size:11px; }
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

        function escapeHtml(s) {
          return String(s ?? "")
            .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
        }
        function showFatal(title, detail) {
          appEl.innerHTML = '<div class="error"><b>' + escapeHtml(title) + '</b><pre style="white-space:pre-wrap;">' + escapeHtml(String(detail)) + '</pre></div>';
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
        let statusText = "", statusKind = "";

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
            }
            setStatus("", "");
          } catch (e) {
            setStatus("error", "Ошибка загрузки: " + (e && e.message ? e.message : String(e)));
          }
        }

        let accessQuery = "";

        async function searchUsers() {
          const a = auth();
          try {
            const res = await api("/api/admin/access/search", { method: "POST", body: { ...a, query: accessQuery } });
            userSearchResults = res.users || [];
            render();
          } catch (e) {
            setStatus("error", "Ошибка поиска: " + (e && e.message ? e.message : String(e)));
          }
        }

        async function addAccessUser(userId, name) {
          const a = auth();
          setStatus("muted", "Добавление доступа…");
          try {
            await api("/api/admin/access/add", { method: "POST", body: { ...a, userId, name } });
            userSearchResults = [];
            accessQuery = "";
            setStatus("ok", "Доступ выдан");
            await loadAll();
          } catch (e) {
            setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e)));
          }
        }

        async function removeAccessUser(userId) {
          if (!confirm("Забрать доступ у этого пользователя?")) return;
          const a = auth();
          setStatus("muted", "Удаление доступа…");
          try {
            await api("/api/admin/access/remove", { method: "POST", body: { ...a, userId } });
            setStatus("ok", "Доступ отозван");
            await loadAll();
          } catch (e) {
            setStatus("error", "Ошибка: " + (e && e.message ? e.message : String(e)));
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
              cities: (row.citiesText || (row.cities || []).join(", ")).split(",").map((s) => s.trim()).filter(Boolean),
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

        let draftNewRow = null;

        function render() {
          const statusHtml = statusText ? '<div class="' + (statusKind === "error" ? "error" : statusKind === "ok" ? "ok" : "muted") + '">' + escapeHtml(statusText) + "</div>" : "";

          if (!isAdmin) {
            appEl.innerHTML = '<h1>Акции — админка</h1><div class="error">У вас нет доступа к этому разделу. Обратитесь к администратору портала, чтобы он выдал вам доступ.</div>' + statusHtml;
            return;
          }

          const rows = draftNewRow ? catalog.concat([draftNewRow]) : catalog;

          const accessHtml = isPortalAdmin ? \`
            <div class="panel" style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:12px;background:#fff;">
              <h3 style="margin:0 0 8px 0;font-size:13px;">Доступ к админке (кроме администраторов портала)</h3>
              <div class="bar">
                <input type="text" id="accessQuery" placeholder="Имя или email сотрудника…" style="max-width:260px;" value="\${escapeHtml(accessQuery)}"/>
                <button id="accessSearchBtn" type="button">Найти</button>
              </div>
              \${userSearchResults.length ? '<div class="muted" style="margin:6px 0;">Результаты поиска:</div><div class="bar">' +
                userSearchResults.map((u) => '<button type="button" class="add-access-btn" data-uid="' + u.userId + '" data-name="' + escapeHtml(u.name) + '">+ ' + escapeHtml(u.name) + '</button>').join("") +
                '</div>' : ""}
              <table style="margin-top:8px;">
                <thead><tr><th>Пользователь</th><th style="width:80px;">ID</th><th style="width:60px;"></th></tr></thead>
                <tbody>
                  \${accessUsers.length ? accessUsers.map((u) => \`
                    <tr><td>\${escapeHtml(u.name)}</td><td>\${u.userId}</td><td><button type="button" class="danger remove-access-btn" data-uid="\${u.userId}">✕</button></td></tr>
                  \`).join("") : '<tr><td colspan="3" class="muted">Пока никому, кроме админов портала, доступ не выдан.</td></tr>'}
                </tbody>
              </table>
            </div>\` : "";

          appEl.innerHTML = \`
            <h1>Каталог акций <span class="badge">\${catalog.length}</span></h1>
            \${accessHtml}
            <div class="bar">
              <button id="addRowBtn" class="primary" type="button">+ Добавить акцию</button>
              <button id="resyncBtn" type="button">Синхронизировать справочники в Bitrix</button>
              <div class="spacer"></div>
              <div class="muted">Изменения тут пишутся в JSON-снапшот и в обычные поля направления/бренда/типа/названия акции на лидах и сделках.</div>
            </div>
            \${statusHtml}
            <table>
              <thead><tr>
                <th style="width:110px;">ID</th>
                <th style="width:110px;">Бренд</th>
                <th style="width:160px;">Города (через запятую, "Все" = все)</th>
                <th style="width:140px;">Тип</th>
                <th style="width:220px;">Название</th>
                <th>Описание</th>
                <th style="width:110px;">C</th>
                <th style="width:110px;">По</th>
                <th style="width:140px;">Размещения</th>
                <th style="width:110px;">Отдел</th>
                <th style="width:50px;">Вкл</th>
                <th style="width:90px;"></th>
              </tr></thead>
              <tbody>
                \${rows.map((r, i) => rowHtml(r, i)).join("")}
              </tbody>
            </table>
          \`;

          document.getElementById("addRowBtn").addEventListener("click", () => { draftNewRow = blankRow(); render(); });
          const resyncBtn = document.getElementById("resyncBtn");
          if (resyncBtn) resyncBtn.addEventListener("click", resyncFields);

          const accessQueryEl = document.getElementById("accessQuery");
          if (accessQueryEl) accessQueryEl.addEventListener("change", (e) => { accessQuery = e.target.value; });
          const accessSearchBtn = document.getElementById("accessSearchBtn");
          if (accessSearchBtn) accessSearchBtn.addEventListener("click", searchUsers);
          appEl.querySelectorAll(".add-access-btn").forEach((el) => {
            el.addEventListener("click", (e) => addAccessUser(Number(e.target.getAttribute("data-uid")), e.target.getAttribute("data-name")));
          });
          appEl.querySelectorAll(".remove-access-btn").forEach((el) => {
            el.addEventListener("click", (e) => removeAccessUser(Number(e.target.getAttribute("data-uid"))));
          });

          rows.forEach((r, i) => {
            const prefix = "row" + i + "_";
            ["id","brand","citiesText","type","title","description","periodStart","periodEnd","placementsText","department"].forEach((k) => {
              const el = document.getElementById(prefix + k);
              if (el) el.addEventListener("change", (e) => { r[k] = e.target.value; });
            });
            const active = document.getElementById(prefix + "active");
            if (active) active.addEventListener("change", (e) => { r.active = e.target.checked; });
            const saveBtn = document.getElementById(prefix + "save");
            if (saveBtn) saveBtn.addEventListener("click", async () => { await saveRow(r); if (r.__new) draftNewRow = null; });
            const delBtn = document.getElementById(prefix + "del");
            if (delBtn) delBtn.addEventListener("click", () => deleteRow(r.id));
          });
        }

        function rowHtml(r, i) {
          const prefix = "row" + i + "_";
          const idField = r.__new
            ? '<input type="text" id="' + prefix + 'id" placeholder="авто" value="' + escapeHtml(r.id || "") + '"/>'
            : escapeHtml(r.id);
          return \`
            <tr>
              <td>\${idField}</td>
              <td><input type="text" id="\${prefix}brand" value="\${escapeHtml(r.brand || "")}"/></td>
              <td><input type="text" id="\${prefix}citiesText" value="\${escapeHtml((r.cities || []).join(", "))}"/></td>
              <td><input type="text" id="\${prefix}type" value="\${escapeHtml(r.type || "")}"/></td>
              <td><textarea id="\${prefix}title">\${escapeHtml(r.title || "")}</textarea></td>
              <td><textarea id="\${prefix}description">\${escapeHtml(r.description || "")}</textarea></td>
              <td><input type="date" id="\${prefix}periodStart" value="\${escapeHtml(r.periodStart || "")}"/></td>
              <td><input type="date" id="\${prefix}periodEnd" value="\${escapeHtml(r.periodEnd || "")}"/></td>
              <td><input type="text" id="\${prefix}placementsText" value="\${escapeHtml((r.placements || []).join(", "))}"/></td>
              <td><input type="text" id="\${prefix}department" value="\${escapeHtml(r.department || "")}"/></td>
              <td style="text-align:center;"><input type="checkbox" id="\${prefix}active" \${r.active ? "checked" : ""}/></td>
              <td class="row-actions">
                <button id="\${prefix}save" class="primary" type="button">💾</button>
                \${r.__new ? "" : '<button id="' + prefix + 'del" class="danger" type="button">✕</button>'}
              </td>
            </tr>\`;
        }

        loadAll().then(render);
      })();
    </script>
  </body>
</html>`;
}
