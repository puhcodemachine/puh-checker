/* ПУХ · Режим А — фоновые задачи проверки активности.
   Старт → задача создаётся и крутится в фоне (обновляет общее хранилище puh_tasks),
   кнопка «Сохранить и продолжить» сворачивает форму (скан продолжается), задача видна в панели.
   Авто-проверка раз в 24ч; стоп/редактирование — из панели или тут. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return ("" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nowSec() { return Date.now() / 1000; }
  function fmtDT(ts) { var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function explorerUrl(coin, chains, addr) {
    var c = (chains || "").split(",")[0].trim();
    if (coin === "BTC") return "https://blockstream.info/address/" + addr;
    if (coin === "LTC") return "https://blockchair.com/litecoin/address/" + addr;
    if (coin === "DOGE") return "https://blockchair.com/dogecoin/address/" + addr;
    if (coin === "DASH") return "https://blockchair.com/dash/address/" + addr;
    if (coin === "ETC") return "https://etc.blockscout.com/address/" + addr;
    if (c === "BSC") return "https://bscscan.com/address/" + addr;
    if (c === "Polygon") return "https://polygonscan.com/address/" + addr;
    return "https://etherscan.io/address/" + addr;
  }

  // ---------- активность ----------
  function blockchair(chain, addr) {
    return fetch("https://api.blockchair.com/" + chain + "/dashboards/address/" + addr).then(function (r) { return r.json(); })
      .then(function (d) { var a = (((d.data || {})[addr]) || {}).address || {}; var bal = a.balance || 0, recv = a.received || 0, txn = a.transaction_count || 0;
        return { bal: (bal / 1e8).toFixed(8), received: (recv / 1e8).toFixed(8), txn: txn, alive: bal > 0 || recv > 0 || txn > 0 }; })
      .catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false }; });
  }
  var EVM = [{ name: "ETH", rpc: "https://eth.llamarpc.com" }, { name: "BSC", rpc: "https://bsc-dataseed.binance.org" }, { name: "Polygon", rpc: "https://polygon-rpc.com" }];
  function rpc(url, m, p) { return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }).then(function (r) { return r.json(); }).then(function (d) { return d.result; }); }
  function evmOne(addr, url, name) { return Promise.all([rpc(url, "eth_getBalance", [addr, "latest"]), rpc(url, "eth_getTransactionCount", [addr, "latest"])]).then(function (a) { var wei = a[0] ? parseInt(a[0], 16) : 0, nonce = a[1] ? parseInt(a[1], 16) : 0; return { chain: name, wei: wei, nonce: nonce, alive: wei > 0 || nonce > 0 }; }).catch(function () { return { chain: name, wei: 0, nonce: 0, alive: false }; }); }
  function evmAll(addr) { return Promise.all(EVM.map(function (c) { return evmOne(addr, c.rpc, c.name); })).then(function (rs) { var alive = rs.some(function (x) { return x.alive; }), hits = rs.filter(function (x) { return x.alive; }).map(function (x) { return x.chain; }).join(", "); var wei = rs.reduce(function (s, x) { return s + (x.wei || 0); }, 0), nonce = rs.reduce(function (s, x) { return s + (x.nonce || 0); }, 0); return { bal: (wei / 1e18).toFixed(6), received: "—", txn: nonce, alive: alive, chains: hits }; }); }
  function etcOne(addr) { return evmOne(addr, "https://etc.rivet.link", "ETC").then(function (r) { return { bal: (r.wei / 1e18).toFixed(6), received: "—", txn: r.nonce, alive: r.alive, chains: r.alive ? "ETC" : "" }; }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false }; }); }
  function checkAct(r) { if (r.chain === "evm") return evmAll(r.addr); if (r.chain === "ethereum-classic") return etcOne(r.addr); return blockchair(r.chain, r.addr); }

  // ---------- рендер отчёта ----------
  function aliveCount(results) { return (results || []).filter(function (r) { return r.alive; }).length; }
  function render(rows) {
    var coins = ["BTC", "LTC", "DOGE", "DASH", "ETH", "ETC"], html = "";
    coins.forEach(function (coin) {
      var rs = rows.filter(function (r) { return r.coin === coin; }); if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + coin + (coin === "ETH" ? " · EVM (ETH/BSC/Polygon)" : "") + "</div>";
      rs.forEach(function (r) {
        var a = r.act || {}, alive = a.alive;
        var balTxt = a.bal == null ? "…" : esc(a.bal) + (a.received && a.received !== "—" && a.received !== a.bal ? " (получено " + esc(a.received) + ")" : "");
        var flag = a.bal == null ? "…" : alive
          ? '<a href="' + explorerUrl(r.coin, a.chains, r.addr) + '" target="_blank" rel="noopener" class="tx-link">● ЖИВОЙ' + (a.chains ? " [" + esc(a.chains) + "]" : "") + (a.txn ? " тx" + a.txn : "") + " ↗</a>"
          : "пусто";
        html += '<div class="addr-row' + (alive ? " alive" : "") + '"><span class="ar-std">' + esc(r.std) + '<br><span style="opacity:.6">' + esc(r.path) + "</span></span>" +
          '<span class="ar-addr">' + (r.addr ? esc(r.addr) : "—") + '</span><span class="ar-bal">' + balTxt + '</span><span class="ar-flag ' + (a.bal == null ? "empty" : alive ? "alive" : "empty") + '">' + flag + "</span></div>";
      });
      html += "</div>";
    });
    $("report").innerHTML = html;
  }

  // ---------- хранилище (общее с панелью) ----------
  var LS = "puh_tasks", curId = null, lastRows = null, running = {};
  function load() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function onlyA(a) { return (a || []).filter(function (t) { return t.mode === "A" && !t.deleted; }); }
  function byId(id) { return load().filter(function (t) { return t.id === id; })[0]; }
  function updateTask(id, patch) { var all = load(); all.forEach(function (t) { if (t.id === id) for (var k in patch) t[k] = patch[k]; }); save(all); }
  function slim(rows) { return rows.map(function (r) { var a = r.act || {}; return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, bal: a.bal, received: a.received, txn: a.txn, alive: !!a.alive, chains: a.chains || "" }; }); }
  function fatten(results) { return (results || []).map(function (r) { return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, act: { bal: r.bal, received: r.received, txn: r.txn, alive: r.alive, chains: r.chains } }; }); }
  function diff(o, n) { var m = {}, ch = []; (o || []).forEach(function (r) { m[r.coin + r.path] = r; }); (n || []).forEach(function (r) { var x = m[r.coin + r.path]; if (x && (x.alive !== r.alive || x.bal !== r.bal || x.received !== r.received || x.txn !== r.txn)) ch.push(r); }); return ch; }

  function showAlert(msg) { var el = $("alert"); el.textContent = msg; el.classList.remove("hidden"); }
  function renderTaskList() {
    var tasks = onlyA(load()), wrap = $("tasks-wrap"), el = $("task-list");
    if (!tasks.length) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    el.innerHTML = tasks.map(function (t) {
      var run = t.status === "running", alive = t.alive || 0, dot = t.changed ? "changed" : run ? "hit" : (alive ? "hit" : "");
      var meta = run ? "● идёт проверка " + (t.progress || "") : (alive ? "● живых: " + alive : "пусто") + (t.changed ? " · ⚠ ИЗМЕНЕНИЕ" : "");
      return '<div class="ma-task-row' + (t.changed ? " changed" : "") + (alive ? " hit" : "") + '" onclick="maOpen(\'' + t.id + '\')">' +
        '<span class="mt-dot ' + dot + '"></span>' +
        '<span class="mt-name">' + esc(t.name) + '</span>' +
        '<span class="mt-meta">' + meta + '</span>' +
        '<span class="mt-when">' + (t.lastCheck ? "пров.: " + fmtDT(t.lastCheck) : "—") + '</span>' +
        '<span class="mt-caret">→</span></div>';
    }).join("");
  }

  function renderShown(i, total) {
    render(lastRows || []);
    var t = byId(curId) || {}, run = !!running[curId], alive = aliveCount(slim(lastRows || []));
    $("scanline").textContent = run ? ("проверка " + (i != null ? i + "/" + total : (t.progress || ""))) : "";
    $("summary").className = "summary " + (alive ? "hit" : "miss");
    $("summary").innerHTML = (run ? "⏳ идёт проверка в фоне… " : "") + (alive ? "● активность на " + alive + " адрес(ах) — сид ЖИВАЯ" : "○ активности не найдено") + (t.lastCheck && !run ? " · " + fmtDT(t.lastCheck) : "");
  }

  // ---------- фоновый скан задачи ----------
  function scanLoop(id) {
    if (running[id]) return;            // один цикл на задачу — без дублей
    var t = byId(id); if (!t || !window.PUHPATHS) return;
    running[id] = true;
    var rows = window.PUHPATHS.matrix(); rows.forEach(function (r) { r.addr = window.PUHPATHS.deriveOne(r, t.seed); });
    if (curId === id) lastRows = rows;
    var prev = (byId(id) || {}).results || [];
    var i = 0;
    function step() {
      var cur = byId(id);
      if (!cur || cur.status === "red" || cur.deleted) { delete running[id]; if (curId === id) renderShown(); renderTaskList(); return; }
      if (i >= rows.length) {
        var results = slim(rows), alive = aliveCount(results);
        var ch = prev.length ? diff(prev, results) : [];
        updateTask(id, { results: results, alive: alive, status: alive ? "amber" : "green", lastCheck: nowSec(), progress: rows.length + "/" + rows.length, changed: (cur.changed || ch.length > 0) });
        if (ch.length) showAlert("⚠ Изменение в задаче «" + cur.name + "»: " + ch.length + " адрес(ов).");
        delete running[id];
        if (curId === id) { lastRows = rows; renderShown(); } renderTaskList(); return;
      }
      var r = rows[i];
      if (!r.addr) { i++; return setTimeout(step, 5); }
      checkAct(r).then(function (a) {
        r.act = a; i++;
        updateTask(id, { results: slim(rows), progress: i + "/" + rows.length });
        if (curId === id) { lastRows = rows; renderShown(i, rows.length); }
        if (i % 5 === 0) renderTaskList();
        setTimeout(step, 220);
      }).catch(function () { i++; setTimeout(step, 220); });
    }
    step();
  }

  // ---------- старт проверки (создаёт фоновую задачу сразу) ----------
  function startCheck() {
    var C = window.PUHCORE, seed = ($("seed").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var v = C.validateWords(seed);
    if (v.checksum !== true) { $("seed-status").className = "vstatus red"; $("seed-status").textContent = "✗ фраза невалидна (" + v.msg + ")"; return; }
    $("seed-status").className = "vstatus green"; $("seed-status").textContent = "✓ валидна — задача запущена, идёт фоновая проверка";
    var all = load(), now = nowSec();
    var name = ($("name").value || "").trim() || "Проверка " + (onlyA(all).length + 1);
    var existing = onlyA(all).filter(function (t) { return t.seed === seed; })[0];   // дедуп по сиду
    if (existing) {
      curId = existing.id;
      if (running[curId]) { window.maOpen(curId); return; }   // уже идёт — открыть, не дублировать
      all.forEach(function (t) { if (t.id === curId) { t.name = name; t.status = "running"; t.results = []; t.alive = 0; t.progress = "0/45"; t.started = now; t.lastCheck = null; t.log = (t.log || []).concat([{ ts: now, msg: "перезапуск проверки" }]); } });
    } else {
      curId = Math.random().toString(16).slice(2, 8);
      all.push({ id: curId, name: name, mode: "A", type: "проверка активности · 45 путей", status: "running", seed: seed, words: seed, results: [], alive: 0, created: now, started: now, lastCheck: null, changed: false, progress: "0/45", log: [{ ts: now, msg: "проверка активности запущена" }] });
    }
    save(all);
    lastRows = null; $("report").innerHTML = ""; $("summary").innerHTML = "";
    var btn = $("run"); btn.disabled = true; btn.textContent = "⏳ ИДЁТ В ФОНЕ…";
    $("close-task").textContent = "✕ ЗАКРЫТЬ В ТРЕЙ (работает в фоне)";
    $("close-task").classList.remove("hidden");   // «закрыть в трей» доступна сразу
    renderShown(); renderTaskList();
    scanLoop(curId);
  }

  function saveAndContinue() {
    // сворачиваем форму — скан продолжается в фоне; форма готова для следующей задачи
    var btn = $("run"); btn.disabled = false; btn.textContent = "▶ ПРОВЕРИТЬ ВСЕ ПУТИ";
    $("report").innerHTML = ""; $("summary").innerHTML = ""; $("summary").className = "summary"; $("scanline").textContent = "";
    $("close-task").classList.add("hidden");
    $("name").value = ""; $("seed").value = ""; $("seed-status").className = "vstatus muted"; $("seed-status").textContent = "введите сид-фразу";
    curId = null; lastRows = null;
    renderTaskList(); window.scrollTo(0, 0);
  }

  window.maOpen = function (id) {
    var t = byId(id); if (!t) return;
    var rb = $("run"); rb.disabled = false; rb.textContent = "▶ ПРОВЕРИТЬ ВСЕ ПУТИ";
    curId = id; $("name").value = t.name; $("seed").value = t.seed;
    if (t.changed) updateTask(id, { changed: false });
    lastRows = running[id] ? lastRows : fatten(t.results);
    renderShown();
    $("close-task").textContent = running[id] ? "✕ ЗАКРЫТЬ В ТРЕЙ (работает в фоне)" : "✕ ЗАКРЫТЬ";
    $("close-task").classList.remove("hidden"); $("alert").classList.add("hidden");
    if (!running[id]) {
      var st = $("seed-status"); st.className = "vstatus green";
      st.innerHTML = "сохранённая задача · " + (t.lastCheck ? "проверка " + fmtDT(t.lastCheck) : "не проверена") + ' · <a href="javascript:void(0)" onclick="maStart()" style="color:#3fcf72">▶ проверить снова</a>';
    }
    renderTaskList(); window.scrollTo(0, ($("form-h1") || {}).offsetTop || 0);
  };
  window.maStart = startCheck;
  window.maStop = function (id) { updateTask(id, { status: "red" }); renderTaskList(); if (curId === id) renderShown(); };

  function dueCheck() {
    onlyA(load()).forEach(function (t) {
      if (t.status !== "running" && nowSec() - (t.lastCheck || 0) > 86400) scanLoop(t.id);
    });
  }
  function resumeRunning() { onlyA(load()).forEach(function (t) { if (t.status === "running" && !running[t.id]) scanLoop(t.id); }); }
  function dedupeStore() {
    var all = load(), seen = {}, out = [], changed = false;
    all.forEach(function (t) {
      if (t.mode === "A" && !t.deleted) { var k = t.seed || t.id; if (seen[k]) { changed = true; return; } seen[k] = 1; }
      out.push(t);
    });
    if (changed) save(out);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var ta = $("seed");
    ta.addEventListener("input", function () { var C = window.PUHCORE; if (!C) return; var el = $("seed-status"); if (!ta.value.trim()) { el.className = "vstatus muted"; el.textContent = "введите сид-фразу"; return; } var v = C.validateWords((ta.value || "").trim().toLowerCase()); el.className = "vstatus " + v.level; el.textContent = v.msg; });
    $("run").addEventListener("click", startCheck);
    $("close-task").addEventListener("click", saveAndContinue);
    dedupeStore(); renderTaskList(); resumeRunning(); dueCheck();
    // открыть конкретную задачу по ?open=id (из панели «редактировать»)
    var mq = location.search.match(/[?&]open=([0-9a-f]+)/);
    if (mq) window.maOpen(mq[1]);
  });
})();
