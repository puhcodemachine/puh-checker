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


def load_auth():
    with open(AUTH_PATH) as f:
        return json.load(f)


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
            "results": len(t.get("results", []))}


def verify(user, pw):
    a = load_auth()
    if user != a["user"]:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(a["salt"]), a["iters"])
    return hmac.compare_digest(dk.hex(), a["hash"])


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
                "results": [], "log": []}
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
        if path == "/api/tasks":
            if not self._user():
                return self._json({"error": "auth"}, 401)
            return self._json({"tasks": [task_summary(t) for t in load_tasks()]})
        if path.startswith("/api/tasks/"):
            if not self._user():
                return self._json({"error": "auth"}, 401)
            tid = path[len("/api/tasks/"):]
            for t in load_tasks():
                if t["id"] == tid:
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
            if not self._user():
                return self._json({"error": "auth"}, 401)
            with LOCK:
                tasks = load_tasks()
                for t in tasks:
                    if t["id"] == m.group(1):
                        t["status"] = "red"
                        t["stopped"] = time.time()
                        save_tasks(tasks)
                        return self._json({"ok": True, "task": task_summary(t)})
            return self._json({"error": "not found"}, 404)
        m = re.match(r"^/api/tasks/([0-9a-f]+)/update$", path)
        if m:
            if not self._user():
                return self._json({"error": "auth"}, 401)
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
                        for k in allowed:
                            if k in patch:
                                t[k] = patch[k]
                        save_tasks(tasks)
                        return self._json({"ok": True, "task": task_summary(t)})
            return self._json({"error": "not found"}, 404)
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
