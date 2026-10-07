"""Rebuild data/index.json from the files on disk. The page reads only this file."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main():
    questions, submissions = [], []
    for p in sorted((DATA / "questions").glob("*.json")):
        q = json.loads(p.read_text())
        questions.append({k: q.get(k) for k in ("id", "title", "topic", "difficulty", "lang", "source", "url", "createdAt")}
                         | {"gates": [{k: g.get(k) for k in ("id", "title", "entry", "minutes")} for g in q.get("gates", [])]})
    feedback = {}
    for p in (DATA / "feedback").glob("*/*.json"):
        fb = json.loads(p.read_text())
        feedback[fb.get("submissionId") or p.stem] = {k: fb.get(k) for k in ("at", "by", "model", "overall", "scores", "summary", "issues", "gaps", "nextStep", "time", "space", "strengths")}
    for p in sorted((DATA / "submissions").glob("*/*.json")):
        s = json.loads(p.read_text())
        run = s.get("cpython") or s.get("browser") or {}
        submissions.append({
            "id": s["id"], "questionId": s["questionId"], "gateId": s["gateId"], "attemptId": s.get("attemptId"), "at": s["at"],
            "elapsedSec": s.get("elapsedSec"), "gateSec": s.get("gateSec"), "lines": s.get("lines"),
            "passed": run.get("passed"), "total": run.get("total"), "runtime": run.get("runtime"),
            "feedback": feedback.get(s["id"]),
        })
    submissions.sort(key=lambda s: s["at"])
    out = {"builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "builtBy": "action", "questions": questions, "submissions": submissions}
    (DATA / "index.json").write_text(json.dumps(out, indent=1) + "\n")
    print("index: %d questions, %d submissions, %d with feedback" % (len(questions), len(submissions), sum(1 for s in submissions if s["feedback"])))


if __name__ == "__main__":
    main()
