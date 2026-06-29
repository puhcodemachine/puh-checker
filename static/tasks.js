/* PUH — список активных заданий + кнопка «Начать задание».
   Работает И с сервером (API), И без него (статичный Pages → localStorage). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var EMPTY = '<div class="empty-tasks">нет активных заданий<br><span>создай новое во вкладке «Новое задание»</span></div>';

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function dur(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec % 3600 / 60)) + ":" + pad(sec % 60); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function fmtDateTime(ts) { var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + "  " + clock(ts); }
  function fmtBig(x) {
    if (x == null) return "—";
    if (x >= 1e12) return (x / 1e12).toFixed(2) + " трлн";
    if (x >= 1e9) return (x / 1e9).toFixed(2) + " млрд";
    if (x >= 1e6) return (x / 1e6).toFixed(2) + " млн";
    if (x >= 1e3) return Math.round(x).toLocaleString("ru");
    return String(Math.round(x));
  }
  function wcount(t) {
    return window.PUHCORE ? window.PUHCORE.tokWords(t.words || "").length : (("" + (t.words || "")).match(/[A-Za-z]+/g) || []).length;
  }
  function statsHtml(t) {
    var s = t.stats || {};
    var n = s.words || wcount(t);
    var space1 = s.checkedL1 != null ? s.checkedL1 : n * 2048;
    var space2 = s.space2 != null ? s.space2 : (n * (n - 1) / 2) * 2048 * 2048;
    var valid = s.valid != null ? s.valid : (t.results || []).length;
    var deep = s.deepChecked || 0;
    var rem = s.remaining2 != null ? s.remaining2 : Math.max(0, space2 - deep);
    var used = space1 + deep, day = s.budgetDay || 10000000;
    return '<div class="td-h">СТАТИСТИКА ПЕРЕБОРА</div><div class="td-grid">' +
      '<span class="k">СЛОВ В ФРАЗЕ</span><span class="val">' + n + "</span>" +
      '<span class="k">ПЕРЕБРАНО (1 СЛОВО)</span><span class="val">' + fmtBig(space1) + "</span>" +
      '<span class="k">ВАЛИДНЫХ ВАРИАНТОВ</span><span class="val green">' + valid + "</span>" +
      '<span class="k">ЯЗЫКОВ ПРОВЕРЕНО</span><span class="val">' + (s.langsChecked || 9) + " / 9</span>" +
      '<span class="k">ГЛУБОКИЙ (2 СЛОВА)</span><span class="val">' + fmtBig(deep) + " / " + fmtBig(space2) + "</span>" +
      '<span class="k">ОСТАЛОСЬ (2 СЛОВА)</span><span class="val amber">' + fmtBig(rem) + "</span>" +
      '<span class="k">СУТОЧНЫЙ БЮДЖЕТ</span><span class="val">' + fmtBig(used) + " / " + fmtBig(day) + "</span>" +
      "</div>";
  }

  // ---------- хранилище: сервер, иначе localStorage ----------
  var LS = "puh_tasks";
  function lsLoad() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function lsSave(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function lsSummary(t) {
    return { id: t.id, name: t.name, type: t.type, status: t.status, modes: t.modes,
             created: t.created, started: t.started, stopped: t.stopped, pausedAt: t.pausedAt,
             mode: t.mode || "B", alive: t.alive || 0, lastCheck: t.lastCheck, progress: t.progress,
             hits: t.hits || 0, candidates: (t.candidates || []).length, fromB: t.fromB,
             deleted: t.deleted, results: (t.results || []).length };
  }
  function lsCreate(p) {
    var words = (p.words || "").trim(), nums = (p.nums || "").trim();
    var id = Math.random().toString(16).slice(2, 8);
    var wc = (words.match(/[A-Za-z]+/g) || []).length;
    var gen = (words ? "SEED-" : "CODE-") + id.toUpperCase().slice(0, 4);
    var name = (p.name || "").trim() || gen;
    var type = words ? "сид-фраза · " + wc + " слов" : "цифровой код";
    var now = Date.now() / 1000;
    var t = { id: id, name: name, type: type, status: "green", modes: { podbor: true, monitor: !!p.monitor },
              words: words, nums: nums, created: now, started: now, results: [], log: [] };
    var a = lsLoad(); a.push(t); lsSave(a); return t;
  }
  function lsStop(id) {
    var a = lsLoad(), found = null;
    a.forEach(function (t) { if (t.id === id) { t.status = "red"; t.stopped = Date.now() / 1000; found = t; } });
    lsSave(a); return found;
  }
  function lsUpdate(id, patch) {
    var a = lsLoad(), found = null;
    a.forEach(function (t) { if (t.id === id) { for (var k in patch) t[k] = patch[k]; found = t; } });
    lsSave(a); return found;
  }
  function jsonOrThrow(r) {
    if (!r.ok) throw 0;
    if ((r.headers.get("content-type") || "").indexOf("json") < 0) throw 0;
    return r.json();
  }
  var store = {
    list: function () {
      return fetch("/api/tasks").then(jsonOrThrow).then(function (d) { return d.tasks; })
        .catch(function () { return lsLoad().map(lsSummary); });
    },
    get: function (id) {
      return fetch("/api/tasks/" + id).then(jsonOrThrow).then(function (d) { return d.task; })
        .catch(function () { return lsLoad().filter(function (t) { return t.id === id; })[0] || null; });
    },
    create: function (p) {
      return fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })
        .then(jsonOrThrow).then(function (d) { return d.task; }).catch(function () { return lsCreate(p); });
    },
    stop: function (id) {
      return fetch("/api/tasks/" + id + "/stop", { method: "POST" }).then(jsonOrThrow).then(function (d) { return d.task; })
        .catch(function () { return lsStop(id); });
    },
    update: function (id, patch) {
      return fetch("/api/tasks/" + id + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
        .then(jsonOrThrow).then(function (d) { return d.task; }).catch(function () { return lsUpdate(id, patch); });
    }
  };

  // ---------- ЛОГИЧНЫЙ ПЕРЕБОР (демо, лимит 10 млн/сид) ----------
  var DEMO_LIMIT = 10000000;
  function nowSec() { return Date.now() / 1000; }
  function runPerebor(taskId, words, nums) {
    var res = [], log = [];
    log.push({ ts: nowSec(), msg: "перебор запущен · логичный режим (демо, лимит 10 млн попыток/сид)" });
    // 1) числовой якорь + подбор валидного слова + перестановка (англ.)
    var cand = (window.PUHRECOVER ? window.PUHRECOVER.recover(words, nums) : []);
    log.push({ ts: nowSec(), msg: "числовой якорь + подбор слова: валидных вариантов найдено " + cand.length });
    cand.slice(0, 50).forEach(function (c) {
      res.push({ ts: nowSec(), phrase: c.phrase, stage: "подбор слова",
                 reason: c.kind + (c.from ? " [" + c.from + " → " + c.to + "]" : "") });
    });
    // 2) перевод в цифры и сверка по всем языкам
    if (window.PUHCORE && window.PUHCORE.languageScan) {
      var ls = window.PUHCORE.languageScan(words, nums).filter(function (x) { return x.valid; });
      log.push({ ts: nowSec(), msg: "перевод в индексы и сверка по 9 словарям: валидных языков " + ls.length });
      ls.forEach(function (v) {
        res.push({ ts: nowSec(), phrase: (v.words || []).join(" "), stage: "языковая сверка", reason: "валидна в языке: " + v.name });
      });
    }
    // dedup по фразе
    var seen = {}, uniq = [];
    res.forEach(function (r) { if (r.phrase && !seen[r.phrase]) { seen[r.phrase] = 1; uniq.push(r); } });
    log.push({ ts: nowSec(), msg: "найдено валидных фраз: " + uniq.length + " → проверяю балансы каждой сид…" });
    var n = (window.PUHCORE ? window.PUHCORE.tokWords(words).length : (words.match(/[A-Za-z]+/g) || []).length);
    var space2 = (n * (n - 1) / 2) * 2048 * 2048;
    var stats = { words: n, checkedL1: n * 2048, valid: uniq.length, langsChecked: 9,
                  space2: space2, deepChecked: 0, remaining2: space2, budgetDay: 10000000 };
    // задание остаётся «в работе» (таймер тикает), пока идёт скан балансов; потом ПАУЗА с фиксацией времени
    return store.update(taskId, { status: "green", results: uniq, log: log, done: true, balScanned: false, stats: stats })
      .then(function () {
        refresh();
        store.get(taskId).then(function (ft) { if (ft) scanResults(ft, true); });
      });
  }
  window.runPereborDemo = runPerebor;

  // ---------- рендер ----------
  function statusInfo(s) {
    if (s === "green") return { lamp: "green", cls: "green", txt: "● РАБОТАЕТ" };
    if (s === "amber") return { lamp: "amber", cls: "amber", txt: "◐ НУЖНА ПРОВЕРКА" };
    return { lamp: "red", cls: "red", txt: "■ ОСТАНОВЛЕНО" };
  }
  function runSpan(t, cls) {
    if (t.status === "green")  // только зелёное тикает; пауза/стоп — замороженное время
      return '<span class="' + cls + ' t-run" data-started="' + t.started + '">' + dur(Date.now() / 1000 - t.started) + "</span>";
    var f = t.stopped || t.pausedAt;
    return '<span class="' + cls + ' t-run">' + (f ? dur(f - t.started) : "--:--:--") + "</span>";
  }
  function cardHtmlA(t) {
    var run = t.status === "running", alive = t.alive || 0;
    var lamp = run ? "green" : t.status === "red" ? "red" : (alive ? "green" : "amber");
    var cls = run ? "green" : t.status === "red" ? "red" : (alive ? "green" : "amber");
    var st = run ? "● идёт проверка " + (t.progress || "") : t.status === "red" ? "■ остановлено" : (alive ? "● ЖИВАЯ · активных " + alive : "проверено · пусто");
    return '<div class="task" data-id="' + t.id + '" onclick="openTask(\'' + t.id + '\')">' +
      '<div class="task-top"><span class="task-name">' + esc(t.name) + ' <span class="mode-badge a">А</span></span><span class="lamp ' + lamp + '"></span></div>' +
      '<div class="task-status ' + cls + '">' + st + '</div>' +
      '<div class="task-type">тип: ' + esc(t.type || "проверка активности") + '</div>' +
      '<div class="task-meta"><span>ЗАПУСК<span class="v">' + clock(t.started) + '</span></span>' +
      '<span style="text-align:right">ПРОВЕРЕНО<span class="v">' + (t.lastCheck ? clock(t.lastCheck) : "--:--:--") + '</span></span></div></div>';
  }
  function cardHtmlBA(t) {
    var run = t.status === "running", hits = t.hits || 0;
    var lamp = run ? "green" : t.status === "red" ? "red" : (hits ? "green" : "amber");
    var st = run ? "● проверка вариаций " + (t.progress || "") : t.status === "red" ? "■ остановлено" : (hits ? "● ЖИВЫХ ВАРИАЦИЙ: " + hits : "проверено · пусто");
    return '<div class="task" data-id="' + t.id + '" onclick="openTask(\'' + t.id + '\')">' +
      '<div class="task-top"><span class="task-name">' + esc(t.name) + ' <span class="mode-badge ba">Б→А</span></span><span class="lamp ' + lamp + '"></span></div>' +
      '<div class="task-status ' + lamp + '">' + st + '</div>' +
      '<div class="task-type">тип: ' + esc(t.type || ("Б→А · вариаций " + (t.candidates || 0))) + '</div>' +
      '<div class="task-meta"><span>ЗАПУСК<span class="v">' + clock(t.started) + '</span></span>' +
      '<span style="text-align:right">ПРОВЕРЕНО<span class="v">' + (t.lastCheck ? clock(t.lastCheck) : "--:--:--") + '</span></span></div></div>';
  }
  function cardHtml(t) {
    if (t.mode === "A") return cardHtmlA(t);
    if (t.mode === "BA") return cardHtmlBA(t);
    var si = statusInfo(t.status);
    return '<div class="task" data-id="' + t.id + '" onclick="openTask(\'' + t.id + '\')">' +
      '<div class="task-top"><span class="task-name">' + esc(t.name) + ' <span class="mode-badge">Б</span></span><span class="lamp ' + si.lamp + '"></span></div>' +
      '<div class="task-status ' + si.cls + '">' + si.txt + '</div>' +
      '<div class="task-type">тип: ' + esc(t.type) + '</div>' +
      '<div class="task-meta"><span>ЗАПУСК<span class="v">' + clock(t.started) + '</span></span>' +
      '<span style="text-align:right">В РАБОТЕ' + runSpan(t, "v") + '</span></div></div>';
  }
  var taskFilter = "all", allTasksCache = [];
  function render(tasks) {
    if (tasks) allTasksCache = tasks;
    var list0 = (allTasksCache || []).filter(function (t) { return !t.deleted; });   // удалённые не показываем
    var seen = {}; list0 = list0.filter(function (t) { if (seen[t.id]) return false; seen[t.id] = 1; return true; });  // без дублей
    if (taskFilter !== "all") list0 = list0.filter(function (t) { return (t.mode || "B") === taskFilter; });  // фильтр по режиму
    var list = $("task-list"), cnt = $("task-count");
    if (cnt) cnt.textContent = "[ " + list0.length + " ]";
    list0.forEach(function (t) {
      if (t.mode !== "A" && t.mode !== "BA" && t.status !== "green" && !t.pausedAt && !t.stopped) {  // миграция пауз
        t.pausedAt = Date.now() / 1000;
        store.update(t.id, { pausedAt: t.pausedAt });
      }
    });
    if (list) list.innerHTML = list0.length ? list0.map(cardHtml).join("") : EMPTY;
  }
  window.setTaskFilter = function (el, f) {
    taskFilter = f;
    var ch = document.getElementsByClassName("tf");
    for (var i = 0; i < ch.length; i++) ch[i].classList.remove("active");
    el.classList.add("active");
    render();
  };
  function refresh() { store.list().then(render); }
  window.refreshTasks = refresh;
  window.renderTasksDirect = render;
  var isAdmin = false;   // супер-админ PUH (определяем с сервера)
  try { fetch("/api/account", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { isAdmin = !!(d && d.role === "admin"); }).catch(function () {}); } catch (e) {}
  window.renderDB = function () {
    store.list().then(function (tasks) {
      var el = $("db-list"); if (!el) return;
      if (!tasks.length) { el.innerHTML = '<div class="td-empty">база пуста</div>'; return; }
      el.innerHTML = tasks.map(function (t) {
        var a = t.mode === "A", ba = t.mode === "BA";
        var meta = ba ? "Б→А · вариаций " + (t.candidates || 0) + " · живых " + (t.hits || 0)
          : a ? "активность · живых " + (t.alive || 0) : (t.results || 0) + " вариантов · перебор";
        var stat = t.deleted ? "удалено" : t.status === "running" ? "идёт" : t.status === "red" ? "остановлено" : t.status === "amber" ? "пауза/проверка" : "ок";
        var badge = ba ? '<span class="mode-badge ba">Б→А</span>' : '<span class="mode-badge ' + (a ? "a" : "") + '">' + (a ? "А" : "Б") + "</span>";
        return '<div class="db-item"><div class="db-row" onclick="dbToggle(this,\'' + t.id + '\')">' +
          badge +
          '<span class="db-name">' + esc(t.name) + (t.deleted ? ' <span class="db-del">(удалено)</span>' : "") + "</span>" +
          '<span class="db-meta">' + meta + " · " + stat + "</span>" +
          '<span class="db-caret">▾</span></div>' +
          '<div class="db-log hidden" data-id="' + t.id + '" data-loaded="0"></div></div>';
      }).join("");
    });
  };
  window.dbToggle = function (head, id) {
    var log = head.nextElementSibling;
    var nowHidden = log.classList.toggle("hidden");
    head.querySelector(".db-caret").textContent = nowHidden ? "▾" : "▴";
    if (!nowHidden && log.getAttribute("data-loaded") === "0") {
      log.setAttribute("data-loaded", "1");
      store.get(id).then(function (t) {
        var lg = (t && t.log) || [];
        var inner = lg.length
          ? lg.map(function (e) { return '<div class="db-log-row"><span class="ts">' + fmtDateTime(e.ts) + "</span><span>" + esc(e.msg) + "</span></div>"; }).join("")
          : '<div class="td-empty">журнал пуст</div>';
        inner += '<div class="db-actions"><a href="javascript:void(0)" onclick="openTask(\'' + id + '\')" class="tx-link">↗ открыть задание полностью</a>';
        if (isAdmin && !(t && t.deleted)) inner += '<button class="db-del-btn" onclick="dbDelete(\'' + id + '\')">🗑 УДАЛИТЬ ЗАДАЧУ</button>';
        inner += "</div>";
        log.innerHTML = inner;
      });
    }
  };
  window.dbDelete = function (id) {
    if (!isAdmin) return;
    confirmModal("Удалить задачу?", "Задача будет помечена как удалённая (доступно только администратору PUH).", "Удалить",
      function () { store.update(id, { deleted: true }).then(function () { window.renderDB(); refresh(); flash("задача удалена"); }); });
  };

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
  function renderAddrReport(results) {
    var coins = ["BTC", "LTC", "DOGE", "DASH", "ETH", "ETC"], html = "";
    coins.forEach(function (coin) {
      var rs = (results || []).filter(function (r) { return r.coin === coin; });
      if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + coin + "</div>";
      rs.forEach(function (r) {
        var al = r.alive;
        var flag = al
          ? '<a href="' + explorerUrl(r.coin, r.chains, r.addr) + '" target="_blank" rel="noopener" class="tx-link">● ЖИВОЙ' + (r.chains ? " [" + esc(r.chains) + "]" : "") + (r.txn ? " тx" + r.txn : "") + " ↗</a>"
          : "пусто";
        html += '<div class="addr-row' + (al ? " alive" : "") + '">' +
          '<span class="ar-std">' + esc(r.std) + '<br><span style="opacity:.6">' + esc(r.path) + "</span></span>" +
          '<span class="ar-addr">' + esc(r.addr || "—") + "</span>" +
          '<span class="ar-bal">' + esc(r.bal || "—") + (r.received && r.received !== "—" && r.received !== r.bal ? " (получ. " + esc(r.received) + ")" : "") + "</span>" +
          '<span class="ar-flag ' + (al ? "alive" : "empty") + '">' + flag + "</span></div>";
      });
      html += "</div>";
    });
    return html || '<div class="td-empty">нет адресов</div>';
  }
  function renderDetailA(t) {
    var run = t.status === "running", stopped = t.status === "red", alive = t.alive || 0, res = t.results || [];
    var stTxt = run ? "● ИДЁТ ПРОВЕРКА " + (t.progress || "") : stopped ? "■ ОСТАНОВЛЕНО" : alive ? "● ЖИВАЯ — активных " + alive : "проверено · пусто";
    var stCls = run ? "green" : stopped ? "red" : alive ? "green" : "muted";
    $("td-name").textContent = t.name;
    $("td-lamp").className = "lamp " + (run ? "green" : stopped ? "red" : alive ? "green" : "amber");
    var h = '<div class="td-toprow"><div class="td-sec td-half"><div class="td-h">СТАТУС И ВРЕМЯ</div><div class="td-grid">' +
      '<span class="k">РЕЖИМ</span><span class="val">А · проверка активности</span>' +
      '<span class="k">СТАТУС</span><span class="val ' + stCls + '">' + stTxt + "</span>" +
      '<span class="k">ТИП</span><span class="val">' + esc(t.type || "") + "</span>" +
      '<span class="k">ЗАПУСК</span><span class="val">' + fmtDateTime(t.started) + "</span>" +
      '<span class="k">ПОСЛЕДНЯЯ ПРОВЕРКА</span><span class="val">' + (t.lastCheck ? fmtDateTime(t.lastCheck) : "—") + "</span>" +
      '<span class="k">АВТО-ПРОВЕРКА</span><span class="val">раз в 24ч (в Режиме А)</span></div></div></div>';
    h += '<div class="td-sec"><div class="td-h">СИД-ФРАЗА</div><div class="td-mat">' + esc(t.words || t.seed || "") + "</div></div>";
    h += '<div class="td-sec"><div class="td-h">АДРЕСА И АКТИВНОСТЬ (' + res.length + " путей · живых " + alive + ")</div>" + renderAddrReport(res) + "</div>";
    h += '<div class="td-sec" style="display:flex;gap:12px;flex-wrap:wrap">' +
      '<button class="btn-continue" onclick="location.href=\'mode-a/?open=' + t.id + '\'">✎ РЕДАКТИРОВАТЬ / ПЕРЕПРОВЕРИТЬ (Режим А)</button>' +
      (run ? '<button class="td-stop" style="position:static" onclick="maStopA(\'' + t.id + '\')">⏸ ОСТАНОВИТЬ</button>' : "") +
      "</div>";
    $("td-inner").innerHTML = h;
    var stop = $("td-stop"); if (stop) { stop.classList.add("hidden"); stop.onclick = null; }
  }
  function renderDetail(t) {
    if (t.mode === "A") return renderDetailA(t);
    var si = statusInfo(t.status), m = t.modes || {}, res = t.results || [];
    $("td-name").textContent = t.name;
    $("td-lamp").className = "lamp " + si.lamp;
    var h = "";
    h += '<div class="td-toprow">';
    h += '<div class="td-sec td-half"><div class="td-h">СТАТУС И ВРЕМЯ</div><div class="td-grid">' +
      '<span class="k">СТАТУС</span><span class="val ' + si.cls + '">' + si.txt + "</span>" +
      '<span class="k">ТИП</span><span class="val">' + esc(t.type) + "</span>" +
      '<span class="k">ЗАПУСК</span><span class="val">' + fmtDateTime(t.started) + "</span>" +
      '<span class="k">ОБЩЕЕ ВРЕМЯ В РАБОТЕ</span>' + runSpan(t, "val") + "</div></div>";
    h += '<div class="td-sec td-half">' + statsHtml(t) + "</div>";
    h += "</div>";
    h += '<div class="td-sec"><div class="td-h">МАТЕРИАЛ ЗАДАНИЯ</div>';
    if (t.words) h += '<div class="td-k">СЛОВА</div><div class="td-mat">' + esc(t.words) + "</div>";
    if (t.nums) h += '<div class="td-k" style="margin-top:10px">ЦИФРОВОЙ КОД</div><div class="td-mat">' + esc(t.nums) + "</div>";
    h += "</div>";
    h += '<div class="td-sec"><div class="td-h">РЕЖИМЫ РАБОТЫ</div><div class="td-chips">' +
      '<span class="td-chip ' + (m.podbor ? "on" : "") + '">ПОДБОР · ' + (m.podbor ? "ВКЛ" : "выкл") + "</span>" +
      '<span class="td-chip ' + (m.monitor ? "on" : "") + '">МОНИТОРИНГ · ' + (m.monitor ? "ВКЛ" : "выкл") + "</span></div></div>";
    h += '<div class="td-sec"><div class="td-h">РЕЗУЛЬТАТЫ — ВАЛИДНЫЕ ФРАЗЫ (' + res.length + ') <span id="scan-status" class="scan-status"></span></div>';
    h += res.length ? res.map(resultHtml).join("") : '<div class="td-empty">валидных фраз пока нет</div>';
    h += "</div>";

    var lg = t.log || [];
    h += '<div class="td-sec"><div class="td-h">ЖУРНАЛ ЗАДАНИЯ — БАЗА (' + lg.length + ")</div>";
    h += lg.length
      ? lg.map(function (e) { return '<div class="td-log-row"><span class="ts">' + fmtDateTime(e.ts) + "</span><span>" + esc(e.msg) + "</span></div>"; }).join("")
      : '<div class="td-empty">журнал пуст</div>';
    h += "</div>";

    if (t.status === "amber")
      h += '<div class="td-sec"><button class="btn-continue" onclick="continuePerebor(\'' + t.id + '\')">💾 СОХРАНИТЬ РЕЗУЛЬТАТ И ПРОДОЛЖИТЬ ПЕРЕБОР</button>' +
        '<div class="td-k" style="margin-top:8px">перебор логический и бюджетный (не бесконечный) — продолжит более глубоким поиском (2 слова)</div></div>';

    $("td-inner").innerHTML = h;
    var stop = $("td-stop");
    if (stop) {
      if (t.status === "green") { stop.classList.remove("hidden"); stop.onclick = function () { confirmStop(t.id, t.name); }; }
      else { stop.classList.add("hidden"); stop.onclick = null; }
    }
    if (t.status === "amber" && !t.balScanned) scanResults(t, false);  // дозаписать балансы у старых заданий
  }

  function confirmModal(title, text, okText, onOk) {
    $("modal-title").textContent = title;
    $("modal-text").textContent = text;
    $("modal-ok").textContent = okText || "Подтвердить";
    $("modal").classList.remove("hidden");
    $("modal-ok").onclick = function () { $("modal").classList.add("hidden"); onOk(); };
    $("modal-cancel").onclick = function () { $("modal").classList.add("hidden"); };
  }
  function confirmStop(id, name) {
    confirmModal("Остановить задание?",
      "Задание " + name + " будет переведено в статус ОСТАНОВЛЕНО (красный). Перебор прекратится.",
      "Да, остановить", function () {
        store.stop(id).then(function (t) {
          if (t) { flash("задание " + name + " остановлено"); window.openTask(id); refresh(); }
          else flash("не удалось остановить");
        });
      });
  }

  var curOpen = null;  // id открытого задания (для живого скана)
  window.openTask = function (id) {
    curOpen = id;
    store.get(id).then(function (t) {
      if (t && t.mode === "BA") { location.href = "mode-a/?open=" + id; return; }   // Б→А открывается в Режиме А
      if (t) { renderDetail(t); $("task-detail").classList.remove("hidden"); }
      else flash("задание не найдено");
    });
  };
  window.closeTask = function () { curOpen = null; $("task-detail").classList.add("hidden"); };
  window.openDetailDirect = function (t) { renderDetail(t); $("task-detail").classList.remove("hidden"); };
  window.goHomePanel = function () { curOpen = null; $("task-detail").classList.add("hidden"); goHome(); };  // лого -> главная (дефолт)
  window.maStopA = function (id) { store.update(id, { status: "red" }).then(function () { refresh(); if (curOpen === id) window.openTask(id); }); };
  window.deleteCurrentTask = function () {
    var id = curOpen; if (!id) return;
    confirmModal("Удалить задание?", "Задание будет убрано из активных. В базе оно сохранится с пометкой «удалено».", "Удалить", function () {
      store.update(id, { deleted: true }).then(function () { window.closeTask(); refresh(); flash("задание удалено"); });
    });
  };

  // ---------- раскрытие сид: адреса ETH/TRC20/BTC/Monero + балансы + копирование ----------
  function resultHtml(r, i) {
    var ph = esc(r.phrase);
    var badge = r.funded ? '<span class="fund-badge">💰 ЕСТЬ СРЕДСТВА</span> ' : '';
    return '<div class="res' + (r.funded ? ' funded' : '') + '" data-ri="' + i + '">' +
      '<div class="res-head" onclick="toggleRes(this)">' +
        '<span class="ts">' + fmtDateTime(r.ts) + '</span>' +
        '<div class="res-mid"><div class="rphrase">' + badge + ph + '</div><div class="rreason">' + esc(r.reason || r.stage || "") + '</div></div>' +
        '<span class="res-caret">▾</span></div>' +
      '<div class="res-body hidden" data-phrase="' + ph + '" data-loaded="0"></div></div>';
  }
  function fillAddresses(body) {
    var phrase = body.getAttribute("data-phrase");
    var copyAll = '<div class="addr-copyall"><button class="copy-btn" data-copy="' + esc(phrase) + '" onclick="copyEl(this)">⧉ КОПИРОВАТЬ СИД</button></div>';
    var addrs = window.PUHDERIVE ? window.PUHDERIVE.addresses(phrase) : null;
    if (!addrs) { body.innerHTML = copyAll + '<div class="td-empty">не удалось вывести адреса</div>'; return; }
    function row(label, addr, net) {
      if (!addr) return '<div class="addr-row"><span class="addr-net">' + label + '</span>' +
        '<span class="addr-val muted">вывод на сервере (нестандартно для BIP39)</span><span class="addr-bal"></span><span></span></div>';
      return '<div class="addr-row"><span class="addr-net">' + label + '</span>' +
        '<span class="addr-val">' + esc(addr) + '</span>' +
        '<span class="addr-bal" data-net="' + net + '">…</span>' +
        '<button class="copy-btn" data-copy="' + esc(addr) + '" onclick="copyEl(this)">⧉</button></div>';
    }
    body.innerHTML = copyAll +
      row("ETH", addrs.eth, "eth") + row("TRC20", addrs.trx, "trx") +
      row("BITCOIN", addrs.btc, "btc") + row("MONERO", addrs.xmr, "xmr");
    var D = window.PUHDERIVE;
    function setBal(net, v) { var el = body.querySelector('.addr-bal[data-net="' + net + '"]'); if (el) el.textContent = v; }
    if (addrs.eth) D.ethBalance(addrs.eth).then(function (v) { setBal("eth", v); });
    if (addrs.trx) D.trxBalance(addrs.trx).then(function (v) { setBal("trx", v); });
    if (addrs.btc) D.btcBalance(addrs.btc).then(function (v) { setBal("btc", v); });
  }
  window.toggleRes = function (head) {
    var body = head.nextElementSibling;
    var nowHidden = body.classList.toggle("hidden");
    head.querySelector(".res-caret").textContent = nowHidden ? "▾" : "▴";
    if (!nowHidden && body.getAttribute("data-loaded") === "0") {
      body.setAttribute("data-loaded", "1");
      fillAddresses(body);
    }
  };
  window.copyEl = function (btn) {
    var t = btn.getAttribute("data-copy");
    try { if (navigator.clipboard) navigator.clipboard.writeText(t); } catch (e) {}
    var o = btn.textContent; btn.textContent = "✓"; setTimeout(function () { btn.textContent = o; }, 1100);
    flash("скопировано");
  };

  // ---------- скан балансов всех результатов + подсветка непустых ----------
  function bnum(x) { var v = parseFloat(x); return isNaN(v) ? 0 : v; }
  function markFunded(i) {
    var el = document.querySelector('.res[data-ri="' + i + '"]');
    if (!el) return;
    el.classList.add("funded");
    var ph = el.querySelector(".rphrase");
    if (ph && !ph.querySelector(".fund-badge"))
      ph.innerHTML = '<span class="fund-badge">💰 ЕСТЬ СРЕДСТВА</span> ' + ph.innerHTML;
  }
  function uiStatus(id, txt) { var ss = $("scan-status"); if (ss && curOpen === id) ss.textContent = txt; }
  function finishPause(t, found) {
    store.get(t.id).then(function (cur) {
      if (!cur || cur.deleted || cur.status === "red") { refresh(); return; }  // не воскрешаем остановленную/удалённую
      var log = cur.log || t.log || [];
      log.push({ ts: nowSec(), msg: "проверка балансов завершена" + (found ? (", СРЕДСТВА: " + found) : ", пусто") + " → ПАУЗА" });
      store.update(t.id, { status: "amber", pausedAt: nowSec(), log: log, balScanned: true })
        .then(function () { refresh(); if (curOpen === t.id) window.openTask(t.id); });
    });
  }
  // скан балансов всех результатов; andPause=true → по завершении ставит задание на ПАУЗУ
  function scanResults(t, andPause) {
    if (!t) return;
    var D = window.PUHDERIVE, results = t.results || [];
    if (!D || !results.length) { if (andPause) finishPause(t, 0); return; }
    if (t.balScanned && !andPause) return;
    var i = 0, found = 0;
    function next() {
      if (i >= results.length) {
        t.balScanned = true;
        uiStatus(t.id, "· балансы проверены" + (found ? (" — СРЕДСТВА: " + found) : " — пусто"));
        store.update(t.id, { results: results, balScanned: true });
        if (andPause) finishPause(t, found);
        return;
      }
      uiStatus(t.id, "· проверка балансов " + (i + 1) + "/" + results.length + "…");
      var r = results[i], a = D.addresses(r.phrase);
      if (!a) { i++; return setTimeout(next, 10); }
      Promise.all([
        a.eth ? D.ethBalance(a.eth) : Promise.resolve("—"),
        a.btc ? D.btcBalance(a.btc) : Promise.resolve("—"),
        a.trx ? D.trxBalance(a.trx) : Promise.resolve("—")
      ]).then(function (b) {
        r.bal = { eth: b[0], btc: b[1], trx: b[2] };
        r.funded = bnum(b[0]) > 0 || bnum(b[1]) > 0 || bnum(b[2]) > 0;
        if (r.funded) { found++; if (curOpen === t.id) markFunded(i); flash("💰 найдены средства — результат #" + (i + 1)); }
        i++; setTimeout(next, 150);
      }).catch(function () { i++; setTimeout(next, 150); });
    }
    next();
  }

  // ---------- продолжить перебор (глубокий, логический, бюджетный) ----------
  function continuePerebor(id) {
    store.get(id).then(function (t) {
      if (!t) return;
      flash("глубокий перебор запущен в фоне…");
      var log = t.log || [];
      log.push({ ts: nowSec(), msg: "глубокий перебор (2 слова) запущен в фоне" });
      store.update(id, { status: "green", log: log }).then(function () {
        refresh(); if (!$("task-detail").classList.contains("hidden")) window.openTask(id);
      });
      function finish(twResults, attempts) {
        var seen = {}; (t.results || []).forEach(function (r) { seen[r.phrase] = 1; });
        var added = [];
        (twResults || []).forEach(function (c) {
          if (!seen[c.phrase]) { seen[c.phrase] = 1; added.push({ ts: nowSec(), phrase: c.phrase, stage: "глубокий перебор", reason: c.reason }); }
        });
        var results = (t.results || []).concat(added);
        log.push({ ts: nowSec(), msg: "глубокий перебор: проверено комбинаций " + attempts + ", новых валидных " + added.length });
        var st = t.stats || {};
        var nn = st.words || wcount(t);
        st.space2 = st.space2 != null ? st.space2 : (nn * (nn - 1) / 2) * 2048 * 2048;
        st.deepChecked = (st.deepChecked || 0) + attempts;
        st.remaining2 = Math.max(0, st.space2 - st.deepChecked);
        st.valid = results.length;
        store.update(id, { status: "amber", pausedAt: nowSec(), results: results, log: log, balScanned: false, stats: st }).then(function () {
          refresh(); flash("глубокий перебор завершён: +" + added.length + " фраз");
          if (!$("task-detail").classList.contains("hidden")) window.openTask(id);
        });
      }
      var w = null;
      try { w = new Worker("static/worker.js"); } catch (e) { w = null; }
      if (w) {
        w.onmessage = function (ev) { finish(ev.data.results, ev.data.attempts); w.terminate(); };
        w.onerror = function () { w.terminate(); finish([], 0); };
        w.postMessage({ words: t.words, nums: t.nums, budget: 6000000 });
      } else {
        setTimeout(function () {
          var tw = window.PUHRECOVER ? window.PUHRECOVER.twoWord(t.words, t.nums, 300000) : { results: [], attempts: 0 };
          finish(tw.results, tw.attempts);
        }, 200);
      }
    });
  }
  window.continuePerebor = continuePerebor;

  function goHome() {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    var ht = document.querySelector('.tab[data-target="home"]'); if (ht) ht.classList.add("active");
    document.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("hidden", p.getAttribute("data-pane") !== "home"); });
  }
  function flash(msg) {
    var el = $("toast"); if (!el) return;
    el.textContent = msg; el.className = "toast show";
    clearTimeout(flash._t); flash._t = setTimeout(function () { el.className = "toast"; }, 3000);
  }

  setInterval(function () {
    document.querySelectorAll(".t-run[data-started]").forEach(function (run) {
      run.textContent = dur(Date.now() / 1000 - parseFloat(run.getAttribute("data-started")));
    });
  }, 1000);

  document.addEventListener("DOMContentLoaded", function () {
    refresh();
    var btn = $("btn-start");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var name = ($("nt-name") || {}).value || "";
      var words = ($("nt-words") || {}).value || "", nums = ($("nt-nums") || {}).value || "";
      if (!words.trim() && !nums.trim()) { flash("введи слова или числа"); return; }
      btn.disabled = true; btn.textContent = "⏳ ЗАПУСК…";
      store.create({ name: name, words: words, nums: nums }).then(function (t) {
        btn.disabled = false; btn.textContent = "▶ НАЧАТЬ ПЕРЕБОР";
        if (t) {
          $("nt-name").value = ""; $("nt-words").value = ""; $("nt-nums").value = "";
          goHome(); refresh();
          flash("задание " + t.name + " запущено 🟢 — идёт перебор");
          setTimeout(function () { runPerebor(t.id, words, nums); }, 150);
        } else flash("не удалось создать задание");
      });
    });
  });
})();
