# Серверная проверка активности: BTC/LTC через free Esplora, DOGE/DASH через blockchair,
# EVM (ETH/BSC/Polygon) + ETC через RPC-пулы. Ключи/доп.ноды берутся из keys.py (gitignored).
import json, os, random, ssl, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
try:
    import certifi; _CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _CTX = ssl.create_default_context()

# DOGE/DASH (blockchair без ключа) — собственный мягкий троттл, чтобы НЕ тормозить EVM/BTC/LTC.
_BC_SEM = threading.Semaphore(int(os.environ.get("PUH_BC_CONC", "3")))

# --- публичные ноды по умолчанию (рабочие, бесплатные) ---
EVM = {
    "ETH": ["https://eth.llamarpc.com", "https://cloudflare-eth.com"],
    "BSC": ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com", "https://1rpc.io/bnb", "https://bsc-rpc.publicnode.com"],
    "Polygon": ["https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"],
    "Arbitrum": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
    "Optimism": ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
    "Base": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    "Avalanche": ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"],
    "Fantom": ["https://rpc.ftm.tools", "https://fantom-rpc.publicnode.com"],
    "HyperEVM": ["https://rpc.hyperliquid.xyz/evm"],
}
ETC_RPCS = ["https://etc.rivet.link", "https://etc.etcdesktop.com"]
# Пулы Esplora-совместимых нод (фолбэк + ротация). blockstream.info душит дата-центры (429) → рабочие первыми.
ESPLORA = {"bitcoin": ["https://mempool.space", "https://btcscan.org", "https://blockstream.info"],
           "litecoin": ["https://litecoinspace.org"]}
KEYS = {"blockchair": [], "blockcypher": []}

# --- поверх — ключи/доп.ноды из keys.py (на сервере, не в git) ---
try:
    import keys as _k
    for _c, _urls in getattr(_k, "EVM_EXTRA", {}).items():
        EVM[_c] = list(_urls) + EVM.get(_c, [])          # приватные/быстрые ноды первыми
    KEYS["blockchair"] = list(getattr(_k, "BLOCKCHAIR_KEYS", []))
    KEYS["blockcypher"] = list(getattr(_k, "BLOCKCYPHER_TOKENS", []))   # бесплатный токен снимает лимиты DOGE/DASH
except Exception:
    pass

_rr = {}
def _rot(key, arr):
    if not arr: return None
    i = _rr.get(key, 0) % len(arr); _rr[key] = i + 1; return arr[i]

class RateLimited(Exception): pass

def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "puh-checker"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code in (429, 430, 420, 502, 503, 504): raise RateLimited()
        return None
    except Exception:
        return None

def _post(url, payload, timeout=20):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "puh-checker"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code in (429, 430, 420, 502, 503, 504): raise RateLimited()
        return None
    except Exception:
        return None

def esplora(bases, addr):                                  # BTC/LTC — free, ротация+фолбэк по пулу нод
    if isinstance(bases, str): bases = [bases]
    start = _rr.get("esp", 0); _rr["esp"] = start + 1     # сдвигаем стартовую ноду → размазываем нагрузку
    n = len(bases); limited = 0
    for i in range(n):
        base = bases[(start + i) % n]
        try:
            d = _get(f"{base}/api/address/{addr}")
        except RateLimited:
            limited += 1; continue                        # эта нода душит → пробуем следующую
        if d is not None:
            cs = d.get("chain_stats") or {}
            funded, spent, txn = cs.get("funded_txo_sum", 0) or 0, cs.get("spent_txo_sum", 0) or 0, cs.get("tx_count", 0) or 0
            bal = funded - spent
            return {"bal": f"{bal/1e8:.8f}", "received": f"{funded/1e8:.8f}", "txn": txn, "alive": txn > 0 or funded > 0}
    if limited: raise RateLimited()                        # все ноды залимичены → пусть ретрайнет позже
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}

