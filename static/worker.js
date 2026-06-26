/* PUH — фоновый воркер глубокого перебора (не морозит UI). */
self.window = self;  // чтобы bip39.js/checker.js/recover.js нашли глобальный объект
importScripts("bip39.js", "bip39_langs.js", "checker.js", "recover.js");
self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var tw = self.PUHRECOVER.twoWord(d.words || "", d.nums || "", d.budget || 4000000);
    self.postMessage({ ok: true, results: tw.results, attempts: tw.attempts });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
