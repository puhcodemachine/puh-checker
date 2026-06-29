#!/usr/bin/env python3
"""
PUH web-checker — backend (stdlib only).
Step 1: страница авторизации + защищённая панель-заглушка.

Аутентификация — серверная: пароль НЕ хранится в коде/репозитории,
только PBKDF2-хэш в auth.json (этот файл в .gitignore).
"""
import hashlib
import hmac
import http.server
import json
import os
import posixpath
import re
import secrets
import sys
import threading
import time
import urllib.parse
from http import cookies

from cryptography.fernet import Fernet, InvalidToken

BASE = os.path.dirname(os.path.abspath(__file__))
AUTH_PATH = os.path.join(BASE, "auth.json")
TPL_DIR = os.path.join(BASE, "templates")
DATA_DIR = os.path.join(BASE, "data")
TASKS_PATH = os.path.join(DATA_DIR, "tasks.json")
KEY_PATH = os.path.join(BASE, ".enc_key")
PORT = int(os.environ.get("PUH_PORT", "8777"))
SESSIONS = {}            # sid -> {"user":.., "exp":..}
LOGIN_FAILS = {}         # ip -> [count, window_start]
LOCK = threading.Lock()  # сериализация записи задач

SESSION_TTL = 12 * 3600                          # сессия живёт 12 часов
SECURE_COOKIE = bool(os.environ.get("PUH_HTTPS"))  # на проде с HTTPS: PUH_HTTPS=1
MAX_BODY = 2_000_000                             # лимит тела запроса (анти-DoS)
MAX_LOGIN_FAILS = 8                              # блок после N неудач за окно
LOGIN_WINDOW = 600                               # окно блокировки, сек
SUBAPPS = ("mode-a", "mode-b", "mass")           # отдельные страницы (под авторизацией)
CTYPES = {".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
          ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
          ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json", ".txt": "text/plain; charset=utf-8"}


def _enc_key():
    """Ключ шифрования хранилища: файл .enc_key (chmod 600, в .gitignore)."""
    if not os.path.exists(KEY_PATH):
        with open(KEY_PATH, "wb") as f:
            f.write(Fernet.generate_key())
        os.chmod(KEY_PATH, 0o600)
    with open(KEY_PATH, "rb") as f:
        return f.read()


FERNET = Fernet(_enc_key())


PBKDF2_ITERS = 200000


def make_cred(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITERS)
    return {"salt": salt.hex(), "iters": PBKDF2_ITERS, "hash": dk.hex()}


def _save_auth(a):
    tmp = AUTH_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(a, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, AUTH_PATH)


def load_auth():
    with open(AUTH_PATH) as f:
        a = json.load(f)
    if "users" not in a:                       # миграция старого одно-юзерного формата → мультиюзер
        u = a.get("user", "PUH")
        a = {"users": {u: {"salt": a["salt"], "iters": a["iters"], "hash": a["hash"],
                           "role": "admin", "created": time.time(), "note": "главный администратор"}}}
        _save_auth(a)
    return a


def user_role(user):
    u = load_auth()["users"].get(user or "")
    return u.get("role") if u else None


# ---------- хранилище заданий (data/tasks.json — В .gitignore, содержит seed) ----------
def load_tasks():
    try:
        with open(TASKS_PATH, "rb") as f:
            blob = f.read()
    except FileNotFoundError:
        return []
    if not blob:
        return []
    try:
        data = FERNET.decrypt(blob)          # шифр на диске
    except InvalidToken:
        data = blob                          # миграция: старый открытый JSON
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return []


def save_tasks(tasks):
    os.makedirs(DATA_DIR, exist_ok=True)
    os.chmod(DATA_DIR, 0o700)
    blob = FERNET.encrypt(json.dumps(tasks, ensure_ascii=False).encode("utf-8"))
    tmp = TASKS_PATH + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.chmod(tmp, 0o600)
    os.replace(tmp, TASKS_PATH)              # tasks.json на диске — зашифрован


LIVE_PROGRESS = {}      # id -> "X/43" во время скана (в памяти, без записи на диск)


def task_summary(t):
    return {"id": t["id"], "name": t.get("name"), "type": t.get("type"), "status": t.get("status"),
            "modes": t.get("modes"), "created": t.get("created"), "started": t.get("started"),
            "stopped": t.get("stopped"), "pausedAt": t.get("pausedAt"),
            "mode": t.get("mode", "B"), "alive": t.get("alive", 0), "lastCheck": t.get("lastCheck"),
            "progress": LIVE_PROGRESS.get(t["id"], t.get("progress")), "deleted": t.get("deleted"),
            "hits": t.get("hits", 0), "candidates": len(t.get("candidates", [])), "mass": t.get("mass"),
            "results": len(t.get("results", [])), "owner": t.get("owner")}


def verify(user, pw):
    u = load_auth()["users"].get(user or "")
    if not u:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(u["salt"]), u["iters"])
    return hmac.compare_digest(dk.hex(), u["hash"])


