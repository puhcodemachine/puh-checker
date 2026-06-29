# Движок серверного скана: одна сид → деривация всех путей → проверка активности
# с ретраями/backoff и адаптивным контролем (для масс-очереди).
import time, threading, random, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import derive, activity
from concurrent.futures import ThreadPoolExecutor

class Ctrl:                                   # AIMD контроллер потоков (для масс-очереди)
    def __init__(self, mn=2, mx=6): self.mn, self.mx, self.target, self.cool, self.ok = mn, mx, 3, 0, 0
    def max_by_load(self, rem): return 6 if rem >= 200 else 5 if rem >= 50 else 4 if rem >= 15 else 3 if rem >= 4 else 2
    def report(self, ok, limited):
        now = time.time()
        if limited: self.target = max(self.mn, self.target - 1); self.cool = now + 8; self.ok = 0
        elif ok:
            self.ok += 1
            if self.ok >= 20 and now > self.cool: self.target = min(self.mx, self.target + 1); self.ok = 0
        else: self.ok = 0
    def effective(self, rem): return max(self.mn, min(self.target, self.max_by_load(rem)))

def check_retry(row, ctrl, tries=4):
    for n in range(1, tries + 1):
        try:
            a = activity.check(row); ctrl.report(True, False); return a
        except activity.RateLimited:
            ctrl.report(False, True)
            if n < tries: time.sleep(min(15, 0.5 * 2 ** n) + random.random() * 0.5)
        except Exception:
            ctrl.report(False, False)
            if n < tries: time.sleep(0.3 * n)
    return {"bal": "н/д", "received": "—", "txn": 0, "alive": False, "chains": ""}

SLOW_CHAINS = ("dogecoin", "dash")     # DOGE/DASH — отдельная медленная очередь (никогда не убираем)


def _result(row, a):
    r = {"coin": row["coin"], "std": row["std"], "path": row["path"], "addr": row["addr"],
         "bal": a["bal"], "received": a.get("received", "—"), "txn": a.get("txn", 0),
         "alive": a["alive"], "chains": a.get("chains", "")}
    if a.get("evm"):
        r["evm"] = a["evm"]                         # {токен: баланс} по сетям — для корректной оценки в $
    return r


def scan_seed(seed, ctrl=None, addr_workers=4, on_progress=None):
    """Быстрые сети (BTC/LTC/EVM/ETC) — сразу; DOGE/DASH возвращаем отдельно (slow_rows) для фоновой очереди."""
    ctrl = ctrl or Ctrl()
    rows = derive.derive_all(seed)
    fast = [r for r in rows if r["chain"] not in SLOW_CHAINS]
    slow = [r for r in rows if r["chain"] in SLOW_CHAINS]
    total = len(rows); done = [0]; plock = threading.Lock()
    def one(row):
        a = check_retry(row, ctrl)
        if on_progress:
            with plock:
                done[0] += 1
                on_progress(done[0], total)
        return _result(row, a)
    with ThreadPoolExecutor(max_workers=addr_workers) as ex:
        fast_results = list(ex.map(one, fast))
    placeholders = [{"coin": r["coin"], "std": r["std"], "path": r["path"], "addr": r["addr"],
                     "bal": "…очередь", "received": "—", "txn": 0, "alive": False, "chains": ""} for r in slow]
    alive = sum(1 for r in fast_results if r["alive"])
    return {"results": fast_results + placeholders, "alive": alive, "total": total, "slow_rows": slow}


def check_one(row):                    # одна DOGE/DASH-проверка для фоновой очереди (blockchair сам троттлит)
    return _result(row, activity.check(row))

if __name__ == "__main__":
    seed = sys.argv[1] if len(sys.argv) > 1 else "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    t = time.time(); out = scan_seed(seed)
    print(f"проверено адресов: {len(out['results'])}, живых: {out['alive']}, за {time.time()-t:.1f}с")
    for r in out["results"]:
        if r["alive"]: print(f"  ЖИВОЙ {r['coin']} {r['std']} {r['path']} -> {r['addr']} | bal {r['bal']} tx {r['txn']} {r['chains']}")
