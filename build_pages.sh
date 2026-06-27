#!/usr/bin/env bash
# Собирает статичную витрину в docs/ для GitHub Pages:
#   docs/            — панель (web-checker)
#   docs/mode-a/     — Режим А (глубокая проверка), отдельная страница, панель не трогается
# Пароль-барьер встраивается в обе страницы (хэш из .gate_hash, плейнтекст в репо не попадает).
set -e
cd "$(dirname "$0")"
rm -rf docs
mkdir -p docs/static

# --- панель ---
cp static/bip39.js static/bip39_langs.js static/checker.js static/recover.js static/derive.js static/worker.js static/tasks.js docs/static/
cp -r static/vendor docs/static/vendor
sed -e 's#src="/static/#src="static/#g' -e 's/{{USER}}/ПУХ/g' templates/panel.html > docs/index.html
touch docs/.nojekyll

# --- Режим А (../mode-a) ---
if [ -d ../mode-a ]; then
  mkdir -p docs/mode-a/static
  cp static/bip39.js static/checker.js docs/mode-a/static/
  cp static/vendor/ethers.umd.min.js docs/mode-a/static/ethers.umd.min.js
  cp ../mode-a/static/*.js docs/mode-a/static/
  cp ../mode-a/index.html docs/mode-a/index.html
fi

# --- Режим Б (../mode-b) ---
if [ -d ../mode-b ]; then
  mkdir -p docs/mode-b/static
  cp static/bip39.js static/checker.js docs/mode-b/static/
  cp ../mode-b/static/*.js docs/mode-b/static/
  cp ../mode-b/index.html docs/mode-b/index.html
fi

# --- Масс-проверка (../mass) ---
if [ -d ../mass ]; then
  mkdir -p docs/mass/static
  cp static/bip39.js static/checker.js docs/mass/static/
  cp static/vendor/ethers.umd.min.js docs/mass/static/ethers.umd.min.js
  cp ../mode-a/static/paths.js docs/mass/static/paths.js
  cp ../mass/static/*.js docs/mass/static/
  cp ../mass/index.html docs/mass/index.html
fi

# --- барьер в обе страницы ---
GATE_HASH="$(cat .gate_hash 2>/dev/null || echo '')"
GATE_HASH="$GATE_HASH" /root/PUH/.venv/bin/python - <<'PY'
import os
gate_hash = os.environ.get("GATE_HASH", "")
gate = '''
<div id="gate" style="position:fixed;inset:0;z-index:9999;background:#050805;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:13px;font-family:'Share Tech Mono',monospace;color:#32c266">
  <div style="font-size:18px;letter-spacing:3px;text-shadow:0 0 8px rgba(34,160,86,.4)">ПУХ · ROBCO TERMLINK</div>
  <div style="font-size:12px;color:#386b49;letter-spacing:1px">требуется авторизация</div>
  <input id="gate-pw" type="password" placeholder="пароль" autofocus autocomplete="off"
    style="margin-top:8px;padding:12px 14px;background:#0a110b;border:1px solid #143f24;color:#6fbe87;font-family:inherit;font-size:15px;outline:none;width:260px;text-align:center">
  <button id="gate-go" style="padding:11px 28px;background:#32c266;color:#04130a;border:0;font-family:inherit;font-weight:700;letter-spacing:2px;cursor:pointer">ВОЙТИ</button>
  <div id="gate-err" style="color:#e85a5a;font-size:12px;min-height:14px"></div>
  <div style="position:fixed;bottom:14px;font-size:10px;color:#2a4f37;letter-spacing:1px">статичный превью · защита-барьер (не серверная)</div>
</div>
<script>
(function(){
  var HASH="__HASH__";
  var g=document.getElementById("gate");
  function open(){ g.style.display="none"; }
  if(sessionStorage.getItem("puh_gate")==="1"){ open(); return; }
  function check(){
    var pw=document.getElementById("gate-pw").value;
    var h=[].map.call(window.PUHCORE.sha256(new TextEncoder().encode(pw)),function(b){return("0"+b.toString(16)).slice(-2);}).join("");
    if(h===HASH){ sessionStorage.setItem("puh_gate","1"); open(); }
    else { document.getElementById("gate-err").textContent="неверный пароль"; document.getElementById("gate-pw").value=""; }
  }
  document.getElementById("gate-go").onclick=check;
  document.getElementById("gate-pw").addEventListener("keydown",function(e){ if(e.key==="Enter") check(); });
})();
</script>
'''.replace("__HASH__", gate_hash)
for p in ("docs/index.html", "docs/mode-a/index.html", "docs/mode-b/index.html", "docs/mass/index.html"):
    if os.path.exists(p):
        html = open(p, encoding="utf-8").read().replace("</body>", gate + "</body>")
        open(p, "w", encoding="utf-8").write(html)
print("барьер встроен" if gate_hash else "ВНИМАНИЕ: .gate_hash пуст — барьер без пароля!")
PY
echo "docs/ собран: панель + $( [ -d ../mode-a ] && echo 'Режим А' ) + $( [ -d ../mode-b ] && echo 'Режим Б' ) + $( [ -d ../mass ] && echo 'Масс-проверка' )"