# ---------- серверный воркер скана активности (работает 24/7) ----------
sys.path.insert(0, os.path.join(BASE, "engine"))
try:
    import worker as SCAN          # derive + activity + scan_seed (bip_utils)
    import notify as NOTIFY        # Telegram-уведомления "НАЙДЕНО"
    SCAN_CTRL = SCAN.Ctrl()        # глобальный AIMD-контроллер (потоки сидов)
except Exception as _e:            # движок может быть недоступен на превью
    SCAN = None
    NOTIFY = None
    SCAN_CTRL = None
    print("[puh-web] движок скана не загружен:", _e, flush=True)


def _changes(prev, new):
    """Активные пути, которые НОВЫЕ или ИЗМЕНИЛИСЬ относительно прошлой проверки."""
    pm = {r["coin"] + r["path"]: r for r in (prev or [])}
    out = []
    for r in (new or []):
        p = pm.get(r["coin"] + r["path"])
        if p is None:
            if r.get("alive"):
                out.append(r)                       # новый активный путь
        elif (p.get("alive") != r.get("alive") or p.get("bal") != r.get("bal")
              or p.get("txn") != r.get("txn") or p.get("received") != r.get("received")):
            if r.get("alive") or p.get("alive"):    # изменение на активном пути (вход/выход)
                out.append(r)
    return out


MASS_MIN_USD = float(os.environ.get("PUH_MASS_MIN_USD", "200"))   # масс: уведомлять только при балансе ≥ $200


def _notify_changes(task, seed, prev, new, mode_label):
    """Режим А — ИЗМЕНЕНИЕ в пути; Режим Б→А — НАЙДЕНО; МАСС — только баланс ≥ $200 (забытые остатки)."""
    if not NOTIFY or not NOTIFY.enabled():
        return
    rows = _changes(prev, new)
    if task.get("mass"):                                   # масс — только значимые балансы
        rows = [r for r in rows if NOTIFY.usd(r.get("coin"), r.get("bal")) >= MASS_MIN_USD]
    if not rows:
        return
    title = "НАЙДЕНО" if not prev else "ИЗМЕНЕНИЕ"
    try:
        NOTIFY.report(title, mode_label, task.get("name"), seed, rows, owner=task.get("owner"))
    except Exception as e:
        print("[notify]", e, flush=True)

BUSY = set()
BUSY_LOCK = threading.Lock()


def _claim(tid):
    with BUSY_LOCK:
        if tid in BUSY:
            return False
        BUSY.add(tid)
        return True


def patch_task(tid, patch):
    with LOCK:
        tasks = load_tasks()
        for x in tasks:
            if x["id"] == tid:
                x.update(patch)
        save_tasks(tasks)


def _get_task(tid):
    return next((x for x in load_tasks() if x["id"] == tid), None)


