/* PUH — список активных заданий + кнопка «Начать задание».
   Работает И с сервером (API), И без него (статичный Pages → localStorage). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var EMPTY = '<div class="empty-tasks">нет активных заданий<br><span>создай новое во вкладке «Новое задание»</span></div>';

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function dur(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec % 3600 / 60)) + ":" + pad(sec % 60); }
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmtDateTime(ts) { var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + "  " + clock(ts); }

  // ---------- хранилище: сервер, иначе localStorage ----------
  var LS = "puh_tasks";
  function lsLoad() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function lsSave(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function lsSummary(t) {
    return { id: t.id, name: t.name, type: t.type, status: t.status, modes: t.modes,
             created: t.created, started: t.started, stopped: t.stopped, results: (t.results || []).length };
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
    var status = uniq.length ? "amber" : "green";
    log.push({ ts: nowSec(), msg: uniq.length
      ? "ИТОГ: найдено валидных фраз: " + uniq.length + " → требуется проверка (жёлтый сигнал)"
      : "ИТОГ: на 1-м уровне совпадений нет — нужен более глубокий перебор (2+ ошибки)" });
    return store.update(taskId, { status: status, results: uniq, log: log, done: true })
      .then(function () { refresh(); });
  }
  window.runPereborDemo = runPerebor;

  // ---------- рендер ----------
  function statusInfo(s) {
    if (s === "green") return { lamp: "green", cls: "green", txt: "● РАБОТАЕТ" };
    if (s === "amber") return { lamp: "amber", cls: "amber", txt: "◐ НУЖНА ПРОВЕРКА" };
    return { lamp: "red", cls: "red", txt: "■ ОСТАНОВЛЕНО" };
  }
  function runSpan(t, cls) {
    if (t.status !== "red")  // green/amber — идёт/найдено: тикаем живое время
      return '<span class="' + cls + ' t-run" data-started="' + t.started + '">' + dur(Date.now() / 1000 - t.started) + "</span>";
    return '<span class="' + cls + ' t-run">' + (t.stopped ? dur(t.stopped - t.started) : "--:--:--") + "</span>";
  }
  function cardHtml(t) {
    var si = statusInfo(t.status);
    return '<div class="task" data-id="' + t.id + '" onclick="openTask(\'' + t.id + '\')">' +
      '<div class="task-top"><span class="task-name">' + esc(t.name) + '</span><span class="lamp ' + si.lamp + '"></span></div>' +
      '<div class="task-status ' + si.cls + '">' + si.txt + '</div>' +
      '<div class="task-type">тип: ' + esc(t.type) + '</div>' +
      '<div class="task-meta"><span>ЗАПУСК<span class="v">' + clock(t.started) + '</span></span>' +
      '<span style="text-align:right">В РАБОТЕ' + runSpan(t, "v") + '</span></div></div>';
  }
  function render(tasks) {
    var list = $("task-list"), cnt = $("task-count");
    if (cnt) cnt.textContent = "[ " + tasks.length + " ]";
    if (list) list.innerHTML = tasks.length ? tasks.map(cardHtml).join("") : EMPTY;
  }
  function refresh() { store.list().then(render); }
  window.refreshTasks = refresh;
  window.renderTasksDirect = render;

  function renderDetail(t) {
    var si = statusInfo(t.status), m = t.modes || {}, res = t.results || [];
    $("td-name").textContent = t.name;
    $("td-lamp").className = "lamp " + si.lamp;
    var h = "";
    h += '<div class="td-sec"><div class="td-h">СТАТУС И ВРЕМЯ</div><div class="td-grid">' +
      '<span class="k">СТАТУС</span><span class="val ' + si.cls + '">' + si.txt + "</span>" +
      '<span class="k">ТИП</span><span class="val">' + esc(t.type) + "</span>" +
      '<span class="k">ЗАПУСК</span><span class="val">' + fmtDateTime(t.started) + "</span>" +
      '<span class="k">ОБЩЕЕ ВРЕМЯ В РАБОТЕ</span>' + runSpan(t, "val") + "</div></div>";
    h += '<div class="td-sec"><div class="td-h">МАТЕРИАЛ ЗАДАНИЯ</div>';
    if (t.words) h += '<div class="td-k">СЛОВА</div><div class="td-mat">' + esc(t.words) + "</div>";
    if (t.nums) h += '<div class="td-k" style="margin-top:10px">ЦИФРОВОЙ КОД</div><div class="td-mat">' + esc(t.nums) + "</div>";
    h += "</div>";
    h += '<div class="td-sec"><div class="td-h">РЕЖИМЫ РАБОТЫ</div><div class="td-chips">' +
      '<span class="td-chip ' + (m.podbor ? "on" : "") + '">ПОДБОР · ' + (m.podbor ? "ВКЛ" : "выкл") + "</span>" +
      '<span class="td-chip ' + (m.monitor ? "on" : "") + '">МОНИТОРИНГ · ' + (m.monitor ? "ВКЛ" : "выкл") + "</span></div></div>";
    h += '<div class="td-sec"><div class="td-h">РЕЗУЛЬТАТЫ — ВАЛИДНЫЕ ФРАЗЫ (' + res.length + ")</div>";
    h += res.length
      ? res.map(function (r) {
          return '<div class="td-res-row"><span class="ts">' + fmtDateTime(r.ts) +
            '</span><span><div class="rphrase">' + esc(r.phrase) + '</div><div class="rreason">' + esc(r.reason || r.stage || "") + "</div></span></div>";
        }).join("")
      : '<div class="td-empty">валидных фраз пока нет</div>';
    h += "</div>";

    var lg = t.log || [];
    h += '<div class="td-sec"><div class="td-h">ЖУРНАЛ ЗАДАНИЯ — БАЗА (' + lg.length + ")</div>";
    h += lg.length
      ? lg.map(function (e) { return '<div class="td-log-row"><span class="ts">' + fmtDateTime(e.ts) + "</span><span>" + esc(e.msg) + "</span></div>"; }).join("")
      : '<div class="td-empty">журнал пуст</div>';
    h += "</div>";

    $("td-inner").innerHTML = h;
    var stop = $("td-stop");
    if (stop) {
      if (t.status === "green") { stop.classList.remove("hidden"); stop.onclick = function () { confirmStop(t.id, t.name); }; }
      else { stop.classList.add("hidden"); stop.onclick = null; }
    }
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

  window.openTask = function (id) {
    store.get(id).then(function (t) {
      if (t) { renderDetail(t); $("task-detail").classList.remove("hidden"); }
      else flash("задание не найдено");
    });
  };
  window.closeTask = function () { $("task-detail").classList.add("hidden"); };
  window.openDetailDirect = function (t) { renderDetail(t); $("task-detail").classList.remove("hidden"); };

  function goHome() {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
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
