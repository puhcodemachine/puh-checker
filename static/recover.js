/* PUH — интеллектуальный подбор фразы.
   Использует наши данные (слова + числа), а не слепой перебор всего.
   Зависит от window.PUHCORE (checksumOkFromIndices, wordIndex, tokWords) и window.BIP39. */
(function (root) {
  "use strict";
  var C = root.PUHCORE;
  function wl() { return root.BIP39 || []; }

  function lev(a, b) {
    var m = a.length, n = b.length, dp = [], i, j;
    for (i = 0; i <= m; i++) dp[i] = [i];
    for (j = 0; j <= n; j++) dp[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return dp[m][n];
  }

  // УРОВЕНЬ 1 — одно слово: на каждой позиции подставляем все 2048 слов,
  // оставляем те, что дают верную контрольную сумму. (исчерпывающе для 1 ошибки)
  function oneWord(words) {
    var base = wl(), n = words.length, out = [];
    var idx0 = words.map(function (w) { return C.wordIndex(w); });
    for (var pos = 0; pos < n; pos++) {
      var orig = words[pos], oi = idx0[pos];
      for (var c = 0; c < 2048; c++) {
        if (base[c] === orig) continue;
        var idx = idx0.slice(); idx[pos] = c;
        var ok = true;
        for (var k = 0; k < n; k++) if (idx[k] < 0) { ok = false; break; }
        if (!ok) continue;
        if (C.checksumOkFromIndices(idx)) {
          var cand = words.slice(); cand[pos] = base[c];
          out.push({ kind: "одно слово", pos: pos, from: orig, to: base[c], words: cand,
                     edit: lev(orig || "", base[c]), idxDelta: oi >= 0 ? Math.abs(c - oi) : null });
        }
      }
    }
    return out;
  }

  // УРОВЕНЬ 2а — перестановка двух соседних слов
  function transpose(words) {
    var out = [], n = words.length;
    var idx = words.map(function (w) { return C.wordIndex(w); });
    if (idx.indexOf(-1) !== -1) return out;
    for (var i = 0; i + 1 < n; i++) {
      var t = idx.slice(), tmp = t[i]; t[i] = t[i + 1]; t[i + 1] = tmp;
      if (C.checksumOkFromIndices(t)) {
        var cand = words.slice(), w = cand[i]; cand[i] = cand[i + 1]; cand[i + 1] = w;
        out.push({ kind: "перестановка соседних", pos: i, from: words[i] + " ↔ " + words[i + 1],
                   to: cand[i] + " " + cand[i + 1], words: cand, edit: 0, idxDelta: 0 });
      }
    }
    return out;
  }

  // вероятность правки: близкая опечатка (малый edit) и малый сдвиг индекса = вероятнее
  function scoreOf(r) {
    var e = (r.edit == null ? 3 : r.edit);
    var d = (r.idxDelta == null ? 60 : Math.min(r.idxDelta, 400));
    return e * 1000 + d;
  }

  // УРОВЕНЬ 2б — ЯКОРЬ ИЗ ЧИСЕЛ: на расхождениях слово↔число пробуем оба значения.
  // Самый сильный приём: числа подсказывают задуманный индекс, даже если слово записано неверно.
  function dataConsistent(words, numsText) {
    var nums = C.tokNums(numsText || "");
    if (!nums.length || nums.length !== words.length) return [];
    var wIdx = words.map(function (w) { return C.wordIndex(w); });
    function miss(base) { var c = 0; for (var i = 0; i < words.length; i++) if (wIdx[i] !== nums[i] - base) c++; return c; }
    var base = miss(0) <= miss(1) ? 0 : 1;           // верная база даёт минимум расхождений
    var nIdx = nums.map(function (n) { return n - base; });
    var mism = [];
    for (var i = 0; i < words.length; i++) if (wIdx[i] !== nIdx[i]) mism.push(i);
    if (mism.length === 0 || mism.length > 16) return [];
    var out = [], combos = 1 << mism.length;
    for (var c = 1; c < combos; c++) {                 // c=0 = все слова = исходник, его пропускаем
      var idx = wIdx.slice(), bad = false, changed = [];
      for (var b = 0; b < mism.length; b++) {
        var p = mism[b];
        if (c & (1 << b)) { idx[p] = nIdx[p]; changed.push(p); }
      }
      for (var k = 0; k < idx.length; k++) if (idx[k] < 0 || idx[k] > 2047) { bad = true; break; }
      if (bad) continue;
      if (C.checksumOkFromIndices(idx)) {
        var cand = idx.map(function (x) { return wl()[x]; });
        out.push({ kind: "сверка слова↔числа", words: cand, edit: 0, idxDelta: 0,
                   changedCount: changed.length,
                   from: changed.map(function (p) { return (p + 1) + ":" + (words[p] || "—"); }).join(", "),
                   to: changed.map(function (p) { return (p + 1) + ":" + wl()[nIdx[p]]; }).join(", ") });
      }
    }
    return out;
  }

  // Оркестратор: собирает кандидатов всех уровней, дедуп, ранжирует по вероятности
  function recover(wordsText, numsText) {
    var words = C.tokWords(wordsText), cands = [];
    if (!words.length) return [];
    var dc = dataConsistent(words, numsText);     // приоритетные (по данным)
    cands = cands.concat(dc).concat(oneWord(words)).concat(transpose(words));
    var seen = {}, uniq = [];
    cands.forEach(function (r) {
      var key = r.words.join(" ");
      if (!seen[key]) {
        seen[key] = 1;
        // кандидаты по сверке с числами — максимальный приоритет (меньше изменений = выше)
        r.score = (r.kind === "сверка слова↔числа") ? (-100000 + (r.changedCount || 1)) : scoreOf(r);
        r.phrase = key; uniq.push(r);
      }
    });
    uniq.sort(function (a, b) { return a.score - b.score; });
    return uniq;
  }

  // ГЛУБОКИЙ УРОВЕНЬ — два слова: логично (фокус на подозрительных позициях), с бюджетом
  function twoWord(wordsText, numsText, maxAttempts) {
    var words = C.tokWords(wordsText), n = words.length, base = wl(), out = [];
    if (n < 12) return { results: out, attempts: 0 };
    var idx0 = words.map(function (w) { return C.wordIndex(w); });
    var nums = C.tokNums(numsText || "");
    var suspect = [];
    if (nums.length === n) {
      function miss(b) { var c = 0; for (var i = 0; i < n; i++) if (idx0[i] !== nums[i] - b) c++; return c; }
      var b = miss(0) <= miss(1) ? 0 : 1;
      for (var i = 0; i < n; i++) if (idx0[i] !== nums[i] - b) suspect.push(i);
    }
    for (var k = 0; k < n; k++) if (idx0[k] === -1 && suspect.indexOf(k) < 0) suspect.push(k);
    var pos = suspect.length >= 2 ? suspect.slice() : [];
    for (var p = 0; p < n; p++) pos.push(p);
    pos = pos.filter(function (v, ix) { return pos.indexOf(v) === ix; });
    var attempts = 0, seen = {};
    for (var pi = 0; pi < pos.length; pi++) {
      for (var pj = pi + 1; pj < pos.length; pj++) {
        var ii = pos[pi], jj = pos[pj], ok = true;
        for (var z = 0; z < n; z++) if (z !== ii && z !== jj && idx0[z] === -1) { ok = false; break; }
        if (!ok) continue;
        for (var a = 0; a < 2048; a++) {
          for (var c2 = 0; c2 < 2048; c2++) {
            if (++attempts > maxAttempts) return { results: out, attempts: attempts };
            var idx = idx0.slice(); idx[ii] = a; idx[jj] = c2;
            if (C.checksumOkFromIndices(idx)) {
              var cand = words.slice(); cand[ii] = base[a]; cand[jj] = base[c2];
              var key = cand.join(" ");
              if (!seen[key]) { seen[key] = 1; out.push({ kind: "два слова", words: cand, phrase: key, reason: "два слова: поз." + (ii + 1) + "," + (jj + 1) }); }
            }
          }
        }
      }
    }
    return { results: out, attempts: attempts };
  }

  root.PUHRECOVER = { oneWord: oneWord, transpose: transpose, dataConsistent: dataConsistent, recover: recover, twoWord: twoWord };
})(typeof window !== "undefined" ? window : globalThis);
