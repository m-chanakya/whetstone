#!/usr/bin/env python3
"""Whetstone local backend: serves the app and keeps all data on this machine.

    python server.py                 # http://localhost:8787, data in ~/.whetstone/whetstone.db
    python server.py --data ./mydata # keep the database somewhere else
    python server.py --port 9000

Standard library only. The database is one SQLite file; questions, submissions
and feedback are JSON blobs inside it. Nothing here is ever sent to GitHub.
Set ANTHROPIC_API_KEY (environment, or "anthropicApiKey" in <data>/config.json)
and every submission is graded in real CPython and reviewed by Claude in the
background.
"""
import argparse
import json
import mimetypes
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend import review as reviewer  # noqa: E402
from backend import runner  # noqa: E402

ROOT = Path(__file__).resolve().parent
VERSION = "2"


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, question_id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS feedback (submission_id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS submissions_q ON submissions(question_id, at);
            """
        )

    def _now(self):
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def questions(self):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute("SELECT body FROM questions ORDER BY updated_at")]

    def question(self, qid):
        with self.lock:
            r = self.db.execute("SELECT body FROM questions WHERE id=?", (qid,)).fetchone()
        return json.loads(r[0]) if r else None

    def put_question(self, q):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO questions VALUES (?,?,?)", (q["id"], json.dumps(q), self._now()))
            self.db.commit()

    def delete_question(self, qid):
        with self.lock:
            self.db.execute("DELETE FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE question_id=?)", (qid,))
            self.db.execute("DELETE FROM submissions WHERE question_id=?", (qid,))
            self.db.execute("DELETE FROM questions WHERE id=?", (qid,))
            self.db.commit()

    def submissions(self):
        with self.lock:
            rows = self.db.execute("SELECT s.body, f.body FROM submissions s LEFT JOIN feedback f ON f.submission_id=s.id ORDER BY s.at").fetchall()
        out = []
        for sb, fb in rows:
            s = json.loads(sb)
            s["feedback"] = json.loads(fb) if fb else None
            out.append(s)
        return out

    def submission(self, sid):
        with self.lock:
            r = self.db.execute("SELECT s.body, f.body FROM submissions s LEFT JOIN feedback f ON f.submission_id=s.id WHERE s.id=?", (sid,)).fetchone()
        if not r:
            return None
        s = json.loads(r[0])
        s["feedback"] = json.loads(r[1]) if r[1] else None
        return s

    def put_submission(self, s):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO submissions VALUES (?,?,?,?)", (s["id"], s["questionId"], s["at"], json.dumps({k: v for k, v in s.items() if k != "feedback"})))
            self.db.commit()

    def put_feedback(self, sid, fb):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO feedback VALUES (?,?)", (sid, json.dumps(fb)))
            self.db.commit()

    def export(self):
        return {"exportedAt": self._now(), "questions": self.questions(), "submissions": self.submissions()}

    def import_(self, data):
        n = 0
        for q in data.get("questions", []):
            if q.get("id") and q.get("title"):
                self.put_question(q)
                n += 1
        for s in data.get("submissions", []):
            if s.get("id") and s.get("questionId"):
                fb = s.pop("feedback", None)
                self.put_submission(s)
                if fb:
                    self.put_feedback(s["id"], fb)
                n += 1
        return n


def summarize_submission(s):
    run = s.get("cpython") or s.get("browser") or {}
    return {
        "id": s["id"], "questionId": s["questionId"], "gateId": s["gateId"], "attemptId": s.get("attemptId"), "at": s["at"],
        "elapsedSec": s.get("elapsedSec"), "gateSec": s.get("gateSec"), "lines": s.get("lines"),
        "passed": run.get("passed"), "total": run.get("total"), "runtime": run.get("runtime"),
        "status": s.get("status", "done"), "feedback": s.get("feedback"),
    }


def summarize_question(q):
    return {k: q.get(k) for k in ("id", "title", "topic", "difficulty", "lang", "source", "url", "createdAt")} | {
        "gates": [{k: g.get(k) for k in ("id", "title", "entry", "minutes")} for g in q.get("gates", [])]}


class App:
    def __init__(self, store, api_key, model):
        self.store, self.api_key, self.model = store, api_key, model

    def evaluate(self, sid):
        """Background: CPython grade, then Claude review."""
        s = self.store.submission(sid)
        q = s and self.store.question(s["questionId"])
        if not s or not q:
            return
        try:
            r = runner.grade(q, s)
            if r:
                s["cpython"] = r
        except Exception as e:  # noqa: BLE001
            s["cpython"] = {"passed": 0, "total": 0, "cases": [], "error": "grader failed: %s" % e, "runtime": "cpython"}
        s["status"] = "reviewing" if self.api_key else "done"
        self.store.put_submission(s)
        if self.api_key:
            try:
                fb = reviewer.review(q, s, self.api_key, self.model)
                self.store.put_feedback(sid, fb)
                s["status"] = "done"
            except Exception as e:  # noqa: BLE001
                s["status"] = "review-failed"
                s["reviewError"] = str(e)[:300]
            self.store.put_submission(s)


class Handler(BaseHTTPRequestHandler):
    app: App = None
    allowed_origins = ("http://localhost", "http://127.0.0.1", "https://m-chanakya.github.io")

    def log_message(self, fmt, *args):
        if os.environ.get("WHETSTONE_LOG"):
            super().log_message(fmt, *args)

    # ----- plumbing
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if any(origin.startswith(o) for o in self.allowed_origins):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ----- routes
    def do_GET(self):
        p = urlparse(self.path).path
        st = self.app.store
        if p == "/api/health":
            return self._json(200, {"ok": True, "version": VERSION, "hasKey": bool(self.app.api_key), "model": self.app.model, "dataDir": str(st.path.parent)})
        if p == "/api/index":
            return self._json(200, {"questions": [summarize_question(q) for q in st.questions()], "submissions": [summarize_submission(s) for s in st.submissions()]})
        if p.startswith("/api/questions/"):
            q = st.question(unquote(p.split("/", 3)[3]))
            return self._json(200, q) if q else self._json(404, {"error": "not found"})
        if p.startswith("/api/submissions/"):
            s = st.submission(unquote(p.split("/", 3)[3]))
            return self._json(200, s) if s else self._json(404, {"error": "not found"})
        if p == "/api/export":
            return self._json(200, st.export())
        if p.startswith("/api/"):
            return self._json(404, {"error": "no such route"})
        return self._static(p)

    def do_PUT(self):
        p = urlparse(self.path).path
        if p.startswith("/api/questions/"):
            q = self._body()
            qid = unquote(p.split("/", 3)[3])
            if not isinstance(q, dict) or q.get("id") != qid or not q.get("title") or not isinstance(q.get("gates"), list):
                return self._json(400, {"error": "question needs id (matching the URL), title and gates"})
            self.app.store.put_question(q)
            return self._json(200, summarize_question(q))
        return self._json(404, {"error": "no such route"})

    def do_DELETE(self):
        p = urlparse(self.path).path
        if p.startswith("/api/questions/"):
            self.app.store.delete_question(unquote(p.split("/", 3)[3]))
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "no such route"})

    def do_POST(self):
        p = urlparse(self.path).path
        st = self.app.store
        if p == "/api/submissions":
            s = self._body()
            for k in ("id", "questionId", "gateId", "at", "code"):
                if k not in s:
                    return self._json(400, {"error": "missing " + k})
            if not st.question(s["questionId"]):
                return self._json(404, {"error": "unknown question"})
            s["status"] = "grading"
            st.put_submission(s)
            threading.Thread(target=self.app.evaluate, args=(s["id"],), daemon=True).start()
            return self._json(201, summarize_submission(s))
        if p.startswith("/api/submissions/") and p.endswith("/review"):
            sid = unquote(p.split("/")[3])
            s = st.submission(sid)
            if not s:
                return self._json(404, {"error": "not found"})
            if not self.app.api_key:
                return self._json(409, {"error": "No ANTHROPIC_API_KEY on the server. Set it in the environment or in config.json, then restart."})
            try:
                fb = reviewer.review(st.question(s["questionId"]), s, self.app.api_key, self.app.model)
            except Exception as e:  # noqa: BLE001
                return self._json(502, {"error": "review failed: %s" % str(e)[:300]})
            st.put_feedback(sid, fb)
            s["status"] = "done"
            st.put_submission(s)
            return self._json(200, fb)
        if p == "/api/import":
            return self._json(200, {"imported": st.import_(self._body())})
        return self._json(404, {"error": "no such route"})

    def _static(self, p):
        if p == "/":
            p = "/index.html"
        f = (ROOT / unquote(p).lstrip("/")).resolve()
        if ROOT not in f.parents and f != ROOT or not f.is_file() or any(part in (".git", "local", "data") for part in f.relative_to(ROOT).parts):
            self.send_response(404)
            self.end_headers()
            return
        data = f.read_bytes()
        self.send_response(200)
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if f.suffix == ".wasm":
            ctype = "application/wasm"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache" if f.suffix in (".html", ".js", ".css") else "max-age=86400")
        self.end_headers()
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=int(os.environ.get("WHETSTONE_PORT", 8787)))
    ap.add_argument("--data", default=os.environ.get("WHETSTONE_DATA") or str(Path.home() / ".whetstone"))
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    data = Path(a.data).expanduser()
    data.mkdir(parents=True, exist_ok=True)
    cfg = {}
    cfg_path = data / "config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text())
        except json.JSONDecodeError:
            print("config.json is not valid JSON; ignoring", file=sys.stderr)
    key = os.environ.get("ANTHROPIC_API_KEY") or cfg.get("anthropicApiKey") or ""
    model = os.environ.get("WHETSTONE_MODEL") or cfg.get("model") or reviewer.DEFAULT_MODEL
    store = Store(data / "whetstone.db")
    Handler.app = App(store, key, model)
    seed = data / "seed"
    if seed.is_dir():
        for p in sorted(seed.glob("*.json")):
            try:
                n = store.import_(json.loads(p.read_text()))
                print("seeded %d record(s) from %s" % (n, p.name))
                p.rename(p.with_suffix(".json.imported"))
            except Exception as e:  # noqa: BLE001
                print("could not import", p, e, file=sys.stderr)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("Whetstone  http://%s:%d/" % ("localhost" if a.host == "127.0.0.1" else a.host, a.port))
    print("data       %s" % data)
    print("reviews    %s" % ("on, model %s" % model if key else "off (no ANTHROPIC_API_KEY)"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
