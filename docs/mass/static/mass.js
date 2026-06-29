/* ПУХ · МАСС-ПРОВЕРКА — изолированная среда (IndexedDB "puh_mass").
   Массовая загрузка сид из .txt → каждая отдельной задачей (имена 1,2,3…),
   фоновая проверка всех путей (Режим А) с параллелизмом, пауза/возобновление, авто-цикл 24ч.
   НЕ трогает общее хранилище puh_tasks главной панели. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nowSec() { return Date.now() / 1000; }
  function fmtDT(ts) { if (!ts) return "—"; var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  var RECHECK = 86400, PAGE = 50, MINC = 1, MAXC = 5;

  // ---------- активность (как в Режиме А) ----------
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
  // ПУХ: вставляй сюда API-ключи эксплореров — ротируются по кругу (распределение лимитов).
  var KEYS = { blockchair: [/* "ключ1", "ключ2", "ключ3" */] };
  var EVM = [
    { name: "ETH", rpcs: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth", "https://cloudflare-eth.com"] },
    { name: "BSC", rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io"] },
    { name: "Polygon", rpcs: ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon"] }
  ];
  var ETC_RPCS = ["https://etc.rivet.link", "https://etc.etcdesktop.com"];
  var rr = {};
  function rotate(key, arr) { if (!arr || !arr.length) return null; var i = (rr[key] || 0) % arr.length; rr[key] = i + 1; return arr[i]; }
  // устойчивый fetch: лимит/ошибка → backoff+jitter и повтор; сообщает здоровье контроллеру потоков
  function fetchRetry(url, opts) {
    var TRIES = 4;
    return new Promise(function (resolve) {
      (function attempt(n) {
        fetch(url, opts).then(function (r) {
          if ([429, 430, 420, 502, 503, 504].indexOf(r.status) >= 0) { ctrl.report(false, true); if (n < TRIES) setTimeout(function () { attempt(n + 1); }, ctrl.backoff(n)); else resolve(null); }
          else { ctrl.report(true, false); resolve(r); }
        }).catch(function () { ctrl.report(false, false); if (n < TRIES) setTimeout(function () { attempt(n + 1); }, ctrl.backoff(n)); else resolve(null); });
      })(1);
    });
  }
  function blockchair(chain, addr) {
    var k = rotate("bc", KEYS.blockchair);
    var url = "https://api.blockchair.com/" + chain + "/dashboards/address/" + addr + (k ? "?key=" + k : "");
    return fetchRetry(url).then(function (r) { return r ? r.json() : null; }).then(function (d) {
      if (!d) return { bal: "н/д", received: "—", txn: 0, alive: false };
      var a = (((d.data || {})[addr]) || {}).address || {}; var bal = a.balance || 0, recv = a.received || 0, txn = a.transaction_count || 0;
      return { bal: (bal / 1e8).toFixed(8), received: (recv / 1e8).toFixed(8), txn: txn, alive: bal > 0 || recv > 0 || txn > 0 };
    }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false }; });
  }
  function rpc(rpcs, key, m, p) { return fetchRetry(rotate(key, rpcs), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }).then(function (r) { return r ? r.json() : null; }).then(function (d) { return d ? d.result : null; }); }
  function evmOne(addr, rpcs, name) { return Promise.all([rpc(rpcs, "evm_" + name, "eth_getBalance", [addr, "latest"]), rpc(rpcs, "evm_" + name, "eth_getTransactionCount", [addr, "latest"])]).then(function (a) { var wei = a[0] ? parseInt(a[0], 16) : 0, nonce = a[1] ? parseInt(a[1], 16) : 0; return { chain: name, wei: wei, nonce: nonce, alive: wei > 0 || nonce > 0 }; }).catch(function () { return { chain: name, wei: 0, nonce: 0, alive: false }; }); }
  function evmAll(addr) { return Promise.all(EVM.map(function (c) { return evmOne(addr, c.rpcs, c.name); })).then(function (rs) { var alive = rs.some(function (x) { return x.alive; }), hits = rs.filter(function (x) { return x.alive; }).map(function (x) { return x.chain; }).join(", "); var wei = rs.reduce(function (s, x) { return s + (x.wei || 0); }, 0), nonce = rs.reduce(function (s, x) { return s + (x.nonce || 0); }, 0); return { bal: (wei / 1e18).toFixed(6), received: "—", txn: nonce, alive: alive, chains: hits }; }); }
  function etcOne(addr) { return evmOne(addr, ETC_RPCS, "ETC").then(function (r) { return { bal: (r.wei / 1e18).toFixed(6), received: "—", txn: r.nonce, alive: r.alive, chains: r.alive ? "ETC" : "" }; }).catch(function () { return { bal: "н/д", received: "—", txn: 0, alive: false }; }); }
  function checkAct(r) { if (r.chain === "evm") return evmAll(r.addr); if (r.chain === "ethereum-classic") return etcOne(r.addr); return blockchair(r.chain, r.addr); }
  function aliveCount(results) { return (results || []).filter(function (r) { return r.alive; }).length; }
  function slim(rows) { return rows.map(function (r) { var a = r.act || {}; return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, bal: a.bal, received: a.received, txn: a.txn, alive: !!a.alive, chains: a.chains || "" }; }); }
  function fatten(results) { return (results || []).map(function (r) { return { coin: r.coin, std: r.std, path: r.path, addr: r.addr, usd: r.usd, act: { bal: r.bal, received: r.received, txn: r.txn, alive: r.alive, chains: r.chains } }; }); }
  function usdStr(r, a) { return (r.usd != null && (a.alive || r.usd > 0)) ? ' <b style="color:#e8b73a">(~$' + Number(r.usd).toLocaleString("en-US", { maximumFractionDigits: 2 }) + ")</b>" : ""; }
  function buildReport(rows) {
    var coins = ["BTC", "LTC", "DOGE", "DASH", "ETH", "ETC"], html = "";
    coins.forEach(function (coin) {
      var rs = rows.filter(function (r) { return r.coin === coin; }); if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + coin + (coin === "ETH" ? " · EVM (ETH/BSC/Polygon)" : "") + "</div>";
      rs.forEach(function (r) {
        var a = r.act || {}, alive = a.alive;
        var balTxt = a.bal == null ? "…" : esc(a.bal) + usdStr(r, a) + (a.received && a.received !== "—" && a.received !== a.bal ? " (получено " + esc(a.received) + ")" : "");
        var flag = a.bal == null ? "…" : alive ? '<a href="' + explorerUrl(r.coin, a.chains, r.addr) + '" target="_blank" rel="noopener" class="tx-link">● ЖИВОЙ' + (a.chains ? " [" + esc(a.chains) + "]" : "") + (a.txn ? " тx" + a.txn : "") + " ↗</a>" : "пусто";
        html += '<div class="addr-row' + (alive ? " alive" : "") + '"><span class="ar-std">' + esc(r.std) + '<br><span style="opacity:.6">' + esc(r.path) + "</span></span><span class=\"ar-addr\">" + (r.addr ? esc(r.addr) : "—") + '</span><span class="ar-bal">' + balTxt + '</span><span class="ar-flag ' + (a.bal == null ? "empty" : alive ? "alive" : "empty") + '">' + flag + "</span></div>";
      });
      html += "</div>";
    });
    return html;
  }

  // ---------- IndexedDB ----------
  var DB = null;
  function idb() { return new Promise(function (res, rej) { if (DB) return res(DB); var rq = indexedDB.open("puh_mass", 1); rq.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains("sum")) db.createObjectStore("sum", { keyPath: "id" }); if (!db.objectStoreNames.contains("res")) db.createObjectStore("res", { keyPath: "id" }); }; rq.onsuccess = function () { DB = rq.result; res(DB); }; rq.onerror = function () { rej(rq.error); }; }); }
  function st(store, mode) { return idb().then(function (db) { return db.transaction(store, mode).objectStore(store); }); }
  function idbPutSum(o) { return st("sum", "readwrite").then(function (os) { return new Promise(function (res) { os.put(o).onsuccess = function () { res(); }; }); }); }
  function idbPutRes(id, results) { return st("res", "readwrite").then(function (os) { return new Promise(function (res) { os.put({ id: id, results: results }).onsuccess = function () { res(); }; }); }); }
  function idbGetRes(id) { return st("res", "readonly").then(function (os) { return new Promise(function (res) { var r = os.get(id); r.onsuccess = function () { res(r.result ? r.result.results : null); }; }); }); }
  function idbAllSum() { return st("sum", "readonly").then(function (os) { return new Promise(function (res, rej) { var out = [], r = os.openCursor(); r.onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = function () { rej(r.error); }; }); }); }
  function idbBulkPutSum(arr) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction("sum", "readwrite"), os = t.objectStore("sum"); arr.forEach(function (o) { os.put(o); }); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  function idbClear() { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction(["sum", "res"], "readwrite"); t.objectStore("sum").clear(); t.objectStore("res").clear(); t.oncomplete = function () { res(); }; }); }); }

  // ---------- состояние ----------
  var sums = [], idMap = {}, massRunning = false, filter = "all", search = "", page = 0, openId = null, listTimer = null;
  function rebuild() { idMap = {}; sums.forEach(function (s) { idMap[s.id] = s; }); }

  // ---------- серверный режим (скан 24/7 на сервере) ----------
  var SERVER = false;
  function api(p, opts) { return fetch(p, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {})).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function srvStatus(st) { return st === "running" ? "scanning" : st === "amber" ? "alive" : st === "red" ? "error" : st === "green" ? "empty" : "pending"; }
  function serverSync(then) {
    api("/api/tasks").then(function (d) {
      var t = ((d && d.tasks) || []).filter(function (x) { return x.mass && !x.deleted; });
      sums = t.map(function (x) { return { id: x.id, name: x.name, seed: "", status: srvStatus(x.status), alive: x.alive || 0, progress: x.progress, lastCheck: x.lastCheck, created: x.created }; })
        .sort(function (a, b) { return (+a.name || 0) - (+b.name || 0); });
      rebuild(); renderStats(); renderControls(); renderList();
      if (then) then();
    });
  }

  // ---------- загрузка ----------
  function bulkCreate(text) {
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim().toLowerCase().replace(/\s+/g, " "); }).filter(Boolean);
    if (SERVER) {
      return api("/api/scan/bulk", { method: "POST", body: JSON.stringify({ seeds: lines }) }).then(function (r) {
        var added = (r && r.added) || 0, dup = (r && r.dup) || 0;
        return { added: added, dup: dup, invalid: Math.max(0, lines.length - added - dup), total: lines.length, server: true };
      });
    }
    var existing = {}; sums.forEach(function (s) { existing[s.seed] = 1; });
    var startNum = sums.length ? Math.max.apply(null, sums.map(function (s) { return +s.id || 0; })) : 0;
    var added = [], dup = 0, invalid = 0, seen = {};
    lines.forEach(function (seed) {
      if (seen[seed] || existing[seed]) { dup++; return; } seen[seed] = 1;
      var ok = window.PUHCORE.validateWords(seed).checksum === true;
      if (!ok) invalid++;
      startNum++;
      added.push({ id: startNum, name: String(startNum), seed: seed, status: ok ? "pending" : "invalid", alive: 0, lastCheck: null, created: nowSec() });
    });
    sums = sums.concat(added); rebuild();
    return idbBulkPutSum(added).then(function () { return { added: added.length, dup: dup, invalid: invalid, total: lines.length }; });
  }

  // ---------- адаптивный скан: очередь + рандомизация + контроль потоков (AIMD) ----------
  function nowMs() { return Date.now(); }
  // контроллер потоков: загрузка большая + API здоровы → к 5; лимиты/ошибки → к 1-2 и откат
  var ctrl = {
    target: 2, coolUntil: 0, okStreak: 0,
    maxByLoad: function (rem) { return rem >= 200 ? 5 : rem >= 50 ? 4 : rem >= 15 ? 3 : rem >= 5 ? 2 : 1; },
    report: function (ok, limited) {
      if (limited) { this.target = Math.max(MINC, this.target - 1); this.coolUntil = nowMs() + 8000; this.okStreak = 0; }
      else if (ok) { this.okStreak++; if (this.okStreak >= 20 && nowMs() > this.coolUntil) { this.target = Math.min(MAXC, this.target + 1); this.okStreak = 0; } }
      else { this.okStreak = 0; }
    },
    effective: function (rem) { return Math.max(MINC, Math.min(this.target, this.maxByLoad(rem))); },
    backoff: function (n) { return Math.min(15000, 500 * Math.pow(2, n)) + Math.floor(Math.random() * 500); }
  };
  function isDue(s) { return s.status === "pending" || ((s.status === "empty" || s.status === "alive" || s.status === "error") && s.lastCheck && nowSec() - s.lastCheck > RECHECK); }
  function dueCount() { var c = 0; sums.forEach(function (s) { if (isDue(s)) c++; }); return c; }
  var queue = [], qpos = 0, inflight = 0;
  function buildQueue() {
    var due = sums.filter(isDue);
    for (var i = due.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = due[i]; due[i] = due[j]; due[j] = t; } // рандомизация порядка
    queue = due; qpos = 0;
  }
  function queueRemaining() { var c = 0; for (var i = qpos; i < queue.length; i++) { var s = queue[i]; if (s.status !== "scanning" && s.status !== "invalid" && isDue(s)) c++; } return c; }
  function nextFromQueue() {
    while (qpos < queue.length) { var s = queue[qpos++]; if (s.status === "scanning" || s.status === "invalid") continue; if (isDue(s)) { s.status = "scanning"; return s; } }
    return null;
  }
  // одна сид: адреса последовательно (1 запрос на поток), с лёгким джиттером; ретраи внутри fetchRetry
  function scanOneAdaptive(s) {
    var rows = window.PUHPATHS.matrix(); rows.forEach(function (r) { r.addr = window.PUHPATHS.deriveOne(r, s.seed); });
    var valid = rows.filter(function (r) { return r.addr; }), i = 0;
    return new Promise(function (resolve) {
      (function next() {
        if (i >= valid.length) {
          var results = slim(rows), alive = aliveCount(results);
          s.alive = alive; s.status = alive ? "alive" : "empty"; s.lastCheck = nowSec();
          idbPutRes(s.id, results).then(function () { return idbPutSum(s); }).then(resolve, resolve);
          return;
        }
        var r = valid[i++];
        checkAct(r).then(function (a) { r.act = a; if (openId === s.id) renderDetail(s.id); setTimeout(next, 60 + Math.floor(Math.random() * 140)); });
      })();
    });
  }
  function scanLoop() { if (massRunning || inflight > 0) return; massRunning = true; buildQueue(); startListTimer(); pump(); }
  function pump() {
    if (!massRunning) { if (inflight === 0) finishScan(); return; }
    if (qpos >= queue.length && dueCount() > 0) buildQueue();    // подхватываем добавленные/просроченные на лету
    var rem = queueRemaining();
    if (rem === 0 && inflight === 0) { finishScan(); return; }
    var eff = ctrl.effective(rem + inflight);                    // адаптивное число потоков
    while (massRunning && inflight < eff) {
      var s = nextFromQueue(); if (!s) break;
      inflight++;
      scanOneAdaptive(s).then(function () { inflight--; pump(); });
    }
    if (massRunning && inflight === 0 && queueRemaining() > 0) setTimeout(pump, 50); // страховка от подвисания
    renderControls(); renderStats();
  }
  function finishScan() { massRunning = false; sums.forEach(function (s) { if (s.status === "scanning") s.status = "pending"; }); renderControls(); renderStats(); renderList(); stopListTimer(); }
  function pauseScan() { massRunning = false; renderControls(); }   // активные потоки доработают, новые не берём

  // ---------- рендер ----------
  function counts() {
    var c = { total: sums.length, done: 0, alive: 0, queue: 0, err: 0, scanning: 0 };
    sums.forEach(function (s) {
      if (s.lastCheck) c.done++;
      if (s.status === "alive") c.alive++;
      else if (s.status === "scanning") c.scanning++;
      else if (s.status === "error" || s.status === "invalid") c.err++;
      if (s.status === "pending") c.queue++;
    });
    c.queue += c.scanning;
    return c;
  }
  function renderStats() {
    var c = counts();
    $("s-total").textContent = c.total; $("s-done").textContent = c.done; $("s-alive").textContent = c.alive;
    $("s-queue").textContent = c.queue; $("s-err").textContent = c.err;
    var scannable = sums.filter(function (s) { return s.status !== "invalid"; }).length || 1;
    $("prog-bar").style.width = Math.round(100 * c.done / scannable) + "%";
  }
  function renderControls() {
    if (SERVER) {
      var scanning = sums.some(function (s) { return s.status === "scanning"; });
      $("start").disabled = scanning; $("pause").disabled = !scanning;
      $("start").textContent = scanning ? "▶ ИДЁТ ПРОВЕРКА…" : "▶ СТАРТ ПРОВЕРКИ";
      var cc = $("conc"); if (cc) cc.textContent = scanning ? "◉ сервер сканит" : "";
      return;
    }
    $("start").disabled = massRunning; $("pause").disabled = !massRunning;
    $("start").textContent = massRunning ? "▶ ИДЁТ…" : "▶ СТАРТ ПРОВЕРКИ";
    var c = $("conc"); if (c) c.textContent = massRunning ? ("◉ потоков онлайн: " + inflight + " · цель " + ctrl.effective(queueRemaining() + inflight) + "/" + MAXC) : "";
  }
  function matchFilter(s) {
    if (filter === "all") return true;
    if (filter === "error") return s.status === "error" || s.status === "invalid";
    return s.status === filter;
  }
  function matchSearch(s) { if (!search) return true; return s.name.indexOf(search) >= 0 || s.seed.indexOf(search) >= 0; }
  function filtered() { return sums.filter(function (s) { return matchFilter(s) && matchSearch(s); }); }
  function renderList() {
    var list = filtered(), el = $("mlist"), cnt = $("m-count"); if (cnt) cnt.textContent = "[ " + list.length + " ]";
    if (!sums.length) { el.innerHTML = '<div class="empty">список пуст — загрузи .txt</div>'; $("pager").innerHTML = ""; return; }
    if (!list.length) { el.innerHTML = '<div class="empty">нет задач под фильтр</div>'; $("pager").innerHTML = ""; return; }
    var pages = Math.ceil(list.length / PAGE); if (page >= pages) page = pages - 1; if (page < 0) page = 0;
    var slice = list.slice(page * PAGE, page * PAGE + PAGE);
    el.innerHTML = slice.map(function (s) {
      var alive = s.status === "alive", dot = alive ? "alive" : s.status === "scanning" ? "scan" : s.status === "error" || s.status === "invalid" ? "err" : s.status === "pending" ? "pending" : "";
      var meta = s.status === "scanning" ? "проверка " + (s.progress || "…") : s.status === "alive" ? "● живых: " + s.alive : s.status === "empty" ? "пусто" : s.status === "invalid" ? "невалидна" : s.status === "error" ? "ошибка" : "в очереди";
      return '<div class="mrow ' + (alive ? "alive" : s.status === "invalid" ? "invalid" : "") + '" onclick="massOpen(\'' + s.id + '\')">' +
        '<div class="mr-top"><span class="mdot ' + dot + '"></span><span class="mname">#' + esc(s.name) + '</span>' +
        '<span class="mmeta' + (alive ? " alive" : "") + '">' + meta + '</span></div>' +
        '<div class="mr-sub">' + (s.lastCheck ? "пров.: " + fmtDT(s.lastCheck) : "ещё не проверено") + '</div></div>';
    }).join("");
    $("pager").innerHTML = pages > 1 ? '<button ' + (page === 0 ? "disabled" : "") + ' onclick="massPage(-1)">←</button> ' + (page + 1) + "/" + pages + ' <button ' + (page >= pages - 1 ? "disabled" : "") + ' onclick="massPage(1)">→</button>' : list.length + " задач";
  }
  function renderDetail(id) {
    var s = idMap[id]; if (!s) return;
    var d = $("detail"); d.classList.remove("hidden"); openId = id;
    if (SERVER) {
      api("/api/tasks/" + id).then(function (data) {
        var t = data && data.task, results = (t && t.results) || [];
        var body = results.length ? buildReport(fatten(results)) : '<div class="ar-std" style="padding:8px">' + (s.status === "scanning" ? "идёт проверка на сервере…" : s.lastCheck ? "проверено · активных адресов нет" : "ещё не проверено") + "</div>";
        var head = '<div class="detail-h"><b>#' + esc(s.name) + " · " + (s.status === "alive" ? "● ЖИВЫХ АДРЕСОВ: " + s.alive : s.status) + '</b><a onclick="massCloseDetail()">✕ закрыть</a></div>' +
          '<div class="ar-std" style="word-break:break-all;margin-bottom:6px">' + esc((t && t.seed) || "") + "</div>";
        d.innerHTML = head + body;
      });
      return;
    }
    idbGetRes(id).then(function (results) {
      var body = results && results.length ? buildReport(fatten(results)) : '<div class="ar-std" style="padding:8px">' + (s.status === "scanning" ? "идёт проверка…" : s.status === "invalid" ? "сид невалидна — не проверяется" : s.lastCheck ? "проверено · активных адресов нет" : "ещё не проверено") + "</div>";
      var head = '<div class="detail-h"><b>#' + esc(s.name) + " · " + (s.status === "alive" ? "● ЖИВЫХ АДРЕСОВ: " + s.alive : s.status) + '</b><a onclick="massCloseDetail()">✕ закрыть</a></div>' +
        '<div class="ar-std" style="word-break:break-all;margin-bottom:6px">' + esc(s.seed) + "</div>";
      d.innerHTML = head + body;
    });
  }
  window.massOpen = function (id) { renderDetail(id); window.scrollTo(0, $("detail").offsetTop - 60); };
  window.massCloseDetail = function () { openId = null; $("detail").classList.add("hidden"); };
  window.massPage = function (d) { page += d; renderList(); window.scrollTo(0, $("mlist").offsetTop - 80); };
  function startListTimer() { if (listTimer) return; listTimer = setInterval(function () { renderStats(); renderControls(); if (filter === "scanning" || filter === "all") renderList(); }, 1800); }
  function stopListTimer() { if (listTimer) { clearInterval(listTimer); listTimer = null; } }

  function refreshAll() { renderStats(); renderControls(); renderList(); }

  document.addEventListener("DOMContentLoaded", function () {
    api("/api/account").then(function (a) {
      SERVER = !!(a && a.user);                          // сервер → скан 24/7; иначе браузер (превью)
      if (SERVER) { serverSync(); listTimer = setInterval(serverSync, 5000); }
      else idbAllSum().then(function (rows) { sums = rows.sort(function (a, b) { return a.id - b.id; }); rows.forEach(function (s) { if (s.status === "scanning") s.status = "pending"; }); rebuild(); refreshAll(); });
    });
    $("load").addEventListener("click", function () {
      var paste = $("paste").value || "";
      var doLoad = function (text) {
        if (!text.trim()) { $("parse-msg").className = "parse-msg red"; $("parse-msg").textContent = "пусто — выбери файл или вставь список"; return; }
        $("parse-msg").className = "parse-msg muted"; $("parse-msg").textContent = "загрузка…";
        bulkCreate(text).then(function (r) {
          $("parse-msg").className = "parse-msg green";
          $("parse-msg").textContent = "✓ добавлено: " + r.added + " · дубликаты: " + r.dup + " · невалидных: " + r.invalid + " (из " + r.total + " строк)" + (r.server ? " — сервер сканит 24/7" : "");
          $("paste").value = ""; $("file").value = ""; page = 0; if (SERVER) serverSync(); else refreshAll();
        });
      };
      var f = $("file").files[0];
      if (f) { var rd = new FileReader(); rd.onload = function () { doLoad(String(rd.result) + (paste ? "\n" + paste : "")); }; rd.readAsText(f); }
      else doLoad(paste);
    });
    $("start").addEventListener("click", function () {
      if (SERVER) { var r = sums.filter(function (s) { return s.status !== "scanning"; }); $("start").disabled = true; Promise.all(r.map(function (s) { return api("/api/tasks/" + s.id + "/update", { method: "POST", body: JSON.stringify({ status: "running" }) }); })).then(serverSync); }
      else scanLoop();
    });
    $("pause").addEventListener("click", function () {
      if (SERVER) { var r = sums.filter(function (s) { return s.status === "scanning"; }); $("pause").disabled = true; Promise.all(r.map(function (s) { return api("/api/tasks/" + s.id + "/stop", { method: "POST" }); })).then(serverSync); }
      else pauseScan();
    });
    $("clear").addEventListener("click", function () {
      if (!sums.length) return;
      if (!confirm("Удалить ВСЕ " + sums.length + " задач масс-проверки? (главная панель не затрагивается)")) return;
      if (SERVER) {
        Promise.all(sums.map(function (s) { return api("/api/tasks/" + s.id + "/update", { method: "POST", body: JSON.stringify({ deleted: true }) }); }))
          .then(function () { openId = null; $("detail").classList.add("hidden"); page = 0; serverSync(); $("parse-msg").className = "parse-msg muted"; $("parse-msg").textContent = "очищено"; });
      } else { massRunning = false; idbClear().then(function () { sums = []; rebuild(); openId = null; $("detail").classList.add("hidden"); page = 0; refreshAll(); $("parse-msg").className = "parse-msg muted"; $("parse-msg").textContent = "очищено"; }); }
    });
    [].forEach.call(document.getElementsByClassName("chip"), function (ch) {
      ch.addEventListener("click", function () {
        [].forEach.call(document.getElementsByClassName("chip"), function (c) { c.classList.remove("active"); });
        ch.classList.add("active"); filter = ch.getAttribute("data-f"); page = 0; renderList();
      });
    });
    $("search").addEventListener("input", function () { search = (this.value || "").trim().toLowerCase(); page = 0; renderList(); });
    setInterval(function () { if (!SERVER && $("auto").checked && !massRunning && dueCount() > 0) scanLoop(); }, 60000);  // авто-цикл только для браузерного режима
  });
})();
