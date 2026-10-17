"""Turn pasted interview-question text into a Whetstone question, verified.

Claude writes the question in the Markdown format (parts, entry functions,
test cases) plus a reference solution; the reference solution is then run
against every part's tests in real CPython. Failures go back to Claude once
for a fix. The result carries a verification report so the user can see what
was checked.
"""
import json
import random
import re

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


# ---------------------------------------------------------------------------
# OpenAI-style questions
#
# The questions reported from OpenAI coding rounds are not puzzle problems.
# They are small working systems built in stages inside one file, with the
# interviewer adding a requirement every ten minutes or so: a bank with
# scheduled payments, a key-value store that grows transactions, a poker hand
# evaluator that grows a dealer, a package planner that grows cycles and
# versions. Correctness under escalation, clean state handling and the
# ability to extend code you wrote twenty minutes ago are what get graded.
# The archetypes below are the public, widely reported shapes; the generator
# picks one that the bank does not cover yet and writes a fresh scenario in
# that shape, never a copy of the reported question.
# ---------------------------------------------------------------------------

ARCHETYPES = [
    ("Card game hand evaluation", ["poker", "card", "hand", "blackjack", "deck"], "Parse hands of cards from strings, rank them by category with tie-breaks, then simulate a dealer or a multi-player round, then add a variant rule."),
    ("In-memory key-value store with transactions", ["key-value", "kv", "transaction", "store with"], "SET/GET/DELETE on a store, then nested BEGIN/COMMIT/ROLLBACK, then a scan or count-by-value, then TTL or versioned reads."),
    ("Bank or ledger with scheduled operations", ["bank", "account", "ledger", "payment", "transfer"], "Accounts with deposit/transfer/balance, then scheduled or cashback payments that apply at a given time, then merging accounts and ranking by activity."),
    ("Rate limiter or throttling policy", ["rate limit", "throttle", "limiter"], "Allow or reject requests per key under a window rule, then per-tier limits, then a sliding window or token bucket, then reporting who was throttled."),
    ("Dependency or package install planner", ["package", "dependency", "install", "topolog"], "Order installs from a dependency list, detect cycles, then version constraints, then minimal reinstall on an upgrade."),
    ("Text layout or formatting engine", ["justif", "wrap", "layout", "format text", "markdown"], "Wrap words to a width, then full justification, then hyphenation or a table/column layout, then a diff of two layouts."),
    ("Grid simulation with simultaneous updates", ["grid", "spread", "automata", "life", "infect", "fire"], "A grid rule applied in rounds (spread, decay, immunity), then multiple sources, then an obstacle or immunity rule, then the earliest time a cell changes."),
    ("Spreadsheet with formulas", ["spreadsheet", "cell", "formula"], "Set cells to numbers, then formulas referencing cells (sums), then recomputation on change, then cycle detection."),
    ("Time-based or versioned store", ["version", "time-based", "timestamp", "snapshot"], "get(key, time) returning the value as of a time, then snapshots, then range queries, then compaction."),
    ("File system or directory tree", ["file system", "directory", "folder", "path"], "mkdir/add file/ls with paths, then sizes and moves, then find by pattern, then quotas."),
    ("Job scheduler or task queue", ["scheduler", "job", "queue", "task", "cron"], "Submit jobs with priorities and durations, then dependencies, then workers with capacity, then preemption or deadlines."),
    ("Cache with eviction policy", ["cache", "lru", "lfu", "ttl", "evict"], "get/put with capacity and LRU, then TTL, then LFU or weighted entries, then statistics."),
    ("Tokenizer or small language processor", ["tokeniz", "bpe", "parser", "calculator", "expression"], "Tokenize text by rules, then merges (BPE-like), then decode, then an expression evaluator with precedence."),
    ("Inventory, orders or matching", ["inventory", "order", "matching", "marketplace", "auction"], "Add stock and orders, then partial fills with priority, then cancellation, then reporting."),
    ("Log aggregation or metrics", ["log", "metric", "aggregat", "event", "analytics"], "Ingest timestamped events, then windowed counts, then top-k by key, then late/out-of-order events."),
    ("Elevator, parking or resource simulation", ["elevator", "parking", "booking", "reservation", "seat"], "Requests for a resource over time, then assignment policy, then capacity and waiting, then fairness or cost."),
    ("Resumable or chunked iterator", ["iterator", "stream", "chunk", "pagination", "resum"], "Iterate a dataset in chunks with a cursor, then resume after failure, then filtering/merging streams, then backpressure."),
    ("Unix-like command pipeline", ["command", "shell", "pipeline", "grep", "sort"], "Implement a few text commands over lines, then piping them, then flags, then a tiny command parser."),
    ("Voting, ranking or leaderboard", ["vote", "rank", "leaderboard", "score", "election"], "Record votes or scores, then rankings with tie-breaks, then time-decayed or weighted scores, then audit of changes."),
    ("Routing or URL dispatch", ["router", "route", "url", "dispatch", "endpoint"], "Register routes with literal paths, then parameters and wildcards, then priority/overlaps, then middleware ordering."),
]


def pick_archetype(existing_titles, hint="", rng=None):
    rng = rng or random.Random()
    titles = " ".join(t.lower() for t in existing_titles)
    hint_l = hint.lower()
    if hint_l:
        for name, kws, _ in ARCHETYPES:
            if any(k in hint_l for k in kws) or name.lower() in hint_l:
                return (name, kws, ARCHETYPES[[a[0] for a in ARCHETYPES].index(name)][2])
    uncovered = [a for a in ARCHETYPES if not any(k in titles for k in a[1])]
    return rng.choice(uncovered or ARCHETYPES)


