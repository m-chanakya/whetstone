"""Questions as Markdown files, so they are easy to write, edit and keep.

    ---
    title: Infection spread (cellular automata)
    topic: Graphs
    difficulty: hard
    lang: python
    source: OpenAI, 60-minute onsite
    url: https://...
    ---
    Overview paragraphs (shown before part 1).

    ## Part 1: Basic spread
    entry: days_to_infect
    minutes: 12

    Prompt for this part.

    ```tests
    [[[0,0,0],[0,1,0],[0,0,0]]] => 2
    ```

    ## Part 2: ...

The id is the file name (without extension). `parse` and `render` round-trip.
"""
import re

FRONT = ("title", "topic", "difficulty", "lang", "source", "url", "createdAt")
PART_RE = re.compile(r"^##\s+(?:Part\s+\d+\s*[:.\-]\s*)?(.+?)\s*$", re.M)
KV_RE = re.compile(r"^(entry|minutes|id)\s*:\s*(.*?)\s*$")


def parse(text, qid):
    q = {"id": qid, "title": qid, "topic": "", "difficulty": "medium", "lang": "python", "source": "", "url": "", "overview": "", "gates": []}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            for line in text[3:end].strip().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    k, v = k.strip(), v.strip()
                    if k in FRONT:
                        q[k] = v
            body = text[end + 4:]
    parts = PART_RE.split(body)
    q["overview"] = parts[0].strip()
    for i in range(1, len(parts), 2):
        title, content = parts[i].strip(), parts[i + 1]
        gate = {"id": "g%d" % ((i + 1) // 2), "title": title, "entry": "", "minutes": 0, "prompt": "", "tests": ""}
        m = re.search(r"```tests[^\n]*\n(.*?)```", content, re.S)
        if m:
            gate["tests"] = m.group(1).strip("\n")
            content = content[:m.start()] + content[m.end():]
        prompt_lines = []
        for line in content.splitlines():
            if not line.strip() and not prompt_lines:
                continue
            kv = KV_RE.match(line.strip())
            if kv and not prompt_lines:
                k, v = kv.groups()
                if k == "minutes":
                    try:
                        gate["minutes"] = int(float(v))
                    except ValueError:
                        pass
                else:
                    gate[k] = v
            else:
                prompt_lines.append(line)
        gate["prompt"] = "\n".join(prompt_lines).strip()
        q["gates"].append(gate)
    if q["difficulty"] not in ("easy", "medium", "hard"):
        q["difficulty"] = "medium"
    return q


def render(q):
    out = ["---"]
    for k in FRONT:
        if q.get(k):
            out.append("%s: %s" % (k, str(q[k]).replace("\n", " ")))
    out.append("---")
    if q.get("overview"):
        out += [q["overview"].strip(), ""]
    for i, g in enumerate(q.get("gates", []), 1):
        out += ["", "## Part %d: %s" % (i, g.get("title") or "Part %d" % i)]
        if g.get("id") and g["id"] != "g%d" % i:
            out.append("id: %s" % g["id"])
        if g.get("entry"):
            out.append("entry: %s" % g["entry"])
        if g.get("minutes"):
            out.append("minutes: %s" % g["minutes"])
        out += ["", (g.get("prompt") or "").strip(), ""]
        if g.get("tests", "").strip():
            out += ["```tests", g["tests"].strip("\n"), "```"]
    return "\n".join(out).rstrip() + "\n"
