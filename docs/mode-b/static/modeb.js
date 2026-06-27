/* ПУХ · Режим Б — страница восстановления. Кандидаты в пределах бюджета правок,
   сохранение в общее хранилище puh_tasks (mode B), связка Б→А (проверка активности). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nowSec() { return Date.now() / 1000; }
  function fmtDT(ts) { var d = new Date(ts * 1000); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  var LS = "puh_tasks", curId = null, lastCands = null;
  function load() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function onlyB(a) { return (a || []).filter(function (t) { return t.mode === "B" && !t.deleted; }); }

  function opsText(ops) {
    return (ops || []).map(function (o) {
      if (o.from === "перестановка") return "перестановка → " + esc(o.to);
      return "поз." + o.pos + ": " + esc(o.from || "—") + " → " + esc(o.to);
    }).join(" · ");
  }
  function aLink(phrase) { return "../mode-a/?seed=" + encodeURIComponent(phrase); }

  function renderCands(res) {
    var s = $("summary"), c = $("cands");
    var cands = res.candidates;
    s.classList.remove("hidden");
    if (res.note) {
      s.className = "summary miss";
      s.innerHTML = "○ " + esc(res.note) + " — для восстановления нужно минимум 12 слов.";
      c.innerHTML = ""; $("save").classList.add("hidden"); return;
    }
    if (cands.length) {
      s.className = "summary hit";
      s.innerHTML = "● Найдено правок: <b>" + cands.length + "</b> в пределах бюджета " + res.budget +
        " (проверено комбинаций: " + (res.stages.oneWord + res.stages.twoWord + res.stages.transpose) + "). Каждый — близкая правка твоих данных. Проверь активность в Режиме А.";
    } else {
      s.className = "summary miss";
      s.innerHTML = "○ В пределах " + res.budget + " правок валидной фразы НЕ найдено. " +
        "Вероятно: ошибок больше двух, неверен источник/порядок/язык, либо не хватает слова. Бесконечный перебор мы не делаем — это и есть честная остановка.";
    }
    c.innerHTML = cands.slice(0, 200).map(function (k, i) {
      var badge = k.numMatch ? '<span class="nm">✓ совпадает с цифровым кодом</span>' : "";
      return '<div class="cand' + (k.numMatch ? " best" : "") + '"><div class="cphrase">' + (i + 1) + ". " + esc(k.phrase) + "</div>" +
        '<div class="cmeta">' + badge + '<span class="cost">правок: ' + k.cost + " · " + esc(k.stage) + "</span>" +
        "<span>" + opsText(k.ops) + "</span>" +
        '<a class="toA" href="' + aLink(k.phrase) + '">→ проверить в Режиме А ↗</a></div></div>';
    }).join("");
    $("save").classList.toggle("hidden", !cands.length);
  }

  function run() {
    var C = window.PUHCORE, R = window.PUHRECB;
    var words = ($("words").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var nums = ($("nums").value || "").trim();
    if (!words) { $("words-status").className = "vstatus red"; $("words-status").textContent = "введите слова"; return; }
    var budget = parseInt($("budget").value, 10) || 2;
    var btn = $("run"); btn.disabled = true; btn.textContent = "⏳ ИЩУ…";
    setTimeout(function () {
      var res = R.recover(words, nums, budget);
      lastCands = res.candidates;
      renderCands(res);
      btn.disabled = false; btn.textContent = "▶ ВОССТАНОВИТЬ";
    }, 30);
  }

  function saveTask() {
    if (!lastCands) return;
    var all = load(), now = nowSec();
    var words = ($("words").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var nums = ($("nums").value || "").trim();
    var wcount = (words.match(/[a-z]+/g) || []).length;
    var name = ($("name").value || "").trim() || "Восстановление " + (onlyB(all).length + 1);
    var results = lastCands.slice(0, 200).map(function (k) { return { ts: now, phrase: k.phrase, reason: "правок: " + k.cost + " · " + k.stage + " · " + opsText(k.ops).replace(/<[^>]+>/g, "") }; });
    var log = [{ ts: now, msg: "восстановление: найдено правок " + lastCands.length + " (бюджет правок)" }];
    var type = "восстановление · " + wcount + " слов";
    var found = false;
    all.forEach(function (t) { if (t.id === curId) { t.name = name; t.words = words; t.nums = nums; t.results = results; t.log = log; t.status = results.length ? "amber" : "green"; t.pausedAt = now; t.lastCheck = now; found = true; } });
    if (!found) {
      curId = Math.random().toString(16).slice(2, 8);
      all.push({ id: curId, name: name, mode: "B", type: type, status: results.length ? "amber" : "green", words: words, nums: nums, results: results, log: log, created: now, started: now, pausedAt: now });
    }
    save(all);
    var sb = $("save"); sb.textContent = "✓ СОХРАНЕНО — видно в панели"; sb.disabled = true;
    setTimeout(function () { sb.textContent = "💾 СОХРАНИТЬ ЗАДАЧУ"; sb.disabled = false; }, 1800);
    renderTaskList();
  }

  function renderTaskList() {
    var tasks = onlyB(load()), wrap = $("tasks-wrap"), el = $("task-list");
    if (!tasks.length) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    el.innerHTML = tasks.map(function (t) {
      return '<div class="b-task" onclick="bOpen(\'' + t.id + '\')"><span class="b-name">' + esc(t.name) + "</span>" +
        '<span class="b-meta">правок: ' + (t.results || []).length + " · " + fmtDT(t.lastCheck || t.created) + "</span><span>→</span></div>";
    }).join("");
  }
  window.bOpen = function (id) {
    var t = load().filter(function (x) { return x.id === id; })[0]; if (!t) return;
    curId = id; $("name").value = t.name; $("words").value = t.words || ""; $("nums").value = t.nums || "";
    // показать сохранённых кандидатов
    lastCands = (t.results || []).map(function (r) { return { phrase: r.phrase, cost: 0, stage: "сохранено", ops: [] }; });
    var s = $("summary"); s.classList.remove("hidden"); s.className = "summary hit";
    s.innerHTML = "● Сохранённая задача · кандидатов: " + (t.results || []).length + " · " + fmtDT(t.lastCheck || t.created);
    $("cands").innerHTML = (t.results || []).map(function (r, i) {
      return '<div class="cand"><div class="cphrase">' + (i + 1) + ". " + esc(r.phrase) + "</div>" +
        '<div class="cmeta"><span class="cost">' + esc(r.reason || "") + "</span>" +
        '<a class="toA" href="' + aLink(r.phrase) + '">→ проверить в Режиме А ↗</a></div></div>';
    }).join("");
    $("save").classList.remove("hidden");
    window.scrollTo(0, ($("form-h1") || {}).offsetTop || 0);
  };

  document.addEventListener("DOMContentLoaded", function () {
    var tw = $("words");
    tw.addEventListener("input", function () {
      var C = window.PUHCORE, el = $("words-status");
      if (!tw.value.trim()) { el.className = "vstatus muted"; el.textContent = "введите слова"; return; }
      var v = C.validateWords((tw.value || "").trim().toLowerCase());
      el.className = "vstatus " + (v.checksum === true ? "green" : v.level);
      el.textContent = v.checksum === true ? "✓ фраза уже валидна (восстановление не требуется)" : v.msg;
    });
    $("run").addEventListener("click", run);
    $("save").addEventListener("click", saveTask);
    renderTaskList();
  });
})();
