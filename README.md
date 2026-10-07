# Whetstone

An interview practice notebook that runs entirely on GitHub Pages, with this repo as its database.

- **Questions with gates.** A question is a sequence of parts (gates), each with its own prompt, entry function, test cases and time budget. Code carries over from part to part, the way escalating interview questions work.
- **Real Python in the browser.** Tests run in Pyodide (CPython compiled to WebAssembly, vendored under `vendor/pyodide`), so a run takes milliseconds and nothing leaves your machine. JavaScript questions run natively.
- **Timed attempts.** One clock for the attempt, one per part. Submitting a part stores the code, its test results and both times.
- **Everything is a file.** `data/questions/*.json`, `data/submissions/<question>/*.json`, `data/feedback/<question>/*.json`. The page writes them through the GitHub API with a token you keep in your browser.
- **Automated eval.** On every push of a submission, a GitHub Action re-runs the tests in real CPython, asks Claude for interview-style feedback (if an `ANTHROPIC_API_KEY` secret exists), rebuilds `data/index.json` and commits the results.
- **Analytics.** Where attempts stall, time against budget per part, code quality by dimension, recurring skill gaps, progress across attempts.

## Setup

1. Push this repo to GitHub (public or private) and enable Pages: Settings → Pages → Source: GitHub Actions. The `pages.yml` workflow deploys on every push to `main`.
2. Create a fine-grained personal access token with **Contents: read and write** on this repo only. Open the site, go to Settings, paste it. It is stored in `localStorage` and sent only to `api.github.com`.
3. Optional: add an `ANTHROPIC_API_KEY` repository secret so the Action reviews submissions. Optional: set a repository variable `WHETSTONE_MODEL` to pick the model.
4. Optional: paste an Anthropic API key into the site's Settings for instant feedback in the page (also browser-only; calls go straight to `api.anthropic.com`).

Without a token the site is read-only: questions and submissions are kept in the browser, and Settings → "Push browser-only data to GitHub" moves them into the repo once a token is set.

## Test case format

One per line, `JSON args => JSON expected`. Args are passed positionally; a non-array left side is treated as a single argument. Lines starting with `#` are ignored.

```
[[[0,0,0],[0,1,0],[0,0,0]]] => 2
[[[0,0],[0,0]]] => -1
```

Numbers compare with a 1e-9 tolerance; object keys are order-insensitive.

## Scripts

- `scripts/run_tests.py <submission.json>` runs one submission in CPython with a 5 s limit per case; `--all` grades everything without results.
- `scripts/review.py` writes feedback for submissions that have none.
- `scripts/build_index.py` rebuilds `data/index.json`.
- `scripts/make_sample_question.py` regenerates the sample question from reference solutions.

## Layout

```
index.html app.js app.css      the site
vendor/pyodide, vendor/codemirror
data/questions/<id>.json       {id,title,topic,difficulty,lang,source,url,overview,gates:[{id,title,entry,minutes,prompt,tests}]}
data/submissions/<qid>/<id>.json  {id,questionId,gateId,attemptId,at,code,elapsedSec,gateSec,browser,cpython}
data/feedback/<qid>/<id>.json  {overall,scores,issues,gaps,summary,...}
data/index.json                what the page loads
.github/workflows/eval.yml     CPython tests + Claude review + index
.github/workflows/pages.yml    deploy
```
