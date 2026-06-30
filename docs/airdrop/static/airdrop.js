/* ПУХ · Аирдроп — роспись по кошелькам: найденная сумма $ + ссылка на claim/управление, или НЕТ. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmtUsd(n) { n = +n || 0; return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  var DATA = [], filter = "value", search = "", page = 0, PAGE = 100;

  function debank(addr) { return "https://debank.com/profile/" + addr; }

  function cards(d) {
    var items = [
      { n: d.total || 0, l: "ВСЕГО КОШЕЛЬКОВ", c: "" },
      { n: d.with_value || 0, l: "С ЦЕННОСТЬЮ", c: "" },
      { n: fmtUsd(d.total_usd), l: "ОБЩАЯ СУММА К МОНЕТИЗАЦИИ", c: "usd" }
    ];
    $("cards").innerHTML = items.map(function (i) {
      return '<div class="stat ' + i.c + '"><div class="n">' + esc(i.n) + '</div><div class="l">' + i.l + "</div></div>";
    }).join("");
  }

  function filtered() {
    var q = search.trim().toLowerCase();
    return DATA.filter(function (w) {
      if (filter === "value" && !(w.usd > 0)) return false;
      if (q && ("" + w.name).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function holdsText(w) {
    if (!w.top || !w.top.length) return "";
    return w.top.map(function (t) { return esc(t.coin) + " " + fmtUsd(t.usd); }).join(" · ");
  }

  function render() {
    var list = filtered(), el = $("list");
    if (!list.length) { el.innerHTML = '<div class="empty">нет кошельков под фильтр</div>'; $("pager").innerHTML = ""; return; }
    var pages = Math.ceil(list.length / PAGE);
    if (page >= pages) page = 0;
    var slice = list.slice(page * PAGE, page * PAGE + PAGE);
    var rows = slice.map(function (w) {
      var has = w.usd > 0;
      var amount = has ? '<span class="sum">' + fmtUsd(w.usd) + "</span>" : '<span class="no">НЕТ</span>';
      var link = (has && w.addr) ? '<a class="claim" href="' + debank(w.addr) + '" target="_blank" rel="noopener">КЛЕЙМ / ПРОДАТЬ ↗</a>'
        : (has ? '<span class="holds">адрес EVM не найден</span>' : '<span class="no">НЕТ</span>');
      return "<tr><td class='wname'>#" + esc(w.name) + (w.mass ? " <span class='holds'>(масс)</span>" : "") + "</td>" +
        "<td class='num'>" + amount + "</td>" +
        "<td class='holds'>" + holdsText(w) + "</td>" +
        "<td>" + link + "</td></tr>";
    }).join("");
    el.innerHTML = "<table><thead><tr><th>КОШЕЛЁК</th><th class='num'>СУММА</th><th>ЧТО НАЙДЕНО</th><th>ДЕЙСТВИЕ</th></tr></thead><tbody>" + rows + "</tbody></table>";
    var pg = "";
    if (pages > 1) {
      pg = '<button id="pp"' + (page === 0 ? " disabled" : "") + ">&larr;</button>";
      pg += "<span>" + (page + 1) + " / " + pages + " · " + list.length + " кош.</span>";
      pg += '<button id="pn"' + (page >= pages - 1 ? " disabled" : "") + ">&rarr;</button>";
    }
    $("pager").innerHTML = pg;
    if ($("pp")) $("pp").onclick = function () { if (page > 0) { page--; render(); } };
    if ($("pn")) $("pn").onclick = function () { page++; render(); };
  }

  window.setF = function (f) {
    filter = f; page = 0;
    $("f-value").classList.toggle("active", f === "value");
    $("f-all").classList.toggle("active", f === "all");
    render();
  };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function load() {
    $("upd").textContent = "загрузка…";
    fetch("/api/airdrops", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        if (!d) { $("upd").textContent = ""; $("list").innerHTML = '<div class="empty">Данные собираются на сервере. Доступно в боевой панели.</div>'; return; }
        DATA = d.wallets || []; cards(d); render();
        var t = new Date(); $("upd").textContent = "обновлено " + pad(t.getHours()) + ":" + pad(t.getMinutes());
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("search").addEventListener("input", function () { search = this.value; page = 0; render(); });
    $("refresh").addEventListener("click", load);
    load();
  });
})();
