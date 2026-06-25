/* PUH checker — клиентская проверка строки слов и сверка с цифрами.
   Всё считается в браузере: сид-фраза при наборе на сервер НЕ уходит. */
(function (root) {
  "use strict";

  // ---------- SHA-256 (чистый JS, работает и по http) ----------
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(bytes) {
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l = bytes.length, withOne = l + 1;
    var pad = (56 - (withOne % 64) + 64) % 64, total = withOne + pad + 8;
    var m = new Uint8Array(total);
    m.set(bytes); m[l] = 0x80;
    var dv = new DataView(m.buffer);
    var bitLen = l * 8;
    dv.setUint32(total - 4, bitLen >>> 0, false);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var s0 = rrot(w[i-15],7) ^ rrot(w[i-15],18) ^ (w[i-15] >>> 3);
        var s1 = rrot(w[i-2],17) ^ rrot(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    var out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, H[i], false);
    return out;
  }

  // ---------- BIP39 ----------
  var VALID_LEN = [12, 15, 18, 21, 24];
  function wl() { return root.BIP39 || []; }
  var _idx = null;
  function idxMap() {
    if (!_idx) { _idx = {}; var w = wl(); for (var i = 0; i < w.length; i++) _idx[w[i]] = i; }
    return _idx;
  }
  function wordIndex(w) { var m = idxMap(); return (w in m) ? m[w] : -1; }

  function bip39ChecksumOk(words) {
    var idx = words.map(wordIndex);
    if (idx.indexOf(-1) !== -1) return false;
    var bits = idx.map(function (i) { return ("00000000000" + i.toString(2)).slice(-11); }).join("");
    var total = words.length * 11, cs = total / 33, entBits = total - cs;
    var entropy = bits.slice(0, entBits), csBits = bits.slice(entBits);
    var bytes = new Uint8Array(entBits / 8);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(entropy.substr(i * 8, 8), 2);
    var h = sha256(bytes), hashBits = "";
    for (i = 0; i < Math.ceil(cs / 8); i++) hashBits += ("00000000" + h[i].toString(2)).slice(-8);
    return hashBits.slice(0, cs) === csBits;
  }

  function levenshtein(a, b) {
    var m = a.length, n = b.length, dp = [], i, j;
    for (i = 0; i <= m; i++) dp[i] = [i];
    for (j = 0; j <= n; j++) dp[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return dp[m][n];
  }
  function suggest(w) {
    var best = null, bd = 99, list = wl();
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].length - w.length) > 2) continue;
      var d = levenshtein(w, list[i]);
      if (d < bd) { bd = d; best = list[i]; if (d === 1) break; }
    }
    return bd <= 2 ? best : null;
  }

  function tokWords(text) { return (text.toLowerCase().match(/[a-z]+/g) || []); }
  function tokNums(text) { return (text.match(/\d+/g) || []).map(Number); }

  // ---------- проверка строки слов ----------
  function validateWords(text) {
    var tokens = tokWords(text);
    var bad = [];
    tokens.forEach(function (t, i) {
      if (wordIndex(t) === -1) bad.push({ i: i, tok: t, sug: suggest(t) });
    });
    var n = tokens.length, countOk = VALID_LEN.indexOf(n) !== -1;
    var res = { tokens: tokens, count: n, countOk: countOk, bad: bad, checksum: null, level: "muted", msg: "" };

    if (n === 0) { res.msg = "введите слова сид-фразы"; return res; }
    var parts = [];
    if (bad.length) {
      res.level = "red";
      parts.push("неизвестных слов: " + bad.length);
      var hint = bad.slice(0, 3).map(function (b) {
        return "«" + b.tok + "»" + (b.sug ? " → возможно «" + b.sug + "»" : " (нет в словаре)");
      });
      parts.push(hint.join("; "));
    }
    if (!countOk) {
      if (res.level !== "red") res.level = "amber";
      var next = VALID_LEN.filter(function (v) { return v >= n; })[0];
      if (n < 12) parts.push("слов: " + n + " — не хватает " + (12 - n) + " (минимум 12)");
      else if (next) parts.push("слов: " + n + " — до " + next + " не хватает " + (next - n));
      else parts.push("слов: " + n + " — лишние (максимум 24)");
    } else {
      parts.push("слов: " + n + " ✓");
    }
    if (countOk && bad.length === 0) {
      res.checksum = bip39ChecksumOk(tokens);
      if (res.checksum) { res.level = "green"; parts = ["✓ ФРАЗА ВАЛИДНА — контрольная сумма верна (" + n + " слов)"]; }
      else { res.level = "red"; parts.push("✗ контрольная сумма НЕ сходится — ошибка в слове или порядке"); }
    }
    res.msg = parts.join(" · ");
    return res;
  }

  // ---------- сверка слов и цифр ----------
  function crossCheck(wordsText, numsText) {
    var words = tokWords(wordsText), nums = tokNums(numsText);
    var res = { words: words, nums: nums, mismatch: [], base: null, level: "muted", msg: "" };
    if (nums.length === 0) { res.msg = "введите цифровой код для сверки со словами"; return res; }
    if (words.length === 0) { res.msg = "введите слова, чтобы сверить с цифрами"; res.level = "amber"; return res; }
    if (words.length !== nums.length) {
      res.level = "red";
      res.msg = "количество не совпадает: слов " + words.length + ", чисел " + nums.length;
      return res;
    }
    var wi = words.map(wordIndex);
    function miss(base) { var c = 0; for (var i = 0; i < wi.length; i++) if (wi[i] === -1 || nums[i] - base !== wi[i]) c++; return c; }
    var m0 = miss(0), m1 = miss(1);
    var base = m0 <= m1 ? 0 : 1;
    res.base = base;
    for (var i = 0; i < wi.length; i++) {
      if (wi[i] === -1 || nums[i] - base !== wi[i]) res.mismatch.push(i);
    }
    if (res.mismatch.length === 0) {
      res.level = "green";
      res.msg = "✓ слова и цифры ПОЛНОСТЬЮ сходятся (" + (base === 1 ? "1-based" : "0-based") + " индексация, " + words.length + " поз.)";
    } else {
      res.level = "red";
      res.msg = "сходится " + (wi.length - res.mismatch.length) + "/" + wi.length +
        " (" + (base === 1 ? "1-based" : "0-based") + ") · расхождения в позициях: " +
        res.mismatch.map(function (i) { return i + 1; }).join(", ");
    }
    return res;
  }

  var core = {
    sha256: sha256, bip39ChecksumOk: bip39ChecksumOk,
    validateWords: validateWords, crossCheck: crossCheck,
    tokWords: tokWords, tokNums: tokNums, wordIndex: wordIndex
  };
  root.PUHCORE = core;

  // ---------- DOM-обвязка (только в браузере) ----------
  if (typeof document === "undefined") return;

  function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function highlightWords(text, badIdx) {
    var seen = -1;
    return esc(text).replace(/[A-Za-z]+|[^A-Za-z]+/g, function (chunk) {
      if (/^[A-Za-z]+$/.test(chunk)) {
        seen++;
        var cls = badIdx.indexOf(seen) !== -1 ? "tok bad" : "tok ok";
        return '<span class="' + cls + '">' + chunk + "</span>";
      }
      return chunk;
    });
  }
  function highlightNums(text, badIdx) {
    var seen = -1;
    return esc(text).replace(/\d+|[^\d]+/g, function (chunk) {
      if (/^\d+$/.test(chunk)) {
        seen++;
        var cls = badIdx.indexOf(seen) !== -1 ? "tok bad" : "tok ok";
        return '<span class="' + cls + '">' + chunk + "</span>";
      }
      return chunk;
    });
  }

  function setStatus(el, level, msg) {
    el.className = "vstatus " + level;
    el.textContent = msg;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var taW = document.getElementById("ta-words"), hlW = document.getElementById("hl-words"), stW = document.getElementById("st-words");
    var taN = document.getElementById("ta-nums"), hlN = document.getElementById("hl-nums"), stN = document.getElementById("st-nums");
    var stX = document.getElementById("st-cross");
    if (!taW) return;

    function sync(ta, hl) { hl.style.transform = "translate(" + (-ta.scrollLeft) + "px," + (-ta.scrollTop) + "px)"; }

    function run() {
      var vw = validateWords(taW.value);
      hlW.innerHTML = highlightWords(taW.value, vw.bad.map(function (b) { return b.i; })) + "\n";
      setStatus(stW, vw.level, vw.msg);

      var cc = crossCheck(taW.value, taN.value);
      hlN.innerHTML = highlightNums(taN.value, cc.mismatch) + "\n";
      setStatus(stN, taN.value.trim() ? cc.level : "muted",
        taN.value.trim() ? "" : "введите цифровой код (по желанию)");
      setStatus(stX, cc.level, cc.msg);
    }

    [taW, taN].forEach(function (ta) {
      var hl = ta === taW ? hlW : hlN;
      ta.addEventListener("input", run);
      ta.addEventListener("scroll", function () { sync(ta, hl); });
    });
    run();
  });
})(typeof window !== "undefined" ? window : globalThis);
