# Whetstone

A private interview-practice notebook. The app code is public (this repo, served on GitHub Pages); **every question, solution and review stays on your own machine** in a SQLite file behind a small local server.

- **Questions with gates.** A question is a sequence of parts, each with its own prompt, entry function, test cases and time budget. Code carries over from part to part, the way escalating interview questions work.
- **Real Python in the browser.** Tests run in Pyodide (CPython compiled to WebAssembly) in milliseconds. The server re-grades every submission in real CPython.
- **Timed attempts.** One clock for the attempt, one per part, with pause. Submitting a part stores the code, test results and both times.
- **Claude reviews**, run by the local server with your API key: a 1–5 verdict, five quality dimensions (correctness, efficiency, edge cases, clarity, extensibility), named issues with fixes, and skill gaps that add up across questions.
- **Analytics** aimed at the interview: readiness (first three parts clean, in time, at quality), where attempts stall by part, time against budget, quality by dimension and topic, recurring gaps, progress across attempts.

## Run it

```
git clone https://github.com/m-chanakya/whetstone
cd whetstone
export ANTHROPIC_API_KEY=sk-ant-...      # optional: turns on reviews
python3 server.py                        # http://localhost:8787
```

Python 3.10+ and nothing else; the server is standard library only. Data lives in `~/.whetstone/whetstone.db` (change with `--data DIR` or `WHETSTONE_DATA`). Instead of the environment variable you can put `{"anthropicApiKey": "sk-ant-...", "model": "claude-sonnet-5-5"}` in `~/.whetstone/config.json`.

Open `http://localhost:8787` and work there. The GitHub Pages copy at https://m-chanakya.github.io/whetstone/ is the same app; it talks to `http://localhost:8787` on whichever machine you open it from, so the server has to be running either way, and your data never leaves it.

**Seeding.** Any `*.json` file dropped into `~/.whetstone/seed/` is imported on the next start (shape: `{"questions": [...], "submissions": [...]}`, the same as an export) and renamed `.imported`. Settings → Export JSON gives you a full private backup; Import merges one back.

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
