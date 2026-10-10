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

<the prompt the way an interviewer would SAY it: 2-5 sentences, conversational, states the task and the function name/signature to implement, gives one small example, and deliberately leaves the finer rules unstated (tie-breaking, duplicates, empty input, bounds, ordering of output) so the candidate has to ask. Never a bullet list of rules.>

```spec
<the interviewer's private answer key: every precise rule the tests rely on, as short declarative lines (input format and ranges, what to return in each edge case, tie-breaks, ordering, assumptions the candidate may make). The candidate never sees this; the interviewer uses it to answer clarifying questions consistently.>
```

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
- Do not reproduce the raw text verbatim. The prompt is what the interviewer says out loud; the spec block is what they know. Everything a test depends on must be in the spec.

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
    return finish(reviewer.ask_json(prompt_for(text, hint), SCHEMA), reviewer, slug)


VARIANT_FORMAT_NOTE = "Use exactly the same Markdown format as the examples (front matter, parts with entry/minutes, a ```spec block and a ```tests block per part)."


def variant_prompt(examples_md, hint=""):
    ex = "\n\n".join("<example>\n%s\n</example>" % e.strip()[:12000] for e in examples_md[:3])
    return f"""You write new coding interview questions in the style of the examples: same difficulty band, same escalating multi-part structure, same kind of follow-ups, but a DIFFERENT scenario and a different core data model, so solving the example does not solve this one. Keep what makes the examples interview-realistic: an underspecified spoken prompt per part, a precise hidden spec, hidden tests.

{ex}
{('Guidance from the user: ' + hint.strip()[:1500]) if hint.strip() else ''}

Rules: Python 3, standard library only; one entry function per part, JSON-serialisable arguments and return values; 6-10 tests per part including edge cases; time budgets similar to the examples; a complete reference solution that passes every test; set `kind:` in the front matter to the same value as the examples (or omit it) and `variantOf:` to the first example's id if one is given. {VARIANT_FORMAT_NOTE}

Reply with only one JSON object: {{"markdown": "<the new question>", "solution": "<reference solution .py>", "notes": "<what you changed relative to the examples, one sentence>"}}

The Markdown format, for reference:
{FORMAT}"""


DRILLS_SCHEMA = {"type": "object", "properties": {"questions": {"type": "array", "items": SCHEMA}}, "required": ["questions"]}


def drills_prompt(focus, count, examples_md, minutes, hint=""):
    ex = "\n\n".join("<example>\n%s\n</example>" % e.strip()[:6000] for e in examples_md[:2])
    style = ("Style reference from the user's own questions:\n" + ex) if examples_md else ""
    return f"""You write short, focused coding drills for interview practice. Each drill is ONE part, meant to take about {minutes} minutes, and targets this focus: {focus}.
Write {count} distinct drills, each a different scenario, difficulty rising from the first to the last. Each has a spoken-style prompt (brief, with a couple of details deliberately left for the candidate to ask), a precise spec block, 6-10 hidden tests with edge cases, and a complete Python 3 reference solution (standard library only) that passes every test. Put `kind: drill` and `skills: {focus}` in the front matter, `minutes: {minutes}` on the part.
{style}
{('Guidance from the user: ' + hint.strip()[:1500]) if hint.strip() else ''}

Reply with only one JSON object: {{"questions": [{{"markdown": "<drill 1 in the Markdown format>", "solution": "<reference solution>", "notes": ""}}, ...]}}

The Markdown format:
{FORMAT}"""


def revise_prompt(markdown, solution, instruction):
    return f"""Revise this practice interview question as instructed, and keep the rest exactly as it is. If the instruction changes behaviour, update the spec, the tests and the reference solution together so they still agree. Keep the Markdown format identical.

Instruction from the user: {instruction.strip()[:3000]}

<markdown>
{markdown}
</markdown>

<solution>
{solution}
</solution>

Reply with only one JSON object: {{"markdown": "<revised question>", "solution": "<revised reference solution>", "notes": "<what you changed, briefly>"}}"""


def finish(raw, reviewer, slug=None):
    """Verify a (markdown, solution) pair, fix once if needed, return the draft dict."""
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
            if report2["ok"] or sum(p.get("passed", 0) for p in report2["parts"]) >= sum(p.get("passed", 0) for p in report["parts"]):
                markdown, solution, q, report = m2, s2, q2, report2
                notes = (notes + "\n" + str(raw2.get("notes") or "")).strip()
        rounds = 2
    if slug:
        q["id"] = slug
    report["rounds"] = rounds
    return {"question": q, "markdown": markdown, "solution": solution, "report": report, "notes": notes}


def variant(examples_md, reviewer, hint="", variant_of=None):
    d = finish(reviewer.ask_json(variant_prompt(examples_md, hint), SCHEMA), reviewer)
    if variant_of:
        d["question"]["variantOf"] = variant_of
    return d


def drills(focus, count, examples_md, reviewer, minutes=12, hint=""):
    raw = reviewer.ask_json(drills_prompt(focus, count, examples_md, minutes, hint), DRILLS_SCHEMA)
    out = []
    for item in (raw.get("questions") or [])[:count]:
        try:
            d = finish(item, reviewer)
            d["question"]["kind"] = "drill"
            d["question"].setdefault("skills", focus)
            out.append(d)
        except Exception as e:  # noqa: BLE001
            out.append({"error": str(e)})
    return out


def revise(markdown, solution, instruction, reviewer, slug):
    return finish(reviewer.ask_json(revise_prompt(markdown, solution, instruction), SCHEMA), reviewer, slug)
