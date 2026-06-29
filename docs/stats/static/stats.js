/* ПУХ · Статистика — агрегат /api/stats: живость путей, монеты, EVM-сети, общий баланс, топ находок. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmtUsd(n) { n = +n || 0; return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function pct(r) { return (Math.round((+r || 0) * 1000) / 10) + "%"; }
  function explorer(coin, addr) {
    if (coin === "BTC") return "https://mempool.space/address/" + addr;
    if (coin === "LTC") return "https://litecoinspace.org/address/" + addr;
    if (coin === "DOGE") return "https://blockchair.com/dogecoin/address/" + addr;
    if (coin === "DASH") return "https://blockchair.com/dash/address/" + addr;
    if (coin === "ETC") return "https://etc.blockscout.com/address/" + addr;
    return "https://etherscan.io/address/" + addr;
  }

  function cards(d) {
    var t = d.tasks || {}, a = d.addresses || {};
    var items = [
      { n: t.total || 0, l: "ВСЕГО ЗАДАЧ", c: "" },
      { n: a.scanned || 0, l: "АДРЕСОВ ПРОВЕРЕНО", c: "" },
      { n: a.alive || 0, l: "ЖИВЫХ АДРЕСОВ", c: "alive" },
      { n: fmtUsd(d.total_usd), l: "ОБЩИЙ БАЛАНС", c: "usd" },
      { n: (a.scanned ? Math.round(a.alive / a.scanned * 1000) / 10 : 0) + "%", l: "ДОЛЯ ЖИВЫХ", c: "alive" }
    ];
    $("cards").innerHTML = items.map(function (i) {
      return '<div class="stat ' + i.c + '"><div class="n">' + esc(i.n) + '</div><div class="l">' + i.l + "</div></div>";
    }).join("");
  }

  function pathsTable(rows) {
    if (!rows || !rows.length) { $("paths").innerHTML = '<div class="empty">пока нет данных — запусти проверки</div>'; return; }
    var max = rows[0].alive || 1;
    var body = rows.map(function (r) {
      var w = Math.max(2, Math.round((r.alive / max) * 100));
      return "<tr><td><span class='coin'>" + esc(r.coin) + "</span> <span class='std'>" + esc(r.std) + "</span></td>" +
        "<td class='num'>" + r.scanned + "</td>" +
        "<td class='num alive'>" + r.alive + "</td>" +
        "<td><div class='bar'><i style='width:" + w + "%'></i><span>" + pct(r.rate) + "</span></div></td>" +
        "<td class='num amber'>" + fmtUsd(r.usd) + "</td></tr>";
    }).join("");
    $("paths").innerHTML = "<table><thead><tr><th>ПУТЬ</th><th class='num'>ПРОВЕРЕНО</th><th class='num'>ЖИВЫХ</th><th>ЖИВОСТЬ</th><th class='num'>БАЛАНС</th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function coinsTable(rows) {
    if (!rows || !rows.length) { $("coins").innerHTML = '<div class="empty">нет данных</div>'; return; }
    var body = rows.map(function (r) {
      return "<tr><td class='coin'>" + esc(r.coin) + "</td><td class='num'>" + r.scanned + "</td>" +
        "<td class='num alive'>" + r.alive + "</td><td class='num'>" + pct(r.rate) + "</td>" +
        "<td class='num amber'>" + fmtUsd(r.usd) + "</td></tr>";
    }).join("");
    $("coins").innerHTML = "<table><thead><tr><th>МОНЕТА</th><th class='num'>ПРОВЕРЕНО</th><th class='num'>ЖИВЫХ</th><th class='num'>ЖИВОСТЬ</th><th class='num'>БАЛАНС</th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function chainsTable(rows) {
    if (!rows || !rows.length) { $("chains").innerHTML = '<div class="empty">нет EVM-активности</div>'; return; }
    $("chains").innerHTML = "<table><thead><tr><th>СЕТЬ</th><th class='num'>ЖИВЫХ АДРЕСОВ</th></tr></thead><tbody>" +
      rows.map(function (r) { return "<tr><td class='coin'>" + esc(r.chain) + "</td><td class='num alive'>" + r.alive + "</td></tr>"; }).join("") +
      "</tbody></table>";
  }

  function topTable(rows) {
    if (!rows || !rows.length) { $("top").innerHTML = '<div class="empty">находок пока нет</div>'; return; }
    var body = rows.map(function (r) {
      return "<tr><td class='amber'>" + fmtUsd(r.usd) + "</td>" +
        "<td><span class='coin'>" + esc(r.coin) + "</span> " + esc(r.std) + "<br><span class='muted' style='font-size:11px'>" + esc(r.path || "") + "</span></td>" +
        "<td><span class='muted'>" + esc(r.bal) + "</span></td>" +
        "<td class='addr'><a href='" + explorer(r.coin, r.addr) + "' target='_blank' rel='noopener'>" + esc(r.addr) + "</a></td></tr>";
    }).join("");
    $("top").innerHTML = "<table><thead><tr><th>$</th><th>ПУТЬ</th><th>БАЛАНС</th><th>АДРЕС</th></tr></thead><tbody>" + body + "</tbody></table>";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function load() {
    $("upd").textContent = "загрузка…";
    fetch("/api/stats", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        if (!d) {
          $("upd").textContent = "";
          $("cards").innerHTML = "";
          $("paths").innerHTML = '<div class="empty">Статистика собирается на боевом сервере (24/7). В статичном превью данных нет.</div>';
          ["coins", "chains", "top"].forEach(function (id) { $(id).innerHTML = ""; });
          return;
        }
        cards(d); pathsTable(d.by_path); coinsTable(d.by_coin); chainsTable(d.chains); topTable(d.top);
        var t = new Date();
        $("upd").textContent = "обновлено " + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds());
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("refresh").addEventListener("click", load);
    load();
  });
})();