def blockchair(chain, addr):                               # DOGE/DASH — свой троттл, НЕ кидает RateLimited
    k = _rot("bc", KEYS["blockchair"])
    url = f"https://api.blockchair.com/{chain}/dashboards/address/{addr}" + (f"?key={k}" if k else "")
    tries = 5 if k else 3                                  # с ключом лимитов почти нет
    with _BC_SEM:
        for n in range(1, tries + 1):
            req = urllib.request.Request(url, headers={"User-Agent": "puh-checker"})
            try:
                with urllib.request.urlopen(req, timeout=20, context=_CTX) as r:
                    d = json.loads(r.read().decode("utf-8", "replace"))
                a = ((d.get("data") or {}).get(addr) or {}).get("address") or {}
                bal, recv, txn = a.get("balance", 0) or 0, a.get("received", 0) or 0, a.get("transaction_count", 0) or 0
                return {"bal": f"{bal/1e8:.8f}", "received": f"{recv/1e8:.8f}", "txn": txn, "alive": bal > 0 or recv > 0 or txn > 0}
            except urllib.error.HTTPError as e:
                if e.code in (429, 430, 420, 502, 503, 504) and n < tries:
                    time.sleep(min(10, 1.5 * n) + random.random()); continue
                break
            except Exception:
                break
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}  # лимит исчерпан → н/д (без срыва контроллера)

def _rpc(rpcs, key, method, params):
    d = _post(_rot(key, rpcs), {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=8)
    return (d or {}).get("result")                         # медленная сеть → None (0), не тормозим весь скан

# нативный токен каждой сети (L2 на ETH считаем как ETH; AVAX/FTM/HYPE — свои)
EVM_TOKEN = {"ETH": "ETH", "BSC": "BNB", "Polygon": "MATIC", "Arbitrum": "ETH", "Optimism": "ETH",
             "Base": "ETH", "Avalanche": "AVAX", "Fantom": "FTM", "HyperEVM": "HYPE"}

# --- ERC20-токены через Alchemy Portfolio API (ВСЕ токены + цены одним запросом, фильтр скама по $) ---
import re as _re
_ALCHEMY_KEY = None
try:
    import keys as _kk
    _m = _re.search(r"/v2/([A-Za-z0-9_-]+)", (getattr(_kk, "EVM_EXTRA", {}).get("ETH") or [""])[0])
    _ALCHEMY_KEY = _m.group(1) if _m else None
except Exception:
    pass
ALCHEMY_NETS = ["eth-mainnet", "base-mainnet", "arb-mainnet", "opt-mainnet", "matic-mainnet", "avax-mainnet", "bnb-mainnet"]
TOKEN_MIN_USD = float(os.environ.get("PUH_TOKEN_MIN_USD", "1"))     # порог отсечки скама/пыли

def alchemy_tokens(addr):
    """Все ERC20-токены адреса по сетям с ценами; оставляем только ≥ $порога (скам/пыль без цены — мимо)."""
    if not _ALCHEMY_KEY:
        return []
    url = f"https://api.g.alchemy.com/data/v1/{_ALCHEMY_KEY}/assets/tokens/by-address"
    try:
        d = _post(url, {"addresses": [{"address": addr, "networks": ALCHEMY_NETS}], "withMetadata": True, "withPrices": True}, timeout=15)
    except RateLimited:
        return []
    out = []
    for t in ((d or {}).get("data") or {}).get("tokens", []):
        if t.get("tokenAddress") is None:                  # нативный — считаем через RPC отдельно
            continue
        try:
            raw = int(t.get("tokenBalance") or "0x0", 16)
        except Exception:
            continue
        if raw <= 0:
            continue
        pr = (t.get("tokenPrices") or [{}])[0].get("value")
        if not pr:                                         # нет цены = скам/неликвид → пропускаем
            continue
        md = t.get("tokenMetadata") or {}
        dec = md.get("decimals")
        dec = 18 if dec is None else dec
        amt = raw / (10 ** dec)
        usd = amt * float(pr)
        if usd < TOKEN_MIN_USD:                            # пыль ниже порога — мимо
            continue
        out.append({"symbol": (md.get("symbol") or "?")[:12], "amount": amt, "usd": usd})
    out.sort(key=lambda x: -x["usd"])
    return out

def _evm_one(name, rpcs, addr):
    b = _rpc(rpcs, "evm_" + name, "eth_getBalance", [addr, "latest"])
    n = _rpc(rpcs, "evm_" + name, "eth_getTransactionCount", [addr, "latest"])
    return name, (int(b, 16) if b else 0), (int(n, 16) if n else 0)

def evm_all(addr):
    alive, chains, nonce, per = False, [], 0, {}               # per: токен -> баланс (НЕ суммируем разные монеты)
    with ThreadPoolExecutor(max_workers=10) as ex:            # сети + токены параллельно
        fut_tok = ex.submit(alchemy_tokens, addr)             # все ERC20-токены с ценами
        rs = list(ex.map(lambda kv: _evm_one(kv[0], kv[1], addr), EVM.items()))
        toks = fut_tok.result()
    for name, w, nc in rs:
        if w > 0 or nc > 0:
            alive = True
            if name not in chains: chains.append(name)
        if w > 0: per[EVM_TOKEN[name]] = per.get(EVM_TOKEN[name], 0) + w / 1e18
        nonce += nc
    tusd = sum(t["usd"] for t in toks)
    if toks:
        alive = True
    parts = [f"{v:.6f} {sym}" for sym, v in per.items()] + [f"{t['amount']:.4g} {t['symbol']}" for t in toks[:6]]
    disp = " · ".join(parts) if parts else "0"
    ch = ", ".join(chains) + (" +токены" if toks else "")
    return {"bal": disp, "received": "—", "txn": nonce, "alive": alive,
            "chains": ch.strip(", "), "evm": per, "tusd": round(tusd, 2)}

# --- Tron: TRX + TRC20 (USDT/USDC) через TronGrid (free) ---
USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"             # 6 знаков
USDC_TRC20 = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"             # 6 знаков

def tron(addr):
    d = None
    for n in range(3):                                     # TronGrid free лимитит → ретраи (фон-очередь не спешит)
        try:
            d = _get(f"https://api.trongrid.io/v1/accounts/{addr}")
            break
        except RateLimited:
            time.sleep(0.8 + n)
    if d is None:
        return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}
    data = d.get("data") or []
    if not data:
        return {"bal": "0", "received": "—", "txn": 0, "alive": False, "tokens": {}}
    acc = data[0]
    toks = {"TRX": (acc.get("balance", 0) or 0) / 1e6}
    for t in acc.get("trc20", []):
        for c, v in t.items():
            if c == USDT_TRC20: toks["USDT"] = toks.get("USDT", 0) + int(v) / 1e6
            elif c == USDC_TRC20: toks["USDC"] = toks.get("USDC", 0) + int(v) / 1e6
    parts = [f"{v:.6f} {s}" if s == "TRX" else f"{v:.2f} {s}" for s, v in toks.items() if v > 0]
    has_other = bool(acc.get("trc20"))                        # есть любые TRC20 (даже неизвестные) — признак активности
    alive = any(v > 0 for v in toks.values()) or has_other
    return {"bal": " · ".join(parts) if parts else "0", "received": "—", "txn": 0,
            "alive": alive, "chains": "Tron", "tokens": {s: v for s, v in toks.items() if v > 0}}