OPENAI_STYLE = """What makes a question OpenAI-style (write it this way):
- It is a small working system built in ONE file over 45-60 minutes, in 3-5 parts, each part a new requirement an interviewer would add after seeing the previous one work. Not a puzzle, not a LeetCode trick, no need for a clever algorithm; the difficulty is in keeping state correct and code extensible as rules pile up.
- Part 1 is deliberately simple (a strong candidate finishes it in 8-10 minutes) and establishes the data model. Parts 2-3 are where candidates fail: a rule that interacts with earlier state (ordering, time, nesting, partial application, tie-breaks). Part 4-5 are reached by few and reward design.
- Inputs are concrete and realistic: lists of command strings or tuples, timestamps as integers, names as strings. Outputs are plain values the tests can compare. Each part's entry function can take the full command list so earlier parts keep being tested.
- The spoken prompt per part is short and leaves rules unstated (what happens on a duplicate, on an unknown key, on ties, on a zero amount), so the candidate must ask; the spec block pins every one of them because the hidden tests depend on them.
- Edge cases that matter in these interviews: operations on missing entities, repeated operations, ordering by time then by name, empty input, large counts, operations arriving out of order.
- Avoid: graph theory for its own sake, dynamic programming, math puzzles, bit tricks, anything where the whole difficulty is knowing one algorithm."""


def openai_prompt(archetype, examples_md, hint="", avoid_titles=()):
    name, _, shape = archetype
    ex = "\n\n".join("<example>\n%s\n</example>" % e.strip()[:9000] for e in examples_md[:2])
    style = ("Format and tone reference, from the user's own questions (do not reuse their scenarios):\n" + ex) if examples_md else ""
    avoid = ("Scenarios already in the user's bank, do not reuse them: " + "; ".join(list(avoid_titles)[:40]) + ".") if avoid_titles else ""
    return f"""You write coding interview questions of the kind OpenAI asks in its coding rounds, for a candidate practising for that interview.

{OPENAI_STYLE}

Write ONE new question of the archetype "{name}": {shape}
Invent a fresh, specific scenario in that shape (a real-sounding product or domain, named entities, plausible numbers). {avoid}
{('Guidance from the user: ' + hint.strip()[:1500]) if hint.strip() else ''}

Rules: Python 3, standard library only; one entry function per part, JSON-serialisable arguments and return values (lists of command lists are fine); 6-10 hidden tests per part including the edge cases above; time budgets that sum to 45-60 minutes with part 1 the shortest; a complete reference solution that passes every test and reads like a strong candidate's code; set `source: OpenAI-style ({name})` in the front matter. {VARIANT_FORMAT_NOTE}
{style}

Reply with only one JSON object: {{"markdown": "<the question>", "solution": "<reference solution .py>", "notes": "<the one rule candidates most often get wrong in this question, one sentence>"}}

The Markdown format, for reference:
{FORMAT}"""


def openai_question(existing_titles, examples_md, reviewer, hint=""):
    arch = pick_archetype(existing_titles, hint)
    d = finish(reviewer.ask_json(openai_prompt(arch, examples_md, hint, existing_titles), SCHEMA), reviewer)
    d["archetype"] = arch[0]
    return d


def openai_drills_prompt(count, minutes, existing_titles, hint=""):
    rng = random.Random()
    picks = []
    pool = ARCHETYPES[:]
    rng.shuffle(pool)
    titles = " ".join(t.lower() for t in existing_titles)
    for a in sorted(pool, key=lambda a: any(k in titles for k in a[1])):
        picks.append(a)
        if len(picks) >= count:
            break
    shapes = "\n".join("- %s: %s" % (a[0], a[2]) for a in picks)
    return f"""You write short coding drills for a candidate practising for OpenAI's coding interview. Each drill is ONE part, about {minutes} minutes, and is the kind of single step those interviews are made of: implement one piece of a small system with concrete command-style input and a clear output, where the difficulty is getting the rules and the state right, not knowing an algorithm.

{OPENAI_STYLE}

Write {count} drills, one per archetype below, each with its own fresh scenario (do not reuse scenarios from the candidate's bank: {"; ".join(list(existing_titles)[:40]) or "none"}):
{shapes}
{('Guidance from the user: ' + hint.strip()[:1500]) if hint.strip() else ''}

Each drill: a short spoken prompt that leaves two or three rules unstated, a spec block that pins them, 6-10 hidden tests with the edge cases that matter (missing entities, repeats, ties, empty input), a complete Python 3 standard-library reference solution that passes every test. Front matter: `kind: drill`, `skills: OpenAI-style`, `source: OpenAI-style (<archetype>)`; the part has `minutes: {minutes}`.

Reply with only one JSON object: {{"questions": [{{"markdown": "<drill 1>", "solution": "<reference solution>", "notes": ""}}, ...]}}

The Markdown format:
{FORMAT}"""


def openai_drills(count, minutes, existing_titles, reviewer, hint=""):
    raw = reviewer.ask_json(openai_drills_prompt(count, minutes, existing_titles, hint), DRILLS_SCHEMA)
    out = []
    for item in (raw.get("questions") or [])[:count]:
        try:
            d = finish(item, reviewer)
            d["question"]["kind"] = "drill"
            sk = str(d["question"].get("skills") or "")
            d["question"]["skills"] = sk if "openai" in sk.lower() else ("OpenAI-style; " + sk if sk else "OpenAI-style")
            out.append(d)
        except Exception as e:  # noqa: BLE001
            out.append({"error": str(e)})
    return out
