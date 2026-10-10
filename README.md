# Whetstone

A private interview-practice notebook. The app code is public (this repo, served on GitHub Pages); **every question, solution and review stays on your own machine** in a SQLite file behind a small local server.

- **Questions with gates.** A question is a sequence of parts, each with its own prompt, entry function, test cases and time budget. Code carries over from part to part, the way escalating interview questions work.
- **Real Python in the browser.** Tests run in Pyodide (CPython compiled to WebAssembly) in milliseconds. The server re-grades every submission in real CPython.
- **Timed attempts.** One clock for the attempt, one per part, with pause. Submitting a part stores the code, test results and both times.
- **Claude reviews**, run by the local server through Claude Code on your Claude plan (or an API key): a 1–5 verdict, seven dimensions (approach, correctness, efficiency, edge cases, your own tests, clarity, extensibility), named issues with fixes, skill gaps that add up across questions, and the code rewritten the way a strong candidate would have written it, with the reasons.
- **Questions from pasted text.** Paste a forum post or interviewer notes; Claude writes the parts, tests and a reference solution, and the server verifies the solution against the tests before you save.
- **An interview-style pad.** The prompt is what the interviewer would say, with the fine rules deliberately left out; an *Ask the interviewer* chat (Claude, working from a hidden spec) answers clarifying questions, and what you ask is graded. Dark editor and output console, part tabs, timers. `⌘↵` runs your file as a script with your own tests; `⇧⌘↵` submits, which grades against hidden tests and sends code, tests and chat for review. Follow-ups are revealed only as you submit; any past attempt can be resumed.
- **Drills and variants.** Claude writes short single-part drills around a skill gap or topic (verified before saving), and new full questions in the style of your own ones with a different scenario. *Revise with Claude* on a question's Edit page changes parts, spec, tests and reference solution together.
- **Analytics** that say what to fix next: the three most actionable findings with a drill button each, quality and pass-rate trends, per-dimension scores with movement, where full attempts end, pace against budget, recurring gaps.

## Run it

One-time setup (clones into `~/Work/whetstone` and launches):

```
curl -fsSL https://raw.githubusercontent.com/m-chanakya/whetstone/main/setup.sh | bash
```

After that: `~/Work/whetstone/whetstone.sh` starts the server and opens the browser (`stop`, `update`, `logs` also work). Or by hand:

```
python3 server.py                        # http://localhost:8787
```

Python 3.10+ and nothing else; the server is standard library only. Data lives in `data/` inside this folder, which git ignores, so `git pull` never touches it and deleting the folder removes everything (`--data DIR` or `WHETSTONE_DATA` moves it). An older `~/.whetstone` is migrated automatically.

**Reviews.** If [Claude Code](https://code.claude.com/docs/en/overview) is installed and signed in (`claude` on PATH), the server uses it in print mode and the reviews count against your Claude Pro/Max plan; no API key needed. Otherwise set `ANTHROPIC_API_KEY`, or put `{"anthropicApiKey": "sk-ant-...", "model": "claude-sonnet-5-5"}` in `data/config.json`, and the API is billed separately. `"reviewer": "claude-code"` or `"api"` in `config.json` forces one; `"model"` picks the model (an alias such as `sonnet`/`opus` for Claude Code).

Open `http://localhost:8787` and work there. The GitHub Pages copy at https://m-chanakya.github.io/whetstone/ is the same app; it talks to `http://localhost:8787` on whichever machine you open it from, so the server has to be running either way, and your data never leaves it.

## Your data, as files

Everything in `data/` is meant to be handled without the UI:

- `questions/<id>.md` — one Markdown file per question (front matter, then one `## Part N: title` section per gate with `entry:`, `minutes:`, the spoken prompt, a ```` ```spec ```` block with the hidden rules the interviewer answers from, and a ```` ```tests ```` block). `kind: drill` marks a drill. Add or edit files here and the server syncs them within seconds; edits in the UI are written back. `.json` works too.
- `inbox/` — drop a question (`.md` or `.json`) or a backup/export file here and it is imported within seconds, then renamed `.imported`. Drop a `.txt` with pasted question text (a forum post, interviewer notes) and Claude turns it into a full question: parts, entry functions, test cases and a reference solution, which the server runs against every test before the question is written to `questions/`. `whetstone.sh add FILE…` does the copy for you. The same thing is on the Add question page as a paste box.
- `backup/latest.json` — full export, rewritten after every change, plus daily snapshots. If the database is ever missing or empty, the server restores from it automatically. `whetstone.sh backup` writes a timestamped export; `whetstone.sh restore FILE` merges one back.
- `whetstone.db` — the SQLite database itself.

Settings in the app has Export/Import buttons for the same files.

## Test case format

One per line, `JSON args => JSON expected`. Args are passed positionally; a non-array left side is treated as a single argument. Lines starting with `#` are ignored.

```
[[[0,0,0],[0,1,0],[0,0,0]]] => 2
[[[0,0],[0,0]]] => -1
```

Numbers compare with a 1e-9 tolerance; object keys are order-insensitive.

## Layout

```
index.html app.js app.css   the app (also deployed to GitHub Pages)
vendor/codemirror           editor
server.py                   local backend: static files + /api/*, SQLite store
backend/runner.py           CPython grader, one isolated subprocess per test case, 5 s limit
backend/review.py           Claude review prompt and normalizer
.github/workflows/pages.yml deploys the app to Pages on push
```

API (all JSON, localhost only): `GET /api/health`, `GET /api/index`, `GET|PUT|DELETE /api/questions/:id`, `GET /api/submissions/:id`, `POST /api/submissions`, `POST /api/submissions/:id/review`, `GET /api/export`, `POST /api/import`.
