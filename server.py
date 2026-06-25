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
import secrets
import urllib.parse
from http import cookies

BASE = os.path.dirname(os.path.abspath(__file__))
AUTH_PATH = os.path.join(BASE, "auth.json")
TPL_DIR = os.path.join(BASE, "templates")
PORT = int(os.environ.get("PUH_PORT", "8777"))
SESSIONS = {}  # sid -> username (in-memory)


def load_auth():
    with open(AUTH_PATH) as f:
        return json.load(f)


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
    def log_message(self, *a):  # тише в логах
        pass

    def _user(self):
        raw = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(raw)
        sid = jar["sid"].value if "sid" in jar else None
        return SESSIONS.get(sid)

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

    def do_GET(self):
        path = self.path.split("?")[0]
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
        if self.path != "/login":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length", 0))
        form = urllib.parse.parse_qs(self.rfile.read(n).decode())
        user = form.get("username", [""])[0]
        pw = form.get("password", [""])[0]
        if verify(user, pw):
            sid = secrets.token_hex(24)
            SESSIONS[sid] = user
            cookie = f"sid={sid}; HttpOnly; Path=/; SameSite=Strict"
            return self._redirect("/", [("Set-Cookie", cookie)])
        err = '<div class="error">Неверный логин или пароль</div>'
        return self._send_html(tpl("login.html").replace("{{ERROR}}", err), code=401)


if __name__ == "__main__":
    print(f"[puh-web] http://0.0.0.0:{PORT}  (login: /login)", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
