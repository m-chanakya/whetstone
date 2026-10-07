"""Run one submission's code against its gate's tests in real CPython.

Usage:
  python scripts/run_tests.py data/submissions/<qid>/<file>.json   # prints JSON results
  python scripts/run_tests.py --all                                 # every submission missing cpython results

Each test case runs in a fresh subprocess with a time limit, so an infinite
loop or a crash in one case cannot take the others down.
"""
import json
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT = 5

RUNNER = textwrap.dedent(
    """
    import json, sys, time, traceback
    src = open(sys.argv[1]).read()
    entry = sys.argv[2]
    args = json.loads(sys.argv[3])
    g = {"__name__": "__submission__"}
    try:
        exec(compile(src, "submission.py", "exec"), g)
    except Exception:
        print(json.dumps({"err": "load: " + traceback.format_exc(limit=1).strip().splitlines()[-1]}))
        sys.exit(0)
    fn = g.get(entry)
    if not callable(fn):
        print(json.dumps({"err": "entry function %r not found" % entry}))
        sys.exit(0)
    t0 = time.perf_counter()
    try:
        r = fn(*args)
        print(json.dumps({"got": json.dumps(r, default=str), "ms": round((time.perf_counter() - t0) * 1000, 2)}))
    except Exception:
        print(json.dumps({"err": traceback.format_exc(limit=2).strip().splitlines()[-1], "ms": round((time.perf_counter() - t0) * 1000, 2)}))
    """
)


def canon(v):
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k) + ":" + canon(v[k]) for k in sorted(v)) + "}"
    if isinstance(v, bool):
        return json.dumps(v)
    if isinstance(v, (int, float)):
        return str(round(v)) if abs(v - round(v)) < 1e-9 else str(round(v, 9))
    return json.dumps(v)


def parse_tests(text):
    tests = []
    for i, line in enumerate((text or "").splitlines(), 1):
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("//"):
            continue
        k = s.rfind("=>")
        if k < 0:
            raise ValueError("line %d: expected 'args => result'" % i)
        args = json.loads(s[:k].strip())
        if not isinstance(args, list):
            args = [args]
        tests.append({"args": args, "expected": canon(json.loads(s[k + 2:].strip())), "raw": s, "line": i})
    return tests


def run(code, entry, tests):
    graded, passed = [], 0
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
        src = f.name
    for t in tests:
        try:
            p = subprocess.run([sys.executable, "-I", "-c", RUNNER, src, entry, json.dumps(t["args"])],
                               capture_output=True, text=True, timeout=TIMEOUT)
            out = p.stdout.strip().splitlines()
            res = json.loads(out[-1]) if out else {"err": (p.stderr.strip().splitlines() or ["no output"])[-1]}
        except subprocess.TimeoutExpired:
            res = {"err": "timed out after %ds" % TIMEOUT, "ms": TIMEOUT * 1000}
        except Exception as e:  # noqa: BLE001
            res = {"err": str(e)}
        ok = False
        if "err" in res:
            got = res["err"]
        else:
            try:
                got = canon(json.loads(res["got"]))
            except Exception:  # noqa: BLE001
                got = res["got"]
            ok = got == t["expected"]
        passed += ok
        graded.append({"raw": t["raw"], "pass": ok, "got": got, "err": "err" in res, "ms": res.get("ms")})
    return {"passed": passed, "total": len(tests), "cases": graded, "runtime": "cpython %d.%d" % sys.version_info[:2]}


def load_question(qid):
    return json.loads((ROOT / "data" / "questions" / (qid + ".json")).read_text())


def grade_submission(path, write=True):
    sub = json.loads(Path(path).read_text())
    q = load_question(sub["questionId"])
    gate = next((g for g in q["gates"] if g["id"] == sub["gateId"]), None)
    if not gate:
        return None
    res = run(sub["code"], gate.get("entry") or "", parse_tests(gate.get("tests", "")))
    sub["cpython"] = res
    if write:
        Path(path).write_text(json.dumps(sub, indent=1) + "\n")
    return res


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        n = 0
        for p in sorted((ROOT / "data" / "submissions").glob("*/*.json")):
            sub = json.loads(p.read_text())
            if "cpython" in sub:
                continue
            r = grade_submission(p)
            if r:
                n += 1
                print(p.relative_to(ROOT), "%d/%d" % (r["passed"], r["total"]))
        print("graded", n)
    else:
        print(json.dumps(grade_submission(sys.argv[1], write=False), indent=1))
