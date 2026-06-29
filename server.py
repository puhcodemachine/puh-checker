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
import re
import secrets
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


def task_summary(t):
    return {"id": t["id"], "name": t["name"], "type": t["type"], "status": t["status"],
            "modes": t["modes"], "created": t["created"], "started": t["started"],
            "stopped": t.get("stopped"), "pausedAt": t.get("pausedAt"),
            "mode": t.get("mode", "B"), "alive": t.get("alive", 0), "lastCheck": t.get("lastCheck"),
            "progress": t.get("progress"), "deleted": t.get("deleted"),
            "results": len(t.get("results", [])), "owner": t.get("owner")}


def verify(user, pw):
    u = load_auth()["users"].get(user or "")
    if not u:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(u["salt"]), u["iters"])
    return hmac.compare_digest(dk.hex(), u["hash"])


def tpl(name):
    with open(os.path.join(TPL_DIR, name), encoding="utf-8") as f:
        return f.read()


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
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
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

    def _serve_static(self, path):
        rel = path[len("/static/"):]
        if not rel or "/" in rel or ".." in rel:
            return self.send_error(404)
        fp = os.path.join(BASE, "static", rel)
        if not os.path.isfile(fp):
            return self.send_error(404)
        ctype = ("application/javascript; charset=utf-8" if rel.endswith(".js")
                 else "text/css; charset=utf-8" if rel.endswith(".css")
                 else "application/octet-stream")
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
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
            return self._serve_static(path)
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
    print(f"[puh-web] http://0.0.0.0:{PORT}  (login: /login)", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