def _scan_task(tid):
    try:
        t = _get_task(tid)
        if not t or not SCAN:
            return
        if t.get("mode") == "BA":
            cands = t.get("candidates") or []
            for i, c in enumerate(cands):
                cur = _get_task(tid)
                if not cur or cur.get("status") == "red" or cur.get("deleted"):
                    return
                out = SCAN.scan_seed(c.get("phrase", ""), SCAN_CTRL)
                with LOCK:
                    tasks = load_tasks()
                    for x in tasks:
                        if x["id"] == tid and i < len(x.get("candidates", [])):
                            x["candidates"][i]["results"] = out["results"]
                            x["candidates"][i]["alive"] = out["alive"]
                            x["candidates"][i]["done"] = True
                            done = sum(1 for cc in x["candidates"] if cc.get("done"))
                            x["hits"] = sum(1 for cc in x["candidates"] if (cc.get("alive") or 0) > 0)
                            x["alive"] = sum(cc.get("alive", 0) for cc in x["candidates"])
                            x["progress"] = f"{done}/{len(x['candidates'])}"
                    save_tasks(tasks)
                _notify_changes(cur, c.get("phrase", ""), (c.get("results") or []), out["results"], "Б→А")
            t2 = _get_task(tid) or {}
            patch_task(tid, {"status": "amber" if t2.get("hits") else "green",
                             "lastCheck": time.time(), "scan_done": True})
        else:                       # mode A (в т.ч. масс — одна сид = одна задача)
            prev = t.get("results") or []
            out = SCAN.scan_seed(t.get("seed", ""), SCAN_CTRL,
                                 on_progress=lambda dn, tt: LIVE_PROGRESS.__setitem__(tid, f"{dn}/{tt}"))
            patch_task(tid, {"results": out["results"], "alive": out["alive"],
                             "status": "amber" if out["alive"] else "green",
                             "lastCheck": time.time(), "scan_done": True,
                             "progress": f"{len(out['results'])}/{len(out['results'])}"})
            _notify_changes(t, t.get("seed", ""), prev, out["results"], "МАСС" if t.get("mass") else "Режим А")
    except Exception as e:
        print("[scan] ошибка задачи", tid, e, flush=True)
        patch_task(tid, {"status": "red", "scanError": str(e)[:200]})
    finally:
        LIVE_PROGRESS.pop(tid, None)
        with BUSY_LOCK:
            BUSY.discard(tid)


def worker_loop():
    while True:
        try:
            now = time.time()
            tasks = load_tasks()
            for t in tasks:                       # авто-перепроверка раз в 24ч
                if (not t.get("deleted") and t.get("mode") in ("A", "BA")
                        and t.get("status") in ("green", "amber") and t.get("scan_done")
                        and now - (t.get("lastCheck") or 0) > 86400):
                    patch_task(t["id"], {"status": "running", "scan_done": False})
            tasks = load_tasks()
            pend = [t for t in tasks if not t.get("deleted") and t.get("mode") in ("A", "BA")
                    and t.get("status") in ("running", "queued") and t["id"] not in BUSY]
            rem = len(pend) + len(BUSY)
            eff = SCAN_CTRL.effective(rem) if SCAN_CTRL else 1
            for t in pend:
                if len(BUSY) >= max(1, eff):
                    break
                if _claim(t["id"]):
                    threading.Thread(target=_scan_task, args=(t["id"],), daemon=True).start()
            time.sleep(2)
        except Exception as e:
            print("[worker] loop err", e, flush=True)
            time.sleep(5)


def tpl(name):
    with open(os.path.join(TPL_DIR, name), encoding="utf-8") as f:
        return f.read()


# ---------- версионирование ассетов (пробивает кэш Cloudflare/браузера при деплое) ----------
_VER = {"t": 0.0, "v": "0"}


def asset_version():
    now = time.time()
    if now - _VER["t"] < 5:
        return _VER["v"]
    mx = 0.0
    for d in [os.path.join(BASE, "static")] + [os.path.join(BASE, sa, "static") for sa in SUBAPPS]:
        try:
            for f in os.listdir(d):
                if f.endswith((".js", ".css")):
                    mx = max(mx, os.path.getmtime(os.path.join(d, f)))
        except OSError:
            pass
    _VER["v"] = str(int(mx))
    _VER["t"] = now
    return _VER["v"]


_ASSET_RE = re.compile(r'((?:src|href)="[^"]*?static/[^"?]+\.(?:js|css))(")')


