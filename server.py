#!/usr/bin/env python3
"""Whetstone local backend: serves the app and keeps all data on this machine.

    python server.py                 # http://localhost:8787, data in <repo>/data/
    python server.py --data ./mydata # keep the database somewhere else
    python server.py --port 9000

Standard library only. The database is one SQLite file; questions, submissions
and feedback are JSON blobs inside it. Nothing here is ever sent to GitHub.
Files in the data folder are the simple way in and out: questions/<id>.md
(or .json) sync both ways with the database, anything dropped in inbox/ is
imported within seconds, and backup/latest.json is rewritten after every change
and restored automatically when the database is empty.

Every submission is graded in real CPython in the background and, when a
reviewer is available, reviewed by Claude: either the Claude Code CLI (`claude`
on PATH, signed in; this uses your Claude subscription) or the Anthropic API
(ANTHROPIC_API_KEY in the environment, or "anthropicApiKey" in
<data>/config.json). "reviewer" in config.json can force "claude-code" or "api".
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend import draft as drafter  # noqa: E402
from backend import qmd  # noqa: E402
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


class Files:
    """Keeps the data folder readable and the database restorable without the UI.

    <data>/questions/<id>.md|json   one file per question; edit or drop files here, they sync both ways
    <data>/inbox/*.json|*.md        anything dropped here is imported within seconds, then renamed .imported
    <data>/backup/latest.json       full export, rewritten after every change; daily snapshots next to it
    """

    def __init__(self, store, data):
        self.store, self.data, self.app = store, data, None
        self.qdir, self.inbox, self.bdir = data / "questions", data / "inbox", data / "backup"
        for d in (self.qdir, self.inbox, self.bdir, data / "seed"):
            d.mkdir(parents=True, exist_ok=True)
        self.seen = {}        # question file path -> mtime we last read or wrote
        self.dirty = False
        self.lock = threading.Lock()

    # ----- questions as files
    def path_for(self, qid):
        for ext in (".md", ".json"):
            p = self.qdir / (qid + ext)
            if p.exists():
                return p
        return self.qdir / (qid + ".md")

    def write_question(self, q):
        p = self.path_for(q["id"])
        text = json.dumps(q, indent=1) + "\n" if p.suffix == ".json" else qmd.render(q)
        if p.exists() and p.read_text() == text:
            self.seen[p] = p.stat().st_mtime
            return
        p.write_text(text)
        self.seen[p] = p.stat().st_mtime

    def remove_question_file(self, qid):
        for ext in (".md", ".json"):
            p = self.qdir / (qid + ext)
            if p.exists():
                p.rename(p.with_suffix(ext + ".deleted"))
                self.seen.pop(p, None)

    def read_question_file(self, p):
        text = p.read_text()
        if p.suffix == ".json":
            q = json.loads(text)
            q["id"] = p.stem
            return q
        return qmd.parse(text, p.stem)

    def scan_questions(self):
        """Import question files that are new or changed since we last saw them."""
        changed = []
        present = set()
        for p in sorted(list(self.qdir.glob("*.md")) + list(self.qdir.glob("*.json"))):
            present.add(p)
            mtime = p.stat().st_mtime
            if self.seen.get(p) == mtime:
                continue
            try:
                q = self.read_question_file(p)
                if not q.get("title") or not isinstance(q.get("gates"), list):
                    raise ValueError("needs a title and at least one part")
                old = self.store.question(q["id"])
                if old:
                    q.setdefault("createdAt", old.get("createdAt"))
                    for g in q["gates"]:
                        og = next((x for x in old["gates"] if x["id"] == g["id"]), None)
                        if og and not g.get("minutes"):
                            g["minutes"] = og.get("minutes", 0)
                q.setdefault("createdAt", datetime.now(timezone.utc).isoformat(timespec="seconds"))
                self.store.put_question(q)
                self.seen[p] = mtime
                changed.append(p.name)
            except Exception as e:  # noqa: BLE001
                self.seen[p] = mtime
                print("questions/%s not loaded: %s" % (p.name, e), file=sys.stderr)
        for p in [p for p in self.seen if p.parent == self.qdir and p not in present]:
            del self.seen[p]   # file removed by hand: keep the DB copy (progress points at it); write it back
            q = self.store.question(p.stem)
            if q:
                self.write_question(q)
        return changed

    def export_all_questions(self):
        for q in self.store.questions():
            self.write_question(q)

    # ----- inbox
    def scan_inbox(self):
        n = 0
        for p in sorted(self.inbox.glob("*.txt")):
            if not self.app or not self.app.can_review:
                break
            print("drafting a question from inbox/%s with Claude…" % p.name)
            try:
                d = self.app.draft_question(p.read_text(), slug=slugify(p.stem))
                q = d["question"]
                while self.store.question(q["id"]):
                    q["id"] += "-2"
                self.store.put_question(q)
                self.write_question(q)
                (self.qdir / (q["id"] + ".solution.py")).write_text(d["solution"])
                rep = d["report"]
                ok = "all %d parts verified" % len(rep["parts"]) if rep["ok"] else "verification incomplete: " + "; ".join("%s %d/%d" % (x["title"], x.get("passed", 0), x.get("total", 0)) for x in rep["parts"])
                print("drafted questions/%s.md (%s)%s" % (q["id"], ok, (" Notes: " + d["notes"]) if d.get("notes") else ""))
                p.rename(p.with_name(p.name + ".imported"))
                n += 1
            except Exception as e:  # noqa: BLE001
                print("could not draft from %s: %s" % (p.name, e), file=sys.stderr)
                p.rename(p.with_name(p.name + ".failed"))
        for d in (self.inbox, self.data / "seed"):
            for p in sorted(list(d.glob("*.json")) + list(d.glob("*.md"))):
                try:
                    if p.suffix == ".md":
                        q = qmd.parse(p.read_text(), p.stem)
                        self.store.put_question(q)
                        self.write_question(q)
                        n += 1
                    else:
                        data = json.loads(p.read_text())
                        if isinstance(data, dict) and "gates" in data and "questions" not in data:
                            data = {"questions": [data]}
                        n += self.store.import_(data)
                        for q in data.get("questions", []):
                            if q.get("id"):
                                self.write_question(self.store.question(q["id"]))
                    p.rename(p.with_name(p.name + ".imported"))
                    print("imported %s" % p.name)
                except Exception as e:  # noqa: BLE001
                    print("could not import %s: %s" % (p.name, e), file=sys.stderr)
                    p.rename(p.with_name(p.name + ".failed"))
        return n

    # ----- backup
    def backup(self):
        data = self.store.export()
        text = json.dumps(data, indent=1) + "\n"
        (self.bdir / "latest.json").write_text(text)
        day = self.bdir / (datetime.now().strftime("%Y-%m-%d") + ".json")
        day.write_text(text)
        snaps = sorted(self.bdir.glob("20??-??-??.json"))
        for old in snaps[:-30]:
            old.unlink()

    def restore_if_empty(self):
        if self.store.questions() or self.store.submissions():
            return False
        latest = self.bdir / "latest.json"
        if not latest.exists():
            return False
        n = self.store.import_(json.loads(latest.read_text()))
        print("database was empty: restored %d record(s) from backup/latest.json" % n)
        return True

    def mark_dirty(self):
        with self.lock:
            self.dirty = True

    def loop(self):
        while True:
            try:
                changed = self.scan_questions()
                n = self.scan_inbox()
                with self.lock:
                    dirty, self.dirty = self.dirty, False
                if changed or n or dirty:
                    self.backup()
            except Exception as e:  # noqa: BLE001
                print("sync error:", e, file=sys.stderr)
            time.sleep(2)

    def start(self):
        threading.Thread(target=self.loop, daemon=True).start()


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]
    return s or "question"

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
    def __init__(self, store, reviewer, files):
        self.store, self.reviewer, self.files = store, reviewer, files

    @property
    def can_review(self):
        return self.reviewer.available

    def run_review(self, q, s):
        return reviewer.review(q, s, self.reviewer)

    def draft_question(self, text, hint="", slug=None):
        return drafter.draft(text, self.reviewer, hint, slug)

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
        s["status"] = "reviewing" if self.can_review else "done"
        self.store.put_submission(s)
        if self.can_review:
            try:
                fb = self.run_review(q, s)
                self.store.put_feedback(sid, fb)
                s["status"] = "done"
            except Exception as e:  # noqa: BLE001
                s["status"] = "review-failed"
                s["reviewError"] = str(e)[:300]
            self.store.put_submission(s)
        self.files.mark_dirty()


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
            return self._json(200, {"ok": True, "version": VERSION, "hasKey": self.app.can_review, "reviewer": self.app.reviewer.backend if self.app.can_review else "off", "model": self.app.reviewer.model_name, "dataDir": str(st.path.parent), "questionsDir": str(self.app.files.qdir), "inboxDir": str(self.app.files.inbox), "backupDir": str(self.app.files.bdir)})
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
            sol = q.pop("solution", None)
            self.app.store.put_question(q)
            self.app.files.write_question(q)
            if sol and str(sol).strip():
                (self.app.files.qdir / (qid + ".solution.py")).write_text(str(sol))
            self.app.files.mark_dirty()
            return self._json(200, summarize_question(q))
        return self._json(404, {"error": "no such route"})

    def do_DELETE(self):
        p = urlparse(self.path).path
        if p.startswith("/api/questions/"):
            qid = unquote(p.split("/", 3)[3])
            self.app.store.delete_question(qid)
            self.app.files.remove_question_file(qid)
            self.app.files.mark_dirty()
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
            self.app.files.mark_dirty()
            threading.Thread(target=self.app.evaluate, args=(s["id"],), daemon=True).start()
            return self._json(201, summarize_submission(s))
        if p.startswith("/api/submissions/") and p.endswith("/review"):
            sid = unquote(p.split("/")[3])
            s = st.submission(sid)
            if not s:
                return self._json(404, {"error": "not found"})
            if not self.app.can_review:
                return self._json(409, {"error": "Reviews are off: install Claude Code and sign in, or set ANTHROPIC_API_KEY, then restart the server."})
            try:
                fb = self.app.run_review(st.question(s["questionId"]), s)
            except Exception as e:  # noqa: BLE001
                return self._json(502, {"error": "review failed: %s" % str(e)[:300]})
            st.put_feedback(sid, fb)
            s["status"] = "done"
            st.put_submission(s)
            self.app.files.mark_dirty()
            return self._json(200, fb)
        if p == "/api/questions/draft":
            body = self._body()
            text = str(body.get("text") or "")
            if len(text.strip()) < 40:
                return self._json(400, {"error": "Paste the question text first (at least a few sentences)."})
            if not self.app.can_review:
                return self._json(409, {"error": "Drafting needs Claude: install Claude Code and sign in, or set an API key, then restart the server."})
            try:
                d = self.app.draft_question(text, str(body.get("hint") or ""), slugify(str(body.get("slug") or "")) if body.get("slug") else None)
            except Exception as e:  # noqa: BLE001
                return self._json(502, {"error": "draft failed: %s" % str(e)[:300]})
            q = d["question"]
            if not body.get("slug"):
                q["id"] = slugify(q.get("title") or "question")
            base = q["id"]
            n = 2
            while st.question(q["id"]):
                q["id"] = "%s-%d" % (base, n)
                n += 1
            return self._json(200, {"question": q, "solution": d["solution"], "report": d["report"], "notes": d["notes"]})
        if p == "/api/import":
            n = st.import_(self._body())
            self.app.files.export_all_questions()
            self.app.files.mark_dirty()
            return self._json(200, {"imported": n})
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


def default_data_dir():
    """Data lives inside the repo folder (gitignored) so the whole thing is one directory."""
    return ROOT / "data"


def migrate_old_data(data):
    """Move ~/.whetstone into the repo's data folder the first time, if it exists."""
    old = Path.home() / ".whetstone"
    if data.resolve() == old.resolve() or not old.is_dir() or (data / "whetstone.db").exists():
        return
    if any(old.iterdir()):
        data.parent.mkdir(parents=True, exist_ok=True)
        if data.exists() and any(data.iterdir()):
            for item in old.iterdir():
                target = data / item.name
                if not target.exists():
                    shutil.move(str(item), str(target))
        else:
            if data.exists():
                data.rmdir()
            shutil.move(str(old), str(data))
        print("moved your data from %s to %s" % (old, data))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=int(os.environ.get("WHETSTONE_PORT", 8787)))
    ap.add_argument("--data", default=os.environ.get("WHETSTONE_DATA") or str(default_data_dir()))
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    data = Path(a.data).expanduser()
    migrate_old_data(data)
    data.mkdir(parents=True, exist_ok=True)
    cfg = {}
    cfg_path = data / "config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text())
        except json.JSONDecodeError:
            print("config.json is not valid JSON; ignoring", file=sys.stderr)
    key = os.environ.get("ANTHROPIC_API_KEY") or cfg.get("anthropicApiKey") or ""
    model = os.environ.get("WHETSTONE_MODEL") or cfg.get("model") or ""
    want = (os.environ.get("WHETSTONE_REVIEWER") or cfg.get("reviewer") or "auto").lower()
    if want == "auto":
        backend = "api" if key else ("claude-code" if reviewer.claude_cli() else "api")
    else:
        backend = want
    if backend == "claude-code" and not reviewer.claude_cli():
        print("reviewer is set to claude-code but the `claude` command was not found; reviews are off", file=sys.stderr)
    store = Store(data / "whetstone.db")
    files = Files(store, data)
    rv = reviewer.Reviewer(backend, key, model, cwd=str(data))
    Handler.app = App(store, rv, files)
    files.app = Handler.app
    files.restore_if_empty()
    changed = files.scan_questions()
    if changed:
        print("loaded %d question file(s) from %s" % (len(changed), files.qdir))
    files.export_all_questions()
    files.backup()
    files.start()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("Whetstone  http://%s:%d/" % ("localhost" if a.host == "127.0.0.1" else a.host, a.port))
    print("data       %s  (questions/ to add or edit, inbox/ to drop files, backup/latest.json to restore)" % data)
    app = Handler.app
    if app.can_review:
        print("reviews    on via %s, model %s" % ("Claude Code (your subscription)" if backend == "claude-code" else "Anthropic API", rv.model_name))
    else:
        print("reviews    off: install Claude Code and sign in (uses your Claude plan), or set ANTHROPIC_API_KEY")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
