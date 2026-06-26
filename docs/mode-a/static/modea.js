/* ПУХ · Режим А — глубокая проверка валидной сид по всем путям.
   Деривация через ethers (сверено с bip_utils). Активность = баланс ИЛИ история транзакций. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return ("" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---------- деривация ----------
  function b58check(e, hex) {
    var p = e.getBytes(hex), c = e.getBytes(e.sha256(e.sha256(p))).slice(0, 4);
    var full = new Uint8Array(p.length + 4); full.set(p); full.set(c, p.length);
    return e.encodeBase58(full);
  }
  function ethAddr(e, m, path) { return e.HDNodeWallet.fromPhrase(m, "", path).address; }
  function btcLegacy(e, m, path) {
    var n = e.HDNodeWallet.fromPhrase(m, "", path);
    var h = e.ripemd160(e.sha256(e.getBytes(n.publicKey)));
    return b58check(e, "0x00" + h.slice(2));
  }
  function trxAddr(e, m, path) {
    var n = e.HDNodeWallet.fromPhrase(m, "", path);
    var unc = e.SigningKey.computePublicKey(n.privateKey, false);
    var k = e.getBytes(e.keccak256(e.getBytes(unc).slice(1)));
    return b58check(e, "0x41" + e.hexlify(k.slice(k.length - 20)).slice(2));
  }

  // матрица путей (демо-набор; расширим)
  function matrix() {
    var rows = [], i;
    for (i = 0; i < 5; i++) rows.push({ net: "ETH", std: "Standard (MetaMask)", path: "m/44'/60'/0'/0/" + i, kind: "eth" });
    for (i = 0; i < 5; i++) rows.push({ net: "ETH", std: "Ledger Live", path: "m/44'/60'/" + i + "'/0/0", kind: "eth" });
    for (i = 0; i < 5; i++) rows.push({ net: "BTC", std: "Legacy (BIP44)", path: "m/44'/0'/0'/0/" + i, kind: "btc" });
    for (i = 0; i < 5; i++) rows.push({ net: "TRX", std: "BIP44", path: "m/44'/195'/0'/0/" + i, kind: "trx" });
    return rows;
  }
  function derive(m) {
    var e = window.ethers, rows = matrix();
    rows.forEach(function (r) {
      try {
        r.addr = r.kind === "eth" ? ethAddr(e, m, r.path) : r.kind === "btc" ? btcLegacy(e, m, r.path) : trxAddr(e, m, r.path);
      } catch (err) { r.addr = null; }
    });
    return rows;
  }

  // ---------- активность (баланс ИЛИ история) ----------
  function jget(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function ethAct(addr) {
    var body = function (method) { return { jsonrpc: "2.0", id: 1, method: method, params: [addr, "latest"] }; };
    return Promise.all([
      fetch("https://eth.llamarpc.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("eth_getBalance")) }).then(function (r) { return r.json(); }),
      fetch("https://eth.llamarpc.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("eth_getTransactionCount")) }).then(function (r) { return r.json(); })
    ]).then(function (a) {
      var wei = a[0].result ? parseInt(a[0].result, 16) : 0;
      var nonce = a[1].result ? parseInt(a[1].result, 16) : 0;
      var bal = wei / 1e18;
      return { bal: bal.toFixed(6) + " ETH", txn: nonce, alive: bal > 0 || nonce > 0 };
    }).catch(function () { return { bal: "н/д", txn: 0, alive: false, err: true }; });
  }
  function btcAct(addr) {
    return jget("https://blockstream.info/api/address/" + addr).then(function (d) {
      var s = d.chain_stats || {}, ms = d.mempool_stats || {};
      var bal = ((s.funded_txo_sum - s.spent_txo_sum) || 0) / 1e8;
      var txn = (s.tx_count || 0) + (ms.tx_count || 0);
      return { bal: bal.toFixed(8) + " BTC", txn: txn, alive: bal > 0 || txn > 0 };
    }).catch(function () { return { bal: "н/д", txn: 0, alive: false, err: true }; });
  }
  function trxAct(addr) {
    return jget("https://apilist.tronscanapi.com/api/account?address=" + addr).then(function (d) {
      var bal = (d.balance || 0) / 1e6;
      var txn = d.transactions || d.totalTransactionCount || 0;
      return { bal: bal.toFixed(6) + " TRX", txn: txn, alive: bal > 0 || txn > 0 };
    }).catch(function () { return { bal: "н/д", txn: 0, alive: false, err: true }; });
  }
  function checkAct(r) { return r.kind === "eth" ? ethAct(r.addr) : r.kind === "btc" ? btcAct(r.addr) : trxAct(r.addr); }

  // ---------- рендер ----------
  function render(rows) {
    var nets = ["ETH", "BTC", "TRX"], html = "";
    nets.forEach(function (net) {
      var rs = rows.filter(function (r) { return r.net === net; });
      if (!rs.length) return;
      html += '<div class="net-group"><div class="net-h">' + net + "</div>";
      rs.forEach(function (r) {
        var a = r.act || {};
        var alive = a.alive;
        html += '<div class="addr-row' + (alive ? " alive" : "") + '">' +
          '<span class="ar-std">' + esc(r.std) + '<br><span style="opacity:.6">' + esc(r.path) + "</span></span>" +
          '<span class="ar-addr">' + (r.addr ? esc(r.addr) : "—") + "</span>" +
          '<span class="ar-bal">' + (a.bal != null ? esc(a.bal) : "…") + "</span>" +
          '<span class="ar-flag ' + (a.bal == null ? "empty" : alive ? "alive" : "empty") + '">' +
            (a.bal == null ? "…" : alive ? "● ЖИВОЙ (тx " + a.txn + ")" : "пусто") + "</span></div>";
      });
      html += "</div>";
    });
    $("report").innerHTML = html;
  }

  // ---------- запуск ----------
  function run() {
    var C = window.PUHCORE;
    var m = ($("seed").value || "").trim().toLowerCase().replace(/\s+/g, " ");
    var v = C.validateWords(m);
    if (v.checksum !== true) {
      $("seed-status").className = "vstatus red";
      $("seed-status").textContent = "✗ фраза невалидна (" + v.msg + ") — Режим А только для валидных сид. Битые — в Режим B (восстановление).";
      return;
    }
    $("seed-status").className = "vstatus green";
    $("seed-status").textContent = "✓ фраза валидна — проверяю все пути";
    var btn = $("run"); btn.disabled = true; btn.textContent = "⏳ ПРОВЕРКА…";
    $("summary").innerHTML = ""; $("report").innerHTML = "";

    var rows = derive(m);
    render(rows);
    var i = 0, hits = 0;
    function next() {
      if (i >= rows.length) {
        btn.disabled = false; btn.textContent = "▶ ПРОВЕРИТЬ ВСЕ ПУТИ";
        $("scanline").textContent = "";
        $("summary").className = "summary " + (hits ? "hit" : "miss");
        $("summary").innerHTML = hits
          ? "● НАЙДЕНА АКТИВНОСТЬ на " + hits + " адрес(ах) — сид ЖИВАЯ. См. подсвеченные строки."
          : "○ Активности не найдено по проверенным путям. (Дальше добавим segwit/taproot, LTC/DOGE, Monero, xpub-полноту — возможно, средства на ещё не покрытом пути.)";
        return;
      }
      var r = rows[i];
      $("scanline").textContent = "проверка " + (i + 1) + "/" + rows.length + " · " + r.net + " " + r.std + " · " + (r.addr || "—");
      if (!r.addr) { i++; return setTimeout(next, 5); }
      checkAct(r).then(function (a) {
        r.act = a; if (a.alive) hits++;
        render(rows); i++; setTimeout(next, 150);
      }).catch(function () { i++; setTimeout(next, 150); });
    }
    next();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var ta = $("seed");
    ta.addEventListener("input", function () {
      var C = window.PUHCORE; if (!C) return;
      var v = C.validateWords((ta.value || "").trim().toLowerCase());
      var el = $("seed-status");
      if (!ta.value.trim()) { el.className = "vstatus muted"; el.textContent = "введите сид-фразу"; return; }
      el.className = "vstatus " + v.level;
      el.textContent = v.msg;
    });
    $("run").addEventListener("click", run);
  });
})();
