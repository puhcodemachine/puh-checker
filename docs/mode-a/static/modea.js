/* ПУХ · Режим А — глубокая проверка + задачи (сворачивание, авто-проверка 24ч, алерт об изменениях).
   Деривация: PUHPATHS (сверено с bip_utils). Активность: blockchair (UTXO) + EVM RPC. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return ("" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nowSec() { return Date.now() / 1000; }
  function fmtDT(ts) { var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // ---------- активность ----------
  function blockchair(chain, addr) {
    return fetch("https://api.blockchair.com/" + chain + "/dashboards/address/" + addr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var a = (((d.data || {})[addr]) || {}).address || {};
        var bal = a.balance || 0, recv = a.received || 0, txn = a.transaction_count || 0;
        return { bal: (bal / 1e8).toFixed(8), received: (recv / 1e8).toFixed(8), txn: txn, alive: bal > 0 || recv > 0 || txn > 0 };
      }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false, err: true }; });
  }
  var EVM = [{ name: "ETH", rpc: "https://eth.llamarpc.com" }, { name: "BSC", rpc: "https://bsc-dataseed.binance.org" }, { name: "Polygon", rpc: "https://polygon-rpc.com" }];
  function rpc(url, method, params) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d.result; });
  }
  function evmOne(addr, url, name) {
    return Promise.all([rpc(url, "eth_getBalance", [addr, "latest"]), rpc(url, "eth_getTransactionCount", [addr, "latest"])]).then(function (a) {
      var wei = a[0] ? parseInt(a[0], 16) : 0, nonce = a[1] ? parseInt(a[1], 16) : 0;
      return { chain: name, wei: wei, nonce: nonce, alive: wei > 0 || nonce > 0 };
    }).catch(function () { return { chain: name, wei: 0, nonce: 0, alive: false }; });
  }
  function evmAll(addr) {
    return Promise.all(EVM.map(function (c) { return evmOne(addr, c.rpc, c.name); })).then(function (rs) {
      var alive = rs.some(function (x) { return x.alive; }), hits = rs.filter(function (x) { return x.alive; }).map(function (x) { return x.chain; }).join(", ");
      var wei = rs.reduce(function (s, x) { return s + (x.wei || 0); }, 0), nonce = rs.reduce(function (s, x) { return s + (x.nonce || 0); }, 0);
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

  // ---------- рендер отчёта ----------
  function aliveCount(results) { return (results || []).filter(function (r) { return r.alive; }).length; }
  function render(rows) {
    var coins = ["BTC", "LTC", "DOGE", "DASH", "ETH", "ETC"], html = "";
    coins.forEach(function (coin) {
      var rs = rows.filter(function (r) { return r.coin === coin; });
      if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + coin + (coin === "ETH" ? " · EVM (ETH/BSC/Polygon)" : "") + "</div>";
      rs.forEach(function (r) {
        var a = r.act || {}, alive = a.alive;
        var balTxt = a.bal == null ? "…" : esc(a.bal) + (a.received && a.received !== "—" && a.received !== a.bal ? " (получено " + esc(a.received) + ")" : "");
        var flag = a.bal == null ? "…" : alive ? "● ЖИВОЙ" + (a.chains ? " [" + esc(a.chains) + "]" : "") + (a.txn ? " тx" + a.txn : "") : "пусто";
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

  // ---------- скан сид (общий движок: для запуска и для авто-проверки) ----------
  function scanSeed(seed, onProgress) {
    var P = window.PUHPATHS, rows = P.matrix();
    rows.forEach(function (r) { r.addr = P.deriveOne(r, seed); });
    return new Promise(function (resolve) {
      var i = 0;
      function step() {
        if (i >= rows.length) { resolve(rows); return; }
        if (onProgress) onProgress(i, rows.length, rows);
        var r = rows[i];
        if (!r.addr) { i++; return setTimeout(step, 5); }
        checkAct(r).then(function (a) { r.act = a; i++; if (onProgress) onProgress(i, rows.length, rows); setTimeout(step, 220); })
          .catch(function () { i++; setTimeout(step, 220); });
      }
      step();
    });
  }

  // ---------- задачи (localStorage) ----------
  var LS = "puh_modea_tasks", curId = null, lastRows = null;
  function load() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function slim(rows) { return rows.map(function (r) { var a = r.act || {}; return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, bal: a.bal, received: a.received, txn: a.txn, alive: !!a.alive, chains: a.chains || "" }; }); }
  function fatten(results) { return results.map(function (r) { return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, act: { bal: r.bal, received: r.received, txn: r.txn, alive: r.alive, chains: r.chains } }; }); }
  function diff(oldR, newR) {
    var m = {}, ch = []; (oldR || []).forEach(function (r) { m[r.coin + r.path] = r; });
    (newR || []).forEach(function (r) { var o = m[r.coin + r.path]; if (o && (o.alive !== r.alive || o.bal !== r.bal || o.received !== r.received || o.txn !== r.txn)) ch.push(r); });
    return ch;
  }

  function renderTaskList() {
    var tasks = load(), wrap = $("tasks-wrap"), el = $("task-list");
    if (!tasks.length) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    el.innerHTML = tasks.map(function (t) {
      var hits = aliveCount(t.results), dot = t.changed ? "changed" : (hits ? "hit" : "");
      return '<div class="ma-task-row' + (t.changed ? " changed" : "") + (hits ? " hit" : "") + '" onclick="maOpen(\'' + t.id + '\')">' +
        '<span class="mt-dot ' + dot + '"></span>' +
        '<span class="mt-name">' + esc(t.name) + "</span>" +
        '<span class="mt-meta">' + (hits ? "● живых: " + hits : "пусто") + (t.changed ? " · ⚠ ИЗМЕНЕНИЕ" : "") + "</span>" +
        '<span class="mt-when">пров.: ' + fmtDT(t.lastCheck) + "</span>" +
        '<span class="mt-caret">→</span></div>';
    }).join("");
  }
  function showAlert(msg) { var el = $("alert"); el.textContent = msg; el.classList.remove("hidden"); }

  function saveCurrent() {
    if (!lastRows) return;
    var tasks = load();
    var name = ($("name").value || "").trim() || "Задача " + (tasks.length + 1);
    var seed = ($("seed").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var results = slim(lastRows);
    var found = false;
    tasks.forEach(function (t) { if (t.id === curId) { t.name = name; t.seed = seed; t.results = results; t.lastCheck = nowSec(); found = true; } });
    if (!found) { curId = Math.random().toString(16).slice(2, 8); tasks.push({ id: curId, name: name, seed: seed, results: results, created: nowSec(), lastCheck: nowSec(), changed: false }); }
    save(tasks);
  }

  function collapse() {
    saveCurrent();
    $("report").innerHTML = ""; $("summary").innerHTML = ""; $("summary").className = "summary"; $("scanline").textContent = "";
    $("close-task").classList.add("hidden");
    $("name").value = ""; $("seed").value = ""; $("seed-status").className = "vstatus muted"; $("seed-status").textContent = "введите сид-фразу";
    curId = null; lastRows = null;
    renderTaskList(); window.scrollTo(0, 0);
  }

  window.maOpen = function (id) {
    var t = load().filter(function (x) { return x.id === id; })[0]; if (!t) return;
    curId = id;
    $("name").value = t.name; $("seed").value = t.seed;
    $("seed-status").className = "vstatus green"; $("seed-status").textContent = "сохранённая задача · последняя проверка " + fmtDT(t.lastCheck);
    if (t.changed) { var ts = load(); ts.forEach(function (x) { if (x.id === id) x.changed = false; }); save(ts); }
    lastRows = fatten(t.results);
    render(lastRows);
    var hits = aliveCount(t.results);
    $("summary").className = "summary " + (hits ? "hit" : "miss");
    $("summary").innerHTML = (hits ? "● активность на " + hits + " адрес(ах) — сид ЖИВАЯ" : "○ активности не найдено") +
      " · сохранено " + fmtDT(t.lastCheck) + ' · <a href="javascript:void(0)" onclick="maRun(true)" style="color:#3fcf72">▶ проверить снова</a>';
    $("close-task").classList.remove("hidden"); $("alert").classList.add("hidden");
    renderTaskList(); window.scrollTo(0, ($("form-h1") || {}).offsetTop || 0);
  };

  // ---------- запуск проверки ----------
  function run(isRecheck) {
    var C = window.PUHCORE;
    var seed = ($("seed").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var v = C.validateWords(seed);
    if (v.checksum !== true) { $("seed-status").className = "vstatus red"; $("seed-status").textContent = "✗ фраза невалидна (" + v.msg + ")"; return; }
    $("seed-status").className = "vstatus green"; $("seed-status").textContent = "✓ фраза валидна — проверяю все пути";
    var btn = $("run"); btn.disabled = true; btn.textContent = "⏳ ПРОВЕРКА…";
    $("summary").innerHTML = ""; $("report").innerHTML = "";
    scanSeed(seed, function (i, total, rows) { $("scanline").textContent = "проверка " + i + "/" + total; render(rows); })
      .then(function (rows) {
        lastRows = rows; btn.disabled = false; btn.textContent = "▶ ПРОВЕРИТЬ ВСЕ ПУТИ"; $("scanline").textContent = "";
        var hits = aliveCount(slim(rows));
        var changeNote = "";
        if (isRecheck && curId) {
          var old = load().filter(function (x) { return x.id === curId; })[0];
          var ch = old ? diff(old.results, slim(rows)) : [];
          saveCurrent();
          if (ch.length) { var ts = load(); ts.forEach(function (x) { if (x.id === curId) x.changed = true; }); save(ts); var nm = ($("name").value || "задача"); showAlert("⚠ Изменение в задаче «" + nm + "»: " + ch.length + " адрес(ов) обновилось."); changeNote = " · ⚠ есть изменения!"; }
          else changeNote = " · изменений нет";
        }
        $("summary").className = "summary " + (hits ? "hit" : "miss");
        $("summary").innerHTML = (hits ? "● НАЙДЕНА АКТИВНОСТЬ на " + hits + " адрес(ах) — сид ЖИВАЯ." : "○ Активности по " + rows.length + " путям не найдено.") + changeNote;
        $("close-task").classList.remove("hidden");
        renderTaskList();
      });
  }
  window.maRun = run;

  // ---------- авто-проверка раз в 24ч (когда страница открыта) ----------
  function dueCheck() {
    var tasks = load().filter(function (t) { return nowSec() - (t.lastCheck || 0) > 86400; });
    if (!tasks.length) return;
    var i = 0;
    function nextTask() {
      if (i >= tasks.length) { renderTaskList(); return; }
      var t = tasks[i];
      scanSeed(t.seed, null).then(function (rows) {
        var ch = diff(t.results, slim(rows));
        var all = load();
        all.forEach(function (x) { if (x.id === t.id) { x.results = slim(rows); x.lastCheck = nowSec(); if (ch.length) x.changed = true; } });
        save(all);
        if (ch.length) showAlert("⚠ Авто-проверка: изменение в задаче «" + t.name + "» (" + ch.length + " адр.). Открой её.");
        i++; setTimeout(nextTask, 500);
      }).catch(function () { i++; setTimeout(nextTask, 500); });
    }
    nextTask();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var ta = $("seed");
    ta.addEventListener("input", function () {
      var C = window.PUHCORE; if (!C) return; var el = $("seed-status");
      if (!ta.value.trim()) { el.className = "vstatus muted"; el.textContent = "введите сид-фразу"; return; }
      var v = C.validateWords((ta.value || "").trim().toLowerCase()); el.className = "vstatus " + v.level; el.textContent = v.msg;
    });
    $("run").addEventListener("click", function () { run(false); });
    $("close-task").addEventListener("click", collapse);
    renderTaskList();
    dueCheck();
  });
})();