def versionize(html):
    ver = asset_version()
    return _ASSET_RE.sub(lambda m: m.group(1) + "?v=" + ver + m.group(2), html)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "PUH"      # не палим версию http.server
    sys_version = ""

    def log_message(self, *a):  # тише в логах
        pass

    def end_headers(self):      # заголовки безопасности на КАЖДЫЙ ответ
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
        super().end_headers()

    def _user(self):
        raw = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(raw)
        sid = jar["sid"].value if "sid" in jar else None
        s = SESSIONS.get(sid)
        if not s:
            return None
        if s.get("exp", 0) < time.time():   # сессия истекла
            SESSIONS.pop(sid, None)
            return None
        return s.get("user")

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > MAX_BODY:
            return None
        return self.rfile.read(n) if n else b""

    def _send_html(self, body, code=200, extra_headers=None):
        data = versionize(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")          # HTML всегда свежий
        for k, v in (extra_headers or {}):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, to, extra_headers=None):
        self.send_response(303)
        self.send_header("Location", to)
        for k, v in (extra_headers or {}):
            self.send_header(k, v)
        self.end_headers()

    def _safe_path(self, rel):
        rel = posixpath.normpath(rel.lstrip("/"))
        if rel.startswith("..") or rel.startswith("/") or "\x00" in rel:
            return None
        fp = os.path.join(BASE, *rel.split("/"))
        base = os.path.abspath(BASE)
        if not os.path.abspath(fp).startswith(base + os.sep):
            return None
        return fp

    def _serve_file(self, rel):
        fp = self._safe_path(rel)
        if not fp or not os.path.isfile(fp):
            return self.send_error(404)
        ext = os.path.splitext(fp)[1].lower()
        ctype = CTYPES.get(ext, "application/octet-stream")
        if ext == ".html":                                    # под-страницы (Режим А/Б/Масс) — версионируем ассеты
            with open(fp, encoding="utf-8") as f:
                data = versionize(f.read()).encode("utf-8")
        else:
            with open(fp, "rb") as f:
                data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if ext == ".html" else "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _create_task(self):
        raw = self._read_body()
        if raw is None:
            return self._json({"error": "too large"}, 413)
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        words = (body.get("words") or "").strip()
        nums = (body.get("nums") or "").strip()
        if not words and not nums:
            return self._json({"error": "пустое задание"}, 400)
        tid = secrets.token_hex(3)
        wcount = len(re.findall(r"[A-Za-z]+", words))
        gen = ("SEED-" if words else "CODE-") + tid.upper()[:4]
        name = (body.get("name") or "").strip() or gen
        ttype = (f"сид-фраза · {wcount} слов" if wcount else "сид-фраза") if words else "цифровой код"
        now = time.time()
        task = {"id": tid, "name": name, "type": ttype, "status": "green",
                "modes": {"podbor": True, "monitor": bool(body.get("monitor"))},
                "words": words, "nums": nums, "created": now, "started": now,
                "results": [], "log": [], "owner": self._user()}   # ветка владельца
        with LOCK:
            tasks = load_tasks()
            tasks.append(task)
            save_tasks(tasks)
        return self._json({"ok": True, "task": task_summary(task)})

    def _bad_host(self):
        # не отдаём контент под доменом-двойником бренда; только IP/нейтральные хосты
        return "ayvens" in (self.headers.get("Host") or "").lower()

    def do_GET(self):
        if self._bad_host():
            return self.send_error(403)
        path = self.path.split("?")[0]
        if path.startswith("/static/"):
            return self._serve_file(path)
        for sa in SUBAPPS:                                   # Режим А/Б/Масс — отдельные страницы под авторизацией
            if path == "/" + sa or path == "/" + sa + "/" or path.startswith("/" + sa + "/"):
                if not self._user():
                    return self._redirect("/login")
                rel = (sa + "/index.html") if path in ("/" + sa, "/" + sa + "/") else path
                return self._serve_file(rel)
        if path == "/api/account":
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            return self._json({"user": user, "role": user_role(user)})
        if path == "/api/admin/users":
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            if user_role(user) != "admin":
                return self._json({"error": "forbidden"}, 403)
            tasks = load_tasks()
            users = load_auth()["users"]
            out = []
            for name, u in users.items():
                cnt = len([t for t in tasks if t.get("owner") == name and not t.get("deleted")])
                out.append({"username": name, "role": u.get("role", "user"), "created": u.get("created"),
                            "note": u.get("note", ""), "tasks": cnt})
            return self._json({"users": out})
        if path == "/api/tasks":
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            adm = user_role(user) == "admin"
            return self._json({"tasks": [task_summary(t) for t in load_tasks() if adm or t.get("owner") == user]})
        if path.startswith("/api/tasks/"):
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            adm = user_role(user) == "admin"
            tid = path[len("/api/tasks/"):]
            for t in load_tasks():
                if t["id"] == tid:
                    if not adm and t.get("owner") and t.get("owner") != user:
                        return self._json({"error": "forbidden"}, 403)
                    return self._json({"task": t})
            return self._json({"error": "not found"}, 404)
        if path == "/login":
            return self._send_html(tpl("login.html").replace("{{ERROR}}", ""))
        if path == "/logout":
            return self._redirect("/login", [("Set-Cookie", "sid=; Path=/; Max-Age=0")])
        if path in ("/", "/panel"):
            user = self._user()
            if not user:
                return self._redirect("/login")
            return self._send_html(tpl("panel.html").replace("{{USER}}", user))
        return self.send_error(404)

    def do_POST(self):
        if self._bad_host():
            return self.send_error(403)
        path = self.path.split("?")[0]
        if path == "/api/tasks":
            if not self._user():
                return self._json({"error": "auth"}, 401)
            return self._create_task()
        if path in ("/api/scan", "/api/scan/bulk", "/api/scan/batch"):
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            raw = self._read_body()
            if raw is None:
                return self._json({"error": "too large"}, 413)
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json({"error": "bad json"}, 400)
            now = time.time()
            if path == "/api/scan":                                  # Режим А — одна сид
                seed = (body.get("seed") or "").strip().lower()
                if len(seed.split()) < 12:
                    return self._json({"error": "нужна валидная сид (12+ слов)"}, 400)
                tid = secrets.token_hex(3)
                name = (body.get("name") or "").strip() or ("Проверка " + tid.upper()[:4])
                task = {"id": tid, "name": name, "mode": "A", "type": "проверка активности · сервер 24/7",
                        "status": "running", "seed": seed, "words": seed, "results": [], "alive": 0,
                        "progress": "0/43", "created": now, "started": now, "lastCheck": None, "owner": user,
                        "log": [{"ts": now, "msg": "серверный скан поставлен в очередь"}]}
                with LOCK:
                    tasks = load_tasks(); tasks.append(task); save_tasks(tasks)
                return self._json({"ok": True, "task": task_summary(task)})
            if path == "/api/scan/bulk":                             # Масс — много сид (числовые имена)
                seeds = body.get("seeds") or []
                added = dup = 0
                with LOCK:
                    tasks = load_tasks()
                    have = {t.get("seed") for t in tasks if t.get("owner") == user and not t.get("deleted")}
                    base = max([int(t["name"]) for t in tasks if t.get("owner") == user and str(t.get("name", "")).isdigit()] or [0])
                    for s in seeds[:20000]:
                        s = (s or "").strip().lower()
                        if len(s.split()) < 12:
                            continue
                        if s in have:
                            dup += 1; continue
                        have.add(s); base += 1; added += 1
                        tasks.append({"id": secrets.token_hex(3), "name": str(base), "mode": "A", "type": "масс · сервер",
                                      "status": "running", "seed": s, "words": s, "results": [], "alive": 0, "progress": "0/43",
                                      "created": now, "started": now, "lastCheck": None, "owner": user, "mass": True, "log": []})
                    save_tasks(tasks)
                return self._json({"ok": True, "added": added, "dup": dup})
            cands = body.get("candidates") or []                     # Б→А — пакет вариаций
            if not cands:
                return self._json({"error": "нет вариаций"}, 400)
            tid = secrets.token_hex(3)
            name = (body.get("name") or "").strip() or ("Б→А " + tid.upper()[:4])
            task = {"id": tid, "name": name, "mode": "BA", "fromB": True, "type": "Б→А · вариаций " + str(len(cands)),
                    "status": "running", "alive": 0, "hits": 0, "progress": "0/" + str(len(cands)),
                    "candidates": [{"phrase": (c.get("phrase") if isinstance(c, dict) else c),
                                    "numMatch": bool(c.get("numMatch")) if isinstance(c, dict) else False,
                                    "cost": (c.get("cost") if isinstance(c, dict) else 0), "done": False, "alive": 0, "results": []}
                                   for c in cands],
                    "created": now, "started": now, "lastCheck": None, "owner": user, "log": []}
            with LOCK:
                tasks = load_tasks(); tasks.append(task); save_tasks(tasks)
            return self._json({"ok": True, "task": task_summary(task)})
        m = re.match(r"^/api/tasks/([0-9a-f]+)/stop$", path)
        if m:
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            adm = user_role(user) == "admin"
            with LOCK:
                tasks = load_tasks()
                for t in tasks:
                    if t["id"] == m.group(1):
                        if not adm and t.get("owner") and t.get("owner") != user:
                            return self._json({"error": "forbidden"}, 403)
                        t["status"] = "red"
                        t["stopped"] = time.time()
                        save_tasks(tasks)
                        return self._json({"ok": True, "task": task_summary(t)})
            return self._json({"error": "not found"}, 404)
        m = re.match(r"^/api/tasks/([0-9a-f]+)/update$", path)
        if m:
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            adm = user_role(user) == "admin"
            raw = self._read_body()
            if raw is None:
                return self._json({"error": "too large"}, 413)
            try:
                patch = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json({"error": "bad json"}, 400)
            allowed = ("status", "results", "log", "attempts", "done", "stopped", "pausedAt", "stats", "balScanned", "deleted")
            with LOCK:
                tasks = load_tasks()
                for t in tasks:
                    if t["id"] == m.group(1):
                        if not adm and t.get("owner") and t.get("owner") != user:
                            return self._json({"error": "forbidden"}, 403)
                        for k in allowed:
                            if k in patch:
                                t[k] = patch[k]
                        save_tasks(tasks)
                        return self._json({"ok": True, "task": task_summary(t)})
            return self._json({"error": "not found"}, 404)
        if path == "/api/account/password":
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            raw = self._read_body()
            if raw is None:
                return self._json({"error": "too large"}, 413)
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json({"error": "bad json"}, 400)
            if not verify(user, body.get("old", "")):
                return self._json({"error": "неверный текущий пароль"}, 403)
            new = body.get("new", "")
            if len(new) < 8:
                return self._json({"error": "новый пароль слишком короткий (мин. 8 символов)"}, 400)
            with LOCK:
                a = load_auth()
                a["users"][user].update(make_cred(new))
                _save_auth(a)
            return self._json({"ok": True})
        if path == "/api/admin/users":
            user = self._user()
            if not user:
                return self._json({"error": "auth"}, 401)
            if user_role(user) != "admin":
                return self._json({"error": "forbidden"}, 403)
            raw = self._read_body()
            if raw is None:
                return self._json({"error": "too large"}, 413)
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json({"error": "bad json"}, 400)
            uname = (body.get("username") or "").strip()
            pw = body.get("password") or ""
            note = (body.get("note") or "").strip()[:200]
            if not re.match(r"^[A-Za-z0-9_.\-]{2,32}$", uname):
                return self._json({"error": "ник: 2-32 символа (A-Z, 0-9, _ . -)"}, 400)
            if len(pw) < 8:
                return self._json({"error": "пароль слишком короткий (мин. 8 символов)"}, 400)
            with LOCK:
                a = load_auth()
                if uname in a["users"]:
                    return self._json({"error": "пользователь уже существует"}, 409)
                cred = make_cred(pw)
                cred.update({"role": "user", "created": time.time(), "note": note})
                a["users"][uname] = cred
                _save_auth(a)
            return self._json({"ok": True, "username": uname})
        if path != "/login":
            return self.send_error(404)
        ip = self.client_address[0] if self.client_address else "?"
        rec = LOGIN_FAILS.get(ip)
        if rec and time.time() - rec[1] < LOGIN_WINDOW and rec[0] >= MAX_LOGIN_FAILS:
            return self._send_html(tpl("login.html").replace(
                "{{ERROR}}", '<div class="error">Слишком много попыток входа. Подождите несколько минут.</div>'), code=429)
        body = self._read_body()
        if body is None:
            return self.send_error(413)
        form = urllib.parse.parse_qs(body.decode("utf-8", "replace"))
        user = form.get("username", [""])[0]
        pw = form.get("password", [""])[0]
        if verify(user, pw):
            LOGIN_FAILS.pop(ip, None)
            sid = secrets.token_hex(32)
            SESSIONS[sid] = {"user": user, "exp": time.time() + SESSION_TTL}
            cookie = f"sid={sid}; HttpOnly; Path=/; SameSite=Strict" + ("; Secure" if SECURE_COOKIE else "")
            return self._redirect("/", [("Set-Cookie", cookie)])
        r = LOGIN_FAILS.get(ip)
        if not r or time.time() - r[1] >= LOGIN_WINDOW:
            r = [0, time.time()]
        r[0] += 1
        LOGIN_FAILS[ip] = r
        err = '<div class="error">Неверный логин или пароль</div>'
        return self._send_html(tpl("login.html").replace("{{ERROR}}", err), code=401)


if __name__ == "__main__":
    HOST = os.environ.get("PUH_HOST", "0.0.0.0")     # на сервере за nginx: PUH_HOST=127.0.0.1
    if SCAN and os.environ.get("PUH_NO_WORKER") != "1":
        threading.Thread(target=worker_loop, daemon=True).start()
        print("[puh-web] фоновый воркер скана запущен (24/7)", flush=True)
    print(f"[puh-web] http://{HOST}:{PORT}  (login: /login)", flush=True)
    http.server.ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
