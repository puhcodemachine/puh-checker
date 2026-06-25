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
  window.openTask = function () { /* раскрытие задания на всю страницу — следующий шаг */ };

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
    document.querySelectorAll(".task[data-started]").forEach(function (el) {
      var run = el.querySelector(".t-run");
      if (run && run.textContent !== "--:--:--")
        run.textContent = dur(Date.now() / 1000 - parseFloat(el.getAttribute("data-started")));
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
