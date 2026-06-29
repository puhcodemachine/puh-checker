# Серверная проверка активности: BTC/LTC через free Esplora, DOGE/DASH через blockchair,
# EVM (ETH/BSC/Polygon) + ETC через RPC-пулы. Ключи/доп.ноды берутся из keys.py (gitignored).
import json, ssl, urllib.request, urllib.error
try:
    import certifi; _CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _CTX = ssl.create_default_context()

# --- публичные ноды по умолчанию (рабочие, бесплатные) ---
EVM = {
    "ETH": ["https://eth.llamarpc.com", "https://cloudflare-eth.com"],
    "BSC": ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com", "https://1rpc.io/bnb", "https://bsc-rpc.publicnode.com"],
    "Polygon": ["https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"],
}
ETC_RPCS = ["https://etc.rivet.link", "https://etc.etcdesktop.com"]
ESPLORA = {"bitcoin": "https://blockstream.info", "litecoin": "https://litecoinspace.org"}
KEYS = {"blockchair": []}

# --- поверх — ключи/доп.ноды из keys.py (на сервере, не в git) ---
try:
    import keys as _k
    for _c, _urls in getattr(_k, "EVM_EXTRA", {}).items():
        EVM[_c] = list(_urls) + EVM.get(_c, [])          # приватные/быстрые ноды первыми
    KEYS["blockchair"] = list(getattr(_k, "BLOCKCHAIR_KEYS", []))
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

def esplora(base, addr):                                   # BTC/LTC — free, без ключа
    d = _get(f"{base}/api/address/{addr}")
    if d is None: return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}
    cs = d.get("chain_stats") or {}
    funded, spent, txn = cs.get("funded_txo_sum", 0) or 0, cs.get("spent_txo_sum", 0) or 0, cs.get("tx_count", 0) or 0
    bal = funded - spent
    return {"bal": f"{bal/1e8:.8f}", "received": f"{funded/1e8:.8f}", "txn": txn, "alive": txn > 0 or funded > 0}

def blockchair(chain, addr):                               # DOGE/DASH (BTC/LTC — запас)
    k = _rot("bc", KEYS["blockchair"])
    url = f"https://api.blockchair.com/{chain}/dashboards/address/{addr}" + (f"?key={k}" if k else "")
    d = _get(url)
    if not d: return {"bal": "н/д", "received": "—", "txn": 0, "alive": False}
    a = ((d.get("data") or {}).get(addr) or {}).get("address") or {}
    bal, recv, txn = a.get("balance", 0) or 0, a.get("received", 0) or 0, a.get("transaction_count", 0) or 0
    return {"bal": f"{bal/1e8:.8f}", "received": f"{recv/1e8:.8f}", "txn": txn, "alive": bal > 0 or recv > 0 or txn > 0}

def _rpc(rpcs, key, method, params):
    d = _post(_rot(key, rpcs), {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    return (d or {}).get("result")

def evm_all(addr):
    alive, chains, wei, nonce = False, [], 0, 0
    for name, rpcs in EVM.items():
        b = _rpc(rpcs, "evm_" + name, "eth_getBalance", [addr, "latest"])
        n = _rpc(rpcs, "evm_" + name, "eth_getTransactionCount", [addr, "latest"])
        w = int(b, 16) if b else 0; nc = int(n, 16) if n else 0
        if w > 0 or nc > 0: alive = True; chains.append(name)
        wei += w; nonce += nc
    return {"bal": f"{wei/1e18:.6f}", "received": "—", "txn": nonce, "alive": alive, "chains": ", ".join(chains)}

def etc_one(addr):
    b = _rpc(ETC_RPCS, "etc", "eth_getBalance", [addr, "latest"])
    n = _rpc(ETC_RPCS, "etc", "eth_getTransactionCount", [addr, "latest"])
    w = int(b, 16) if b else 0; nc = int(n, 16) if n else 0
    return {"bal": f"{w/1e18:.6f}", "received": "—", "txn": nc, "alive": w > 0 or nc > 0, "chains": "ETC" if (w > 0 or nc > 0) else ""}

def check(row):
    c = row["chain"]
    if c == "evm": return evm_all(row["addr"])
    if c == "ethereum-classic": return etc_one(row["addr"])
    if c in ESPLORA: return esplora(ESPLORA[c], row["addr"])
    return blockchair(c, row["addr"])                      # dogecoin, dash
