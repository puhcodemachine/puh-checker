/* PUH — вывод публичных адресов из сид-фразы (ETH/BTC/TRX) + балансы.
   Деривация в браузере через ethers (vendored). Сверена с bip_utils.
   Monero (ed25519/CryptoNote) — нестандартен для BIP39, выводится на сервере. */
(function (root) {
  "use strict";
  function E() { return root.ethers; }

  function b58check(e, hex) {
    var p = e.getBytes(hex);
    var c = e.getBytes(e.sha256(e.sha256(p))).slice(0, 4);
    var full = new Uint8Array(p.length + 4);
    full.set(p); full.set(c, p.length);
    return e.encodeBase58(full);
  }

  function addresses(m) {
    var e = E();
    if (!e) return null;
    try {
      var eth = e.HDNodeWallet.fromPhrase(m).address;
      // BTC legacy P2PKH m/44'/0'/0'/0/0
      var btcNode = e.HDNodeWallet.fromPhrase(m, "", "m/44'/0'/0'/0/0");
      var h160 = e.ripemd160(e.sha256(e.getBytes(btcNode.publicKey)));
      var btc = b58check(e, "0x00" + h160.slice(2));
      // TRX m/44'/195'/0'/0/0
      var trxNode = e.HDNodeWallet.fromPhrase(m, "", "m/44'/195'/0'/0/0");
      var unc = e.SigningKey.computePublicKey(trxNode.privateKey, false);
      var k = e.getBytes(e.keccak256(e.getBytes(unc).slice(1)));
      var trx = b58check(e, "0x41" + e.hexlify(k.slice(k.length - 20)).slice(2));
      return { eth: eth, trx: trx, btc: btc, xmr: null };
    } catch (err) { return null; }
  }

  // ---------- балансы (публичные API, best-effort) ----------
  function ethBalance(addr) {
    return fetch("https://eth.llamarpc.com", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.result ? (parseInt(d.result, 16) / 1e18).toFixed(6) + " ETH" : "—"; })
      .catch(function () { return "н/д"; });
  }
  function btcBalance(addr) {
    return fetch("https://blockstream.info/api/address/" + addr)
      .then(function (r) { return r.json(); })
      .then(function (d) { var s = d.chain_stats || {}; return ((s.funded_txo_sum - s.spent_txo_sum) / 1e8).toFixed(8) + " BTC"; })
      .catch(function () { return "н/д"; });
  }
  function trxBalance(addr) {
    return fetch("https://apilist.tronscanapi.com/api/account?address=" + addr)
      .then(function (r) { return r.json(); })
      .then(function (d) { return ((d.balance || 0) / 1e6).toFixed(6) + " TRX"; })
      .catch(function () { return "н/д"; });
  }

  root.PUHDERIVE = { addresses: addresses, ethBalance: ethBalance, btcBalance: btcBalance, trxBalance: trxBalance };
})(window);
