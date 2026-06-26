/* ПУХ · Режим А — глубокая проверка валидной сид по всем путям + активность.
   Деривация: PUHPATHS (сверено с bip_utils). Активность: blockchair (UTXO) + EVM RPC. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return ("" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---------- активность ----------
  function blockchair(chain, addr) {
    return fetch("https://api.blockchair.com/" + chain + "/dashboards/address/" + addr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var a = (((d.data || {})[addr]) || {}).address || {};
        var bal = a.balance || 0, recv = a.received || 0, txn = a.transaction_count || 0;
        return { bal: (bal / 1e8).toFixed(8), received: (recv / 1e8).toFixed(8), txn: txn,
                 alive: bal > 0 || recv > 0 || txn > 0 };
      }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false, err: true }; });
  }
  var EVM = [
    { name: "ETH", rpc: "https://eth.llamarpc.com" },
    { name: "BSC", rpc: "https://bsc-dataseed.binance.org" },
    { name: "Polygon", rpc: "https://polygon-rpc.com" }
  ];
  function rpc(url, method, params) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d.result; });
  }
  function evmOne(addr, rpcUrl, name) {
    return Promise.all([rpc(rpcUrl, "eth_getBalance", [addr, "latest"]), rpc(rpcUrl, "eth_getTransactionCount", [addr, "latest"])])
      .then(function (a) {
        var wei = a[0] ? parseInt(a[0], 16) : 0, nonce = a[1] ? parseInt(a[1], 16) : 0;
        return { chain: name, wei: wei, nonce: nonce, alive: wei > 0 || nonce > 0 };
      }).catch(function () { return { chain: name, wei: 0, nonce: 0, alive: false, err: true }; });
  }
  function evmAll(addr) {
    return Promise.all(EVM.map(function (c) { return evmOne(addr, c.rpc, c.name); })).then(function (rs) {
      var alive = rs.some(function (x) { return x.alive; });
      var hits = rs.filter(function (x) { return x.alive; }).map(function (x) { return x.chain; }).join(", ");
      var wei = rs.reduce(function (s, x) { return s + (x.wei || 0); }, 0);
      var nonce = rs.reduce(function (s, x) { return s + (x.nonce || 0); }, 0);
      return { bal: (wei / 1e18).toFixed(6), received: "—", txn: nonce, alive: alive, chains: hits };
    });
  }
  function etcOne(addr) {
    return evmOne(addr, "https://etc.rivet.link", "ETC").then(function (r) {
      return { bal: (r.wei / 1e18).toFixed(6), received: "—", txn: r.nonce, alive: r.alive, chains: r.alive ? "ETC" : "" };
    }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false }; });
  }
  function checkAct(r) {
    if (r.chain === "evm") return evmAll(r.addr);
    if (r.chain === "ethereum-classic") return etcOne(r.addr);
    return blockchair(r.chain, r.addr);
  }

  // ---------- рендер ----------
  function render(rows) {
    var coins = ["BTC", "LTC", "DOGE", "DASH", "ETH", "ETC"], html = "";
    coins.forEach(function (coin) {
      var rs = rows.filter(function (r) { return r.coin === coin; });
      if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + coin + (coin === "ETH" ? " · EVM (ETH/BSC/Polygon)" : "") + "</div>";
      rs.forEach(function (r) {
        var a = r.act || {}, alive = a.alive;
        var balTxt = a.bal == null ? "…" : (esc(a.bal) + (a.received && a.received !== "—" && a.received !== a.bal ? " (получено " + esc(a.received) + ")" : ""));
        var flag = a.bal == null ? "…" : alive
          ? "● ЖИВОЙ" + (a.chains ? " [" + esc(a.chains) + "]" : "") + (a.txn ? " тx" + a.txn : "")
          : "пусто";
        html += '<div class="addr-row' + (alive ? " alive" : "") + '">' +
          '<span class="ar-std">' + esc(r.std) + '<br><span style="opacity:.6">' + esc(r.path) + "</span></span>" +
          '<span class="ar-addr">' + (r.addr ? esc(r.addr) : "—") + "</span>" +
          '<span class="ar-bal">' + balTxt + "</span>" +
          '<span class="ar-flag ' + (a.bal == null ? "empty" : alive ? "alive" : "empty") + '">' + flag + "</span></div>";
      });
      html += "</div>";
    });
    $("report").innerHTML = html;
  }

  // ---------- запуск ----------
  function run() {
    var C = window.PUHCORE, P = window.PUHPATHS;
    var m = ($("seed").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var v = C.validateWords(m);
    if (v.checksum !== true) {
      $("seed-status").className = "vstatus red";
      $("seed-status").textContent = "✗ фраза невалидна (" + v.msg + ") — Режим А только для валидных сид.";
      return;
    }
    $("seed-status").className = "vstatus green";
    $("seed-status").textContent = "✓ фраза валидна — проверяю все пути";
    var btn = $("run"); btn.disabled = true; btn.textContent = "⏳ ПРОВЕРКА…";
    $("summary").innerHTML = ""; $("report").innerHTML = "";

    var rows = P.matrix();
    rows.forEach(function (r) { r.addr = P.deriveOne(r, m); });
    render(rows);
    var i = 0, hits = 0;
    function next() {
      if (i >= rows.length) {
        btn.disabled = false; btn.textContent = "▶ ПРОВЕРИТЬ ВСЕ ПУТИ";
        $("scanline").textContent = "";
        $("summary").className = "summary " + (hits ? "hit" : "miss");
        $("summary").innerHTML = hits
          ? "● НАЙДЕНА АКТИВНОСТЬ на " + hits + " адрес(ах) — сид ЖИВАЯ. См. подсвеченные строки."
          : "○ Активности (баланс/история) по " + rows.length + " проверенным путям не найдено.";
        return;
      }
      var r = rows[i];
      $("scanline").textContent = "проверка " + (i + 1) + "/" + rows.length + " · " + r.coin + " " + r.std + " · " + (r.addr || "—");
      if (!r.addr) { i++; return setTimeout(next, 5); }
      checkAct(r).then(function (a) {
        r.act = a; if (a.alive) hits++;
        render(rows); i++; setTimeout(next, 220);
      }).catch(function () { i++; setTimeout(next, 220); });
    }
    next();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var ta = $("seed");
    ta.addEventListener("input", function () {
      var C = window.PUHCORE; if (!C) return;
      var el = $("seed-status");
      if (!ta.value.trim()) { el.className = "vstatus muted"; el.textContent = "введите сид-фразу"; return; }
      var v = C.validateWords((ta.value || "").trim().toLowerCase());
      el.className = "vstatus " + v.level; el.textContent = v.msg;
    });
    $("run").addEventListener("click", run);
  });
})();
