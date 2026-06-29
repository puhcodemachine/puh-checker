/* ПУХ · Администрация — смена пароля + управление пользователями (серверные роуты).
   На статичном превью (нет /api) мягко сообщает, что доступно только на сервере. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function fmt(ts) { if (!ts) return "—"; var d = new Date(ts * 1000); function p(n) { return (n < 10 ? "0" : "") + n; } return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear(); }
  var me = null;
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }).catch(function () { return { ok: false, status: r.status, j: {} }; }); })
      .catch(function () { return { ok: false, status: 0, j: {} }; });
  }

  window.renderAdmin = function () {
    api("/api/account").then(function (res) {
      if (!res.ok || !res.j || !res.j.user) {
        $("adm-note").classList.remove("hidden");
        $("adm-note").textContent = "⚠ Управление аккаунтами работает только на серверной версии (вход по логину). На статичном превью недоступно.";
        $("adm-whoami").textContent = "";
        $("adm-users-card").classList.add("hidden");
        return;
      }
      $("adm-note").classList.add("hidden");
      me = res.j;
      $("adm-whoami").textContent = "· вы вошли как " + me.user + (me.role === "admin" ? " (главный администратор)" : "");
      if (me.role === "admin") { $("adm-users-card").classList.remove("hidden"); loadUsers(); }
      else $("adm-users-card").classList.add("hidden");
    });
  };
  function loadUsers() {
    api("/api/admin/users").then(function (res) {
      var el = $("users-list"); if (!el) return;
      if (!res.ok) { el.innerHTML = '<div class="ur">не удалось загрузить список</div>'; return; }
      var us = res.j.users || [];
      el.innerHTML = us.map(function (u) {
        return '<div class="urow"><span class="un">' + esc(u.username) + (u.role === "admin" ? '<span class="u-badge">АДМИН</span>' : "") +
          (u.note ? ' <span class="ur">— ' + esc(u.note) + "</span>" : "") + "</span>" +
          '<span class="ut">задач в ветке: ' + (u.tasks || 0) + "</span>" +
          '<span class="ur">' + fmt(u.created) + "</span></div>";
      }).join("");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var pw = $("pw-save");
    if (pw) pw.addEventListener("click", function () {
      var msg = $("pw-msg"); msg.className = "adm-msg";
      var old = $("pw-old").value, n1 = $("pw-new").value, n2 = $("pw-new2").value;
      if (n1 !== n2) { msg.className = "adm-msg err"; msg.textContent = "новые пароли не совпадают"; return; }
      if (n1.length < 8) { msg.className = "adm-msg err"; msg.textContent = "новый пароль слишком короткий (мин. 8 символов)"; return; }
      api("/api/account/password", { method: "POST", body: JSON.stringify({ old: old, new: n1 }) }).then(function (res) {
        if (res.ok) { msg.className = "adm-msg ok"; msg.textContent = "✓ пароль изменён"; $("pw-old").value = $("pw-new").value = $("pw-new2").value = ""; }
        else { msg.className = "adm-msg err"; msg.textContent = "✗ " + ((res.j && res.j.error) || "ошибка (доступно только на сервере)"); }
      });
    });
    var nu = $("nu-save");
    if (nu) nu.addEventListener("click", function () {
      var msg = $("nu-msg"); msg.className = "adm-msg";
      var login = ($("nu-login").value || "").trim(), pass = $("nu-pass").value, note = ($("nu-note").value || "").trim();
      api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: login, password: pass, note: note }) }).then(function (res) {
        if (res.ok) { msg.className = "adm-msg ok"; msg.textContent = "✓ пользователь " + esc(res.j.username) + " создан — отдельная ветка, доступ у PUH"; $("nu-login").value = $("nu-pass").value = $("nu-note").value = ""; loadUsers(); }
        else { msg.className = "adm-msg err"; msg.textContent = "✗ " + ((res.j && res.j.error) || "ошибка"); }
      });
    });
  });
})();
