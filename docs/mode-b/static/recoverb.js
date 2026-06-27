/* ПУХ · Режим Б — РАЦИОНАЛЬНОЕ восстановление: коррекция вокруг базы с малым бюджетом правок.
   Не генератор. Кандидаты только близкие к записанным данным; далёкие отсекаются.
   Зависит от window.PUHCORE (checksumOkFromIndices, tokWords, tokNums, wordIndex) и window.BIP39. */
(function (root) {
  "use strict";
  var C = root.PUHCORE;
  function wl() { return root.BIP39 || []; }

  function lev(a, b) {
    var m = a.length, n = b.length, dp = [], i, j;
    for (i = 0; i <= m; i++) dp[i] = [i];
    for (j = 0; j <= n; j++) dp[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[m][n];
  }
  // слова словаря в edit-distance <= maxD от word -> [{idx, d}]
  function wordNeighbors(word, maxD) {
    var out = [], list = wl();
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].length - word.length) > maxD) continue;
      var d = lev(word, list[i]);
      if (d > 0 && d <= maxD) out.push({ idx: i, d: d });
    }
    return out;
  }
  // индексы, достижимые из числа n одной правкой цифры или ±1
  function numNeighbors(n) {
    var s = "" + n, seen = {}, res = [];
    function add(v) { if (v >= 0 && v <= 2047 && v !== n && !seen[v]) { seen[v] = 1; res.push(v); } }
    for (var i = 0; i < s.length; i++) for (var d = 0; d <= 9; d++) add(parseInt(s.slice(0, i) + d + s.slice(i + 1), 10)); // замена цифры
    for (i = 0; i <= s.length; i++) for (d = 0; d <= 9; d++) add(parseInt(s.slice(0, i) + d + s.slice(i), 10));         // вставка
    for (i = 0; i < s.length; i++) add(parseInt(s.slice(0, i) + s.slice(i + 1), 10) || -1);                              // удаление
    add(n - 1); add(n + 1);                                                                                              // off-by-one
    return res;
  }

  // главный движок: возвращает {candidates:[{phrase,cost,ops,reason}], stages:{...}, exhausted}
  function recover(wordsText, numsText, budget) {
    budget = budget || 2;
    var words = C.tokWords(wordsText), nums = C.tokNums(numsText || ""), n = words.length;
    var out = { candidates: [], stages: { oneWord: 0, twoWord: 0, transpose: 0, number: 0 }, n: n, budget: budget };
    if (n < 12) { out.note = "слишком мало слов (" + n + ")"; return out; }
    var idx = words.map(function (w) { return C.wordIndex(w); });
    var base = 0, nIdx = null;
    if (nums.length === n) {
      var miss = function (b) { var c = 0; for (var i = 0; i < n; i++) if (idx[i] !== nums[i] - b) c++; return c; };
      base = miss(0) <= miss(1) ? 0 : 1;
      nIdx = nums.map(function (x) { return x - base; });
    }
    // варианты индекса на позиции i: {candIdx: minCost}
    function options(i) {
      var opts = {};
      function put(ci, cost) { if (ci >= 0 && ci <= 2047 && ci !== idx[i]) opts[ci] = Math.min(opts[ci] == null ? 99 : opts[ci], cost); }
      if (words[i]) wordNeighbors(words[i], 2).forEach(function (o) { put(o.idx, o.d); });   // опечатка слова
      if (nIdx) put(nIdx[i], 1);                                                              // числовой якорь
      if (nums.length === n) numNeighbors(nums[i]).forEach(function (v) { put(v - base, 1); }); // ошибка цифры
      return opts;
    }
    var seen = {};
    function addCand(cand, cost, ops, stage) {
      var phrase = cand.map(function (x) { return wl()[x]; }).join(" ");
      if (seen[phrase] != null) { if (cost < seen[phrase]) seen[phrase] = cost; return; }
      seen[phrase] = cost;
      var numMatch = !!nIdx && cand.every(function (x, k) { return x === nIdx[k]; });
      out.candidates.push({ phrase: phrase, cost: cost, ops: ops, stage: stage, numMatch: numMatch });
    }
    var invalidPos = []; for (var i = 0; i < n; i++) if (idx[i] === -1) invalidPos.push(i);
    var suspect = []; for (i = 0; i < n; i++) if (idx[i] === -1 || (nIdx && idx[i] !== nIdx[i])) suspect.push(i);
    var positions = suspect.length ? suspect : range(n);

    // 1 ошибка
    positions.forEach(function (i) {
      if (invalidPos.length > (invalidPos.indexOf(i) >= 0 ? 1 : 0)) return; // ещё есть невалидные кроме i
      var opts = options(i);
      Object.keys(opts).forEach(function (ci) {
        ci = +ci; var cost = opts[ci]; if (cost > budget) return;
        var cand = idx.slice(); cand[i] = ci;
        if (cand.indexOf(-1) !== -1) return;
        out.stages.oneWord++;
        if (C.checksumOkFromIndices(cand)) addCand(cand, cost, [{ pos: i + 1, from: words[i] || ("#" + (nums[i] || "?")), to: wl()[ci] }], "1 правка");
      });
    });
    // перестановка соседних
    if (invalidPos.length === 0) {
      for (i = 0; i + 1 < n; i++) { var t = idx.slice(); var tmp = t[i]; t[i] = t[i + 1]; t[i + 1] = tmp; out.stages.transpose++; if (C.checksumOkFromIndices(t)) addCand(t, 1, [{ pos: (i + 1) + "/" + (i + 2), from: "перестановка", to: words[i + 1] + " " + words[i] }], "перестановка"); }
    }
    // 2 ошибки (только по подозрительным позициям)
    if (budget >= 2) {
      var ps = suspect.length >= 2 ? suspect : positions;
      for (var a = 0; a < ps.length; a++) for (var b = a + 1; b < ps.length; b++) {
        var pi = ps[a], pj = ps[b];
        var otherInvalid = invalidPos.filter(function (k) { return k !== pi && k !== pj; }).length;
        if (otherInvalid) continue;
        var oi = options(pi), oj = options(pj), ki = Object.keys(oi), kj = Object.keys(oj);
        for (var x = 0; x < ki.length; x++) for (var y = 0; y < kj.length; y++) {
          var ci = +ki[x], cj = +kj[y], cost = oi[ci] + oj[cj]; if (cost > budget) continue;
          var cand = idx.slice(); cand[pi] = ci; cand[pj] = cj;
          if (cand.indexOf(-1) !== -1) continue;
          out.stages.twoWord++;
          if (C.checksumOkFromIndices(cand)) addCand(cand, cost, [{ pos: pi + 1, to: wl()[ci] }, { pos: pj + 1, to: wl()[cj] }], "2 правки");
        }
      }
    }
    out.candidates.sort(function (p, q) { if (p.numMatch !== q.numMatch) return p.numMatch ? -1 : 1; return p.cost - q.cost; });
    out.exhausted = true; // прошли весь радиус бюджета — дальше честно стоп
    return out;
  }
  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }

  root.PUHRECB = { recover: recover, wordNeighbors: wordNeighbors };
})(typeof window !== "undefined" ? window : globalThis);