def etc_one(addr):
    b = _rpc(ETC_RPCS, "etc", "eth_getBalance", [addr, "latest"])
    n = _rpc(ETC_RPCS, "etc", "eth_getTransactionCount", [addr, "latest"])
    w = int(b, 16) if b else 0; nc = int(n, 16) if n else 0
    return {"bal": f"{w/1e18:.6f}", "received": "—", "txn": nc, "alive": w > 0 or nc > 0, "chains": "ETC" if (w > 0 or nc > 0) else ""}

def blockcypher(chain, addr):                              # DOGE/DASH — рабочий из дата-центра (free; токен снимает лимит)
    net = "doge" if chain == "dogecoin" else "dash"
    tok = _rot("bcy", KEYS["blockcypher"])
    d = _get(f"https://api.blockcypher.com/v1/{net}/main/addrs/{addr}/balance" + (f"?token={tok}" if tok else ""))
    if d is None: return None
    bal = d.get("final_balance", d.get("balance", 0)) or 0
    recv = d.get("total_received", 0) or 0
    txn = d.get("n_tx", 0) or 0
    return {"bal": f"{bal/1e8:.8f}", "received": f"{recv/1e8:.8f}", "txn": txn, "alive": bal > 0 or recv > 0 or txn > 0}

def doge_dash(chain, addr):                                # blockcypher (с ретраями) → фолбэк blockchair
    for n in range(3):
        try:
            r = blockcypher(chain, addr)
            if r is not None: return r
        except RateLimited:
            pass
        time.sleep(0.6 + n)                                # slow-очередь не торопится — добиваем лимит
    return blockchair(chain, addr)

