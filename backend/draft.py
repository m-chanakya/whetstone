"""Turn pasted interview-question text into a Whetstone question, verified.

Claude writes the question in the Markdown format (parts, entry functions,
test cases) plus a reference solution; the reference solution is then run
against every part's tests in real CPython. Failures go back to Claude once
for a fix. The result carries a verification report so the user can see what
was checked.
"""
import json

from . import qmd, runner

SCHEMA = {
    "type": "object",
    "properties": {
        "markdown": {"type": "string"},
        "solution": {"type": "string"},
        "notes": {"type": "string"},
    },
    "required": ["markdown", "solution"],
}

FORMAT = '''---
title: <short title>
topic: <one of: Arrays & strings, Hash maps & sets, Two pointers & sliding window, Stacks & queues, Linked lists, Trees, Graphs, Heaps, Binary search, Sorting, Recursion & backtracking, Dynamic programming, Greedy, Intervals, Bit manipulation, Math, Tries, Object-oriented design, Simulation, Concurrency, System design>
difficulty: easy | medium | hard
lang: python
source: <company and round if known, else blank>
url: <source link if given, else blank>
---
<overview: 2-4 sentences on what the whole question is about, what interviewers look for, and how the parts escalate. Mention the input encoding (e.g. grid values) once here so every part can rely on it.>

## Part 1: <title>
entry: <python function name the tests call>
minutes: <time budget for this part>

<the full prompt for this part: precise rules, what the function takes and returns, worked example in words. Written so a candidate can implement it without seeing the original text.>

```tests
<JSON args> => <JSON expected>
<one test per line; 6 to 10 per part; include edge cases (empty, single, all-same, unreachable, largest sensible size)>
```

## Part 2: <title>
...
'''


def prompt_for(text, hint=""):
    return f"""You turn the raw text of a coding interview question into a practice question with escalating parts, test cases, and a reference solution.

<raw_question>
{text.strip()[:30000]}
</raw_question>
{('Extra guidance from the user: ' + hint.strip()[:2000]) if hint.strip() else ''}

Rules:
- Keep every part and follow-up the raw text describes, in the order an interviewer would ask them. If the text describes variants, make each a part. If it describes only one task, make 2-3 parts anyway: the base task, then one or two natural follow-ups interviewers ask for it.
- Each part has ONE entry function with a clear signature that the tests call positionally. Inputs and outputs must be JSON-serialisable (lists, dicts, numbers, strings, booleans, null); no classes or tuples in signatures. Later parts may define new functions; code is cumulative.
- Test lines are `JSON args => JSON expected`, args being a JSON array of positional arguments. Make the expected values by reasoning carefully; the reference solution will be executed against them, so they must be right.
- Time budgets should add up to roughly the interview length the text implies (default 45-60 minutes).
- The reference solution is one complete Python 3 file that defines every entry function from every part, passes every test, uses only the standard library, and is written the way a strong candidate would write it (clear names, no cleverness for its own sake).
- Do not reproduce the raw text verbatim; rewrite prompts in your own words, fully specified.

Reply with only one JSON object: {{"markdown": "<the question in exactly the format below>", "solution": "<the reference solution .py file>", "notes": "<anything you were unsure about, one or two sentences, or empty>"}}

The Markdown format:
{FORMAT}"""


def verify(markdown, solution):
    """Run the solution against every part's tests. Returns (question, report)."""
    q = qmd.parse(markdown, "draft")
    report = {"parts": [], "ok": True}
    for g in q["gates"]:
        try:
            tests = runner.parse_tests(g.get("tests", ""))
        except ValueError as e:
            report["parts"].append({"title": g["title"], "error": "malformed tests: %s" % e, "passed": 0, "total": 0})
            report["ok"] = False
            continue
        r = runner.run(solution, g.get("entry") or "", tests)
        failed = [c for c in r["cases"] if not c["pass"]]
        report["parts"].append({"title": g["title"], "entry": g.get("entry"), "passed": r["passed"], "total": r["total"],
                                "failed": [{"raw": c["raw"], "got": c["got"]} for c in failed][:6]})
        if failed or not tests:
            report["ok"] = False
    return q, report


def fix_prompt(markdown, solution, report):
    fails = []
    for p in report["parts"]:
        if p.get("error"):
            fails.append("Part '%s': %s" % (p["title"], p["error"]))
        for f in p.get("failed", []):
            fails.append("Part '%s' (%s): test `%s` -> reference solution gave %s" % (p["title"], p.get("entry"), f["raw"], f["got"]))
        if p.get("total") == 0 and not p.get("error"):
            fails.append("Part '%s' has no test cases" % p["title"])
    return f"""A practice question and its reference solution disagree. For each failure below decide whether the TEST'S expected value or the SOLUTION is wrong, fix that side, and return the corrected pair. Keep everything else unchanged.

Failures:
{chr(10).join('- ' + f for f in fails)}

<markdown>
{markdown}
</markdown>

<solution>
{solution}
</solution>

Reply with only one JSON object: {{"markdown": "<corrected question markdown>", "solution": "<corrected solution file>", "notes": "<what you changed and why, briefly>"}}"""


def draft(text, reviewer, hint="", slug=None):
    """Return {"question", "markdown", "solution", "report", "notes"}; raises on model failure."""
    raw = reviewer.ask_json(prompt_for(text, hint), SCHEMA)
    markdown, solution, notes = str(raw.get("markdown") or ""), str(raw.get("solution") or ""), str(raw.get("notes") or "")
    if "## " not in markdown:
        raise ValueError("Claude did not return a question in the expected format")
    q, report = verify(markdown, solution)
    rounds = 1
    if not report["ok"]:
        raw2 = reviewer.ask_json(fix_prompt(markdown, solution, report), SCHEMA)
        m2, s2 = str(raw2.get("markdown") or ""), str(raw2.get("solution") or "")
        if "## " in m2:
            q2, report2 = verify(m2, s2)
            passed_before = sum(p.get("passed", 0) for p in report["parts"])
            passed_after = sum(p.get("passed", 0) for p in report2["parts"])
            if report2["ok"] or passed_after >= passed_before:
                markdown, solution, q, report = m2, s2, q2, report2
                notes = (notes + "\n" + str(raw2.get("notes") or "")).strip()
        rounds = 2
    if slug:
        q["id"] = slug
    report["rounds"] = rounds
    return {"question": q, "markdown": markdown, "solution": solution, "report": report, "notes": notes}
