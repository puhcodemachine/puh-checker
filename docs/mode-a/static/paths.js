/* ПУХ · Режим А — деривация адресов по всем путям/форматам.
   Форматы: P2PKH (legacy), P2SH-P2WPKH (BIP49), P2WPKH bech32 (BIP84), EVM.
   Сверено с bip_utils. */
(function (root) {
  "use strict";
  function E() { return root.ethers; }

  // ---- base58check ----
  function b58check(e, hex) {
    var p = e.getBytes(hex), c = e.getBytes(e.sha256(e.sha256(p))).slice(0, 4);
    var f = new Uint8Array(p.length + 4); f.set(p); f.set(c, p.length);
    return e.encodeBase58(f);
  }
  // ---- bech32 (BIP173) ----
  var CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(v) {
    var G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], chk = 1;
    for (var p = 0; p < v.length; p++) {
      var top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v[p];
      for (var i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
    }
    return chk >>> 0;
  }
  function hrpExpand(h) {
    var r = [], i;
    for (i = 0; i < h.length; i++) r.push(h.charCodeAt(i) >>> 5);
    r.push(0);
    for (i = 0; i < h.length; i++) r.push(h.charCodeAt(i) & 31);
    return r;
  }
  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, ret = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = ((acc << from) | data[i]) >>> 0; bits += from;
      while (bits >= to) { bits -= to; ret.push((acc >>> bits) & maxv); }
    }
    if (pad && bits > 0) ret.push((acc << (to - bits)) & maxv);
    return ret;
  }
  function bech32(hrp, witver, prog) {
    var data = [witver].concat(convertBits(prog, 8, 5, true));
    var values = hrpExpand(hrp).concat(data);
    var pm = polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ 1;
    var chk = []; for (var i = 0; i < 6; i++) chk.push((pm >>> (5 * (5 - i))) & 31);
    var comb = data.concat(chk), out = hrp + "1";
    for (i = 0; i < comb.length; i++) out += CH.charAt(comb[i]);
    return out;
  }

  function h160(e, node) { return e.getBytes(e.ripemd160(e.sha256(e.getBytes(node.publicKey)))); }
  function node(e, m, path) { return e.HDNodeWallet.fromPhrase(m, "", path); }

  function p2pkh(e, m, path, ver) {
    return b58check(e, ver + e.hexlify(h160(e, node(e, m, path))).slice(2));
  }
  function p2sh(e, m, path, ver) {
    var hh = h160(e, node(e, m, path));
    var redeem = new Uint8Array(2 + hh.length); redeem[0] = 0; redeem[1] = 0x14; redeem.set(hh, 2);
    var sh = e.ripemd160(e.sha256(redeem));
    return b58check(e, ver + sh.slice(2));
  }
  function p2wpkh(e, m, path, hrp) {
    return bech32(hrp, 0, Array.from(h160(e, node(e, m, path))));
  }
  function evm(e, m, path) { return e.HDNodeWallet.fromPhrase(m, "", path).address; }

  // ---- единая деривация одной записи ----
  function deriveOne(r, m) {
    var e = E();
    try {
      if (r.fmt === "evm") return evm(e, m, r.path);
      if (r.fmt === "p2pkh") return p2pkh(e, m, r.path, r.ver);
      if (r.fmt === "p2sh") return p2sh(e, m, r.path, r.ver);
      if (r.fmt === "p2wpkh") return p2wpkh(e, m, r.path, r.hrp);
    } catch (err) { return null; }
    return null;
  }

  // ---- матрица путей ----
  function H(p) { return p.replace(/h/g, "'"); }  // удобная запись
  function matrix() {
    var rows = [], i;
    // BTC
    for (i = 0; i < 5; i++) rows.push({ coin: "BTC", chain: "bitcoin", std: "Legacy BIP44", fmt: "p2pkh", ver: "0x00", path: "m/44'/0'/0'/0/" + i });
    for (i = 0; i < 5; i++) rows.push({ coin: "BTC", chain: "bitcoin", std: "P2SH-SegWit BIP49", fmt: "p2sh", ver: "0x05", path: "m/49'/0'/0'/0/" + i });
    for (i = 0; i < 5; i++) rows.push({ coin: "BTC", chain: "bitcoin", std: "SegWit BIP84", fmt: "p2wpkh", hrp: "bc", path: "m/84'/0'/0'/0/" + i });
    // LTC
    for (i = 0; i < 3; i++) rows.push({ coin: "LTC", chain: "litecoin", std: "Legacy BIP44", fmt: "p2pkh", ver: "0x30", path: "m/44'/2'/0'/0/" + i });
    for (i = 0; i < 3; i++) rows.push({ coin: "LTC", chain: "litecoin", std: "P2SH-SegWit BIP49", fmt: "p2sh", ver: "0x32", path: "m/49'/2'/0'/0/" + i });
    for (i = 0; i < 3; i++) rows.push({ coin: "LTC", chain: "litecoin", std: "SegWit BIP84", fmt: "p2wpkh", hrp: "ltc", path: "m/84'/2'/0'/0/" + i });
    // DOGE / DASH
    for (i = 0; i < 3; i++) rows.push({ coin: "DOGE", chain: "dogecoin", std: "Legacy BIP44", fmt: "p2pkh", ver: "0x1e", path: "m/44'/3'/0'/0/" + i });
    for (i = 0; i < 3; i++) rows.push({ coin: "DASH", chain: "dash", std: "Legacy BIP44", fmt: "p2pkh", ver: "0x4c", path: "m/44'/5'/0'/0/" + i });
    // ETH (адрес общий для EVM-сетей) + Ledger Live
    for (i = 0; i < 5; i++) rows.push({ coin: "ETH", chain: "evm", std: "Standard (MetaMask)", fmt: "evm", path: "m/44'/60'/0'/0/" + i });
    for (i = 0; i < 5; i++) rows.push({ coin: "ETH", chain: "evm", std: "Ledger Live", fmt: "evm", path: "m/44'/60'/" + i + "'/0/0" });
    // ETC
    for (i = 0; i < 3; i++) rows.push({ coin: "ETC", chain: "ethereum-classic", std: "BIP44", fmt: "evm", path: "m/44'/61'/0'/0/" + i });
    return rows;
  }

  root.PUHPATHS = { matrix: matrix, deriveOne: deriveOne, p2pkh: p2pkh, p2sh: p2sh, p2wpkh: p2wpkh, evm: evm };
})(typeof window !== "undefined" ? window : globalThis);