def _bcy_parse(item):
    bal = item.get("final_balance", item.get("balance", 0)) or 0
    recv = item.get("total_received", 0) or 0
    txn = item.get("n_tx", 0) or 0
    return {"bal": f"{bal/1e8:.8f}", "received": f"{recv/1e8:.8f}", "txn": txn, "alive": bal > 0 or recv > 0 or txn > 0}

def blockcypher_batch(chain, addrs):                       # ДО 100 адресов ОДНИМ запросом → втрое меньше нагрузки
    net = "doge" if chain == "dogecoin" else "dash"
    tok = _rot("bcy", KEYS["blockcypher"])
    url = f"https://api.blockcypher.com/v1/{net}/main/addrs/{';'.join(addrs)}/balance" + (f"?token={tok}" if tok else "")
    d = _get(url)
    if d is None: return None
    if isinstance(d, dict): d = [d]                        # один адрес → объект, не массив
    return {it.get("address"): _bcy_parse(it) for it in d if it.get("address")}

def check_many(chain, addrs):                              # батч DOGE/DASH: один запрос на пачку, недостающие — добираем
    result = {}
    for n in range(2):
        try:
            out = blockcypher_batch(chain, addrs)
            if out:
                result = {a: out[a] for a in addrs if a in out}
                break
        except RateLimited:
            pass
        time.sleep(0.8 + n)
    missing = [a for a in addrs if a not in result]
    for a in missing:                                      # что батч не вернул → поштучно (single → blockchair)
        result[a] = doge_dash(chain, a)
    return result

SOL_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com", "https://api.mainnet.solana.com"]

def solana(addr):
    for n in range(3):
        try:
            d = _post(_rot("sol", SOL_RPCS), {"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [addr]}, timeout=8)
            if d and "result" in d:
                lam = ((d.get("result") or {}).get("value", 0)) or 0
                s = lam / 1e9
                return {"bal": f"{s:.6f} SOL" if s > 0 else "0", "received": "—", "txn": 0,
                        "alive": s > 0, "chains": "Solana", "tokens": ({"SOL": s} if s > 0 else {})}
        except RateLimited:
            pass
        time.sleep(0.6 + n)
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}

def cardano(addr):
    for n in range(3):
        try:
            d = _post("https://api.koios.rest/api/v1/address_info", {"_addresses": [addr]}, timeout=10)
            if isinstance(d, list):
                if not d:
                    return {"bal": "0", "received": "—", "txn": 0, "alive": False, "chains": "Cardano", "tokens": {}}
                info = d[0]
                ada = int(info.get("balance", 0) or 0) / 1e6
                txn = info.get("tx_count", 0) or 0
                return {"bal": f"{ada:.6f} ADA" if ada > 0 else "0", "received": "—", "txn": txn,
                        "alive": ada > 0 or txn > 0, "chains": "Cardano", "tokens": ({"ADA": ada} if ada > 0 else {})}
        except RateLimited:
            pass
        time.sleep(0.7 + n)
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}

# Monero light-wallet серверы (отдаём view-key, сканят за нас). Часто лежат/душат дата-центр → best-effort.
MONERO_LWS = ["https://api.mymonero.com:8443", "https://wallet.rino.io/api"]

def monero(row):
    addr, vk = row.get("addr"), row.get("view_key")
    if addr and vk:
        for base in MONERO_LWS:
            try:
                d = _post(base + "/get_address_info", {"address": addr, "view_key": vk}, timeout=12)
                if d and "total_received" in d:
                    bal = (int(d.get("total_received", 0) or 0) - int(d.get("total_sent", 0) or 0)) / 1e12
                    return {"bal": f"{bal:.6f} XMR" if bal > 0 else "0", "received": "—", "txn": 0,
                            "alive": bal > 0, "chains": "Monero", "tokens": ({"XMR": bal} if bal > 0 else {})}
            except Exception:
                continue
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False, "chains": "Monero"}  # серверы недоступны

def check(row):
    c = row["chain"]
    if c == "evm": return evm_all(row["addr"])
    if c == "tron": return tron(row["addr"])
    if c == "solana": return solana(row["addr"])
    if c == "cardano": return cardano(row["addr"])
    if c == "monero": return monero(row)
    if c == "ethereum-classic": return etc_one(row["addr"])
    if c in ESPLORA: return esplora(ESPLORA[c], row["addr"])
    return doge_dash(c, row["addr"])                       # dogecoin, dash
