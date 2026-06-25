/* PUH — список активных заданий слева + кнопка «Начать задание». */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var EMPTY = '<div class="empty-tasks">нет активных заданий<br><span>создай новое во вкладке «Новое задание»</span></div>';

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function dur(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec % 3600 / 60)) + ":" + pad(sec % 60); }
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function statusInfo(s) {
    if (s === "green") return { lamp: "green", cls: "green", txt: "● РАБОТАЕТ" };
    if (s === "amber") return { lamp: "amber", cls: "amber", txt: "◐ НУЖНА ПРОВЕРКА" };
    return { lamp: "red", cls: "red", txt: "✕ ОШИБКА" };
  }

  function cardHtml(t) {
    var si = statusInfo(t.status), running = t.status === "green";
    return '<div class="task" data-id="' + t.id + '" data-started="' + t.started + '" onclick="openTask(\'' + t.id + '\')">' +
      '<div class="task-top"><span class="task-name">' + esc(t.name) + '</span><span class="lamp ' + si.lamp + '"></span></div>' +
      '<div class="task-status ' + si.cls + '">' + si.txt + '</div>' +
      '<div class="task-type">тип: ' + esc(t.type) + '</div>' +
      '<div class="task-meta"><span>ЗАПУСК<span class="v">' + clock(t.started) + '</span></span>' +
      '<span style="text-align:right">В РАБОТЕ<span class="v t-run">' + (running ? dur(Date.now() / 1000 - t.started) : "--:--:--") + '</span></span></div>' +
      '</div>';
  }

  function render(tasks) {
    var list = $("task-list"), cnt = $("task-count");
    if (cnt) cnt.textContent = "[ " + tasks.length + " ]";
    if (list) list.innerHTML = tasks.length ? tasks.map(cardHtml).join("") : EMPTY;
  }

  function refresh() {
    fetch("/api/tasks").then(function (r) { return r.json(); })
      .then(function (d) { if (d.tasks) render(d.tasks); }).catch(function () {});
  }
  window.refreshTasks = refresh;
  window.renderTasksDirect = render;  // для офлайн-предпросмотра

  function fmtDateTime(ts) {
    var d = new Date(ts * 1000);
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + "  " + clock(ts);
  }

  function renderDetail(t) {
    var si = statusInfo(t.status), m = t.modes || {}, res = t.results || [];
    $("td-name").textContent = t.name;
    $("td-lamp").className = "lamp " + si.lamp;
    var h = "";
    h += '<div class="td-sec"><div class="td-h">СТАТУС И ВРЕМЯ</div><div class="td-grid">' +
      '<span class="k">СТАТУС</span><span class="val ' + si.cls + '">' + si.txt + "</span>" +
      '<span class="k">ТИП</span><span class="val">' + esc(t.type) + "</span>" +
      '<span class="k">ЗАПУСК</span><span class="val">' + fmtDateTime(t.started) + "</span>" +
      '<span class="k">ОБЩЕЕ ВРЕМЯ В РАБОТЕ</span><span class="val t-run" data-started="' + t.started + '">' +
        (t.status === "green" ? dur(Date.now() / 1000 - t.started) : "--:--:--") + "</span>" +
      "</div></div>";

    h += '<div class="td-sec"><div class="td-h">МАТЕРИАЛ ЗАДАНИЯ</div>';
    if (t.words) h += '<div class="td-k">СЛОВА</div><div class="td-mat">' + esc(t.words) + "</div>";
    if (t.nums) h += '<div class="td-k" style="margin-top:10px">ЦИФРОВОЙ КОД</div><div class="td-mat">' + esc(t.nums) + "</div>";
    h += "</div>";

    h += '<div class="td-sec"><div class="td-h">РЕЖИМЫ РАБОТЫ</div><div class="td-chips">' +
      '<span class="td-chip ' + (m.podbor ? "on" : "") + '">ПОДБОР · ' + (m.podbor ? "ВКЛ" : "выкл") + "</span>" +
      '<span class="td-chip ' + (m.monitor ? "on" : "") + '">МОНИТОРИНГ · ' + (m.monitor ? "ВКЛ" : "выкл") + "</span>" +
      "</div></div>";

    h += '<div class="td-sec"><div class="td-h">РЕЗУЛЬТАТЫ (' + res.length + ")</div>";
    if (res.length) {
      h += res.map(function (r) {
        return '<div class="td-res-row"><span class="ts">' + fmtDateTime(r.ts) + "</span><span>" + esc(r.phrase) + "</span></div>";
      }).join("");
    } else {
      h += '<div class="td-empty">результатов пока нет — движок перебора ещё не запущен (следующий шаг)</div>';
    }
    h += "</div>";

    $("td-inner").innerHTML = h;
  }

  window.openTask = function (id) {
    fetch("/api/tasks/" + id).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.task) { renderDetail(d.task); $("task-detail").classList.remove("hidden"); }
        else flash("задание не найдено");
      }).catch(function () { flash("сеть недоступна"); });
  };
  window.closeTask = function () { $("task-detail").classList.add("hidden"); };
  window.openDetailDirect = function (t) { renderDetail(t); $("task-detail").classList.remove("hidden"); };  // офлайн-предпросмотр

  function goHome() {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".pane").forEach(function (p) {
      p.classList.toggle("hidden", p.getAttribute("data-pane") !== "home");
    });
  }

  function flash(msg) {
    var el = $("toast"); if (!el) return;
    el.textContent = msg; el.className = "toast show";
    clearTimeout(flash._t); flash._t = setTimeout(function () { el.className = "toast"; }, 3000);
  }

  // живой счётчик «В РАБОТЕ»
  setInterval(function () {
    document.querySelectorAll(".t-run").forEach(function (run) {
      var host = run.closest("[data-started]");
      if (host && run.textContent !== "--:--:--")
        run.textContent = dur(Date.now() / 1000 - parseFloat(host.getAttribute("data-started")));
    });
  }, 1000);

  document.addEventListener("DOMContentLoaded", function () {
    refresh();
    var btn = $("btn-start");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var words = ($("ta-words") || {}).value || "";
      var nums = ($("ta-nums") || {}).value || "";
      var podbor = !!($("tg-podbor") || {}).checked;
      var monitor = !!($("tg-monitor") || {}).checked;
      if (!words.trim() && !nums.trim()) { flash("строки пустые — введи слова или числа"); return; }
      btn.disabled = true; btn.textContent = "⏳ СОЗДАЮ…";
      fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: words, nums: nums, podbor: podbor, monitor: monitor }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          btn.disabled = false; btn.textContent = "▶ НАЧАТЬ ЗАДАНИЕ";
          if (d.ok) {
            $("ta-words").value = ""; $("ta-nums").value = "";
            if ($("tg-podbor")) $("tg-podbor").checked = false;
            if ($("tg-monitor")) $("tg-monitor").checked = false;
            $("ta-words").dispatchEvent(new Event("input"));
            goHome(); refresh();
            flash("задание " + d.task.name + " запущено 🟢");
          } else { flash("ошибка: " + (d.error || "не создано")); }
        })
        .catch(function () { btn.disabled = false; btn.textContent = "▶ НАЧАТЬ ЗАДАНИЕ"; flash("сеть недоступна"); });
    });
  });
})();
