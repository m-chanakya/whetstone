"""Builds data/questions/infection-spread.json from reference solutions.

Run it once; the committed JSON is what the app and the eval read. Re-run if
the prompts or the test grids change.
"""
import json
from collections import deque
from pathlib import Path

DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def days_to_infect(grid):
    if not grid or not grid[0]:
        return 0
    r, c = len(grid), len(grid[0])
    dist = [[-1] * c for _ in range(r)]
    q = deque()
    for i in range(r):
        for j in range(c):
            if grid[i][j] == 1:
                dist[i][j] = 0
                q.append((i, j))
    while q:
        i, j = q.popleft()
        for di, dj in DIRS:
            a, b = i + di, j + dj
            if 0 <= a < r and 0 <= b < c and grid[a][b] == 0 and dist[a][b] < 0:
                dist[a][b] = dist[i][j] + 1
                q.append((a, b))
    best = 0
    for i in range(r):
        for j in range(c):
            if grid[i][j] == 0:
                if dist[i][j] < 0:
                    return -1
                best = max(best, dist[i][j])
    return best


def days_with_immune(grid):
    # Same BFS; immune cells (2) are walls. Healthy cells with no route stay healthy -> -1.
    return days_to_infect(grid)


def days_until_stable(grid, d):
    if not grid or not grid[0]:
        return 0
    r, c = len(grid), len(grid[0])
    state = [row[:] for row in grid]
    age = [[0] * c for _ in range(r)]
    day = 0
    while any(state[i][j] == 1 for i in range(r) for j in range(c)):
        day += 1
        newly = []
        for i in range(r):
            for j in range(c):
                if state[i][j] == 1:
                    for di, dj in DIRS:
                        a, b = i + di, j + dj
                        if 0 <= a < r and 0 <= b < c and state[a][b] == 0:
                            newly.append((a, b))
        for i in range(r):
            for j in range(c):
                if state[i][j] == 1:
                    age[i][j] += 1
                    if age[i][j] >= d:
                        state[i][j] = 2
        for a, b in newly:
            state[a][b] = 1
            age[a][b] = 0
    return day


def days_with_threshold(grid, k):
    if not grid or not grid[0]:
        return [0, 0]
    r, c = len(grid), len(grid[0])
    state = [row[:] for row in grid]
    day = 0
    while True:
        newly = []
        for i in range(r):
            for j in range(c):
                if state[i][j] == 0:
                    n = 0
                    for di, dj in DIRS:
                        a, b = i + di, j + dj
                        if 0 <= a < r and 0 <= b < c and state[a][b] == 1:
                            n += 1
                    if n >= k:
                        newly.append((i, j))
        if not newly:
            break
        day += 1
        for i, j in newly:
            state[i][j] = 1
    healthy = sum(1 for i in range(r) for j in range(c) if state[i][j] == 0)
    return [day, healthy]


def min_loss_one_burn(grid):
    if not grid or not grid[0]:
        return 0
    r, c = len(grid), len(grid[0])

    def loss_after(burn_row=None, burn_col=None):
        g = [row[:] for row in grid]
        burned = 0
        for i in range(r):
            for j in range(c):
                if i == burn_row or j == burn_col:
                    if g[i][j] != 2:
                        burned += 1
                    g[i][j] = 2
        q = deque((i, j) for i in range(r) for j in range(c) if g[i][j] == 1)
        infected = len(q)
        while q:
            i, j = q.popleft()
            for di, dj in DIRS:
                a, b = i + di, j + dj
                if 0 <= a < r and 0 <= b < c and g[a][b] == 0:
                    g[a][b] = 1
                    infected += 1
                    q.append((a, b))
        return burned + infected

    best = loss_after()
    for i in range(r):
        best = min(best, loss_after(burn_row=i))
    for j in range(c):
        best = min(best, loss_after(burn_col=j))
    return best


def fmt(args, expected):
    return json.dumps(args, separators=(",", ":")) + " => " + json.dumps(expected, separators=(",", ":"))


G = {
    "center": [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
    "corner": [[1, 0, 0], [0, 0, 0], [0, 0, 0]],
    "none": [[0, 0], [0, 0]],
    "all": [[1, 1], [1, 1]],
    "line": [[1, 0, 0, 0, 0, 0, 0]],
    "two_sources": [[1, 0, 0, 0, 0, 0, 1]],
    "empty": [],
    "wall": [[1, 2, 0], [0, 2, 0], [0, 2, 0]],
    "wall_gap": [[1, 2, 0], [0, 2, 0], [0, 0, 0]],
    "sealed": [[1, 0, 2, 0], [2, 2, 2, 0]],
    "immune_only": [[2, 2], [2, 2]],
    "snake": [[1, 2, 0, 0], [0, 2, 0, 2], [0, 0, 0, 2]],
    "big": [[0] * 6 for _ in range(6)],
    "ring": [[0, 0, 0, 0], [0, 2, 2, 0], [0, 2, 1, 0], [0, 0, 0, 0]],
}
G["big"][0][0] = 1
G["big"][5][5] = 1
G["ring"][2][2] = 1  # infected inside a partial ring; can escape via the open side

gates = [
    {
        "id": "g1",
        "title": "Basic spread",
        "entry": "days_to_infect",
        "minutes": 12,
        "prompt": (
            "You are given an M x N grid. Each cell is 0 (healthy) or 1 (infected).\n\n"
            "Every day, every infected cell infects all of its healthy orthogonal neighbours (up, down, left, right) at the same time. "
            "Cells infected today only start spreading tomorrow.\n\n"
            "Write days_to_infect(grid) that returns the number of days until every cell is infected, "
            "or -1 if that can never happen. A grid that is already fully infected, or has no cells at all, takes 0 days."
        ),
        "tests": [
            fmt([G["center"]], days_to_infect(G["center"])),
            fmt([G["corner"]], days_to_infect(G["corner"])),
            fmt([G["none"]], days_to_infect(G["none"])),
            fmt([G["all"]], days_to_infect(G["all"])),
            fmt([G["line"]], days_to_infect(G["line"])),
            fmt([G["two_sources"]], days_to_infect(G["two_sources"])),
            fmt([G["empty"]], days_to_infect(G["empty"])),
            fmt([G["big"]], days_to_infect(G["big"])),
        ],
    },
    {
        "id": "g2",
        "title": "Immune cells",
        "entry": "days_with_immune",
        "minutes": 8,
        "prompt": (
            "Now some cells are 2 (immune). Immune cells are never infected and never spread the infection; they act as walls.\n\n"
            "Write days_with_immune(grid) that returns the number of days until every healthy cell is infected, "
            "or -1 if at least one healthy cell can never be reached."
        ),
        "tests": [
            fmt([G["wall"]], days_with_immune(G["wall"])),
            fmt([G["wall_gap"]], days_with_immune(G["wall_gap"])),
            fmt([G["sealed"]], days_with_immune(G["sealed"])),
            fmt([G["immune_only"]], days_with_immune(G["immune_only"])),
            fmt([G["snake"]], days_with_immune(G["snake"])),
            fmt([G["ring"]], days_with_immune(G["ring"])),
            fmt([G["center"]], days_with_immune(G["center"])),
        ],
    },
    {
        "id": "g3",
        "title": "Recovery after D days",
        "entry": "days_until_stable",
        "minutes": 15,
        "prompt": (
            "Infected cells now recover. An infected cell spreads for exactly D days and then becomes immune (2).\n\n"
            "Each day happens in this order: (1) every currently infected cell infects its healthy orthogonal neighbours; "
            "(2) every cell that was infected before today ages by one day, and any cell that has now been infected for D days becomes immune. "
            "Cells infected today have age 0 and do not age or spread until tomorrow. A cell that becomes immune does not spread on the day it recovers.\n\n"
            "Write days_until_stable(grid, D) that returns the number of days until no infected cells remain. "
            "Initially infected cells have age 0 at the start of day 1. If there are no infected cells to begin with, return 0."
        ),
        "tests": [
            fmt([G["center"], 1], days_until_stable(G["center"], 1)),
            fmt([G["center"], 3], days_until_stable(G["center"], 3)),
            fmt([G["line"], 2], days_until_stable(G["line"], 2)),
            fmt([G["none"], 2], days_until_stable(G["none"], 2)),
            fmt([G["all"], 4], days_until_stable(G["all"], 4)),
            fmt([G["wall"], 1], days_until_stable(G["wall"], 1)),
            fmt([G["big"], 2], days_until_stable(G["big"], 2)),
            fmt([G["two_sources"], 1], days_until_stable(G["two_sources"], 1)),
        ],
    },
    {
        "id": "g4",
        "title": "Infection threshold",
        "entry": "days_with_threshold",
        "minutes": 12,
        "prompt": (
            "Back to the Part 1 rules (no recovery; 2 is still immune), with one change: a healthy cell is infected on a given day only if "
            "at least K of its orthogonal neighbours are infected at the start of that day. All infections in a day happen simultaneously.\n\n"
            "Write days_with_threshold(grid, K) that simulates until a day passes with no new infections, and returns [days, healthy_left]: "
            "the number of days on which at least one cell was infected, and how many healthy cells remain at the end."
        ),
        "tests": [
            fmt([G["center"], 1], days_with_threshold(G["center"], 1)),
            fmt([G["center"], 2], days_with_threshold(G["center"], 2)),
            fmt([[[1, 0, 1], [0, 0, 0], [1, 0, 1]], 2], days_with_threshold([[1, 0, 1], [0, 0, 0], [1, 0, 1]], 2)),
            fmt([[[1, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]], 2], days_with_threshold([[1, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]], 2)),
            fmt([G["all"], 3], days_with_threshold(G["all"], 3)),
            fmt([G["two_sources"], 2], days_with_threshold(G["two_sources"], 2)),
            fmt([G["wall_gap"], 1], days_with_threshold(G["wall_gap"], 1)),
            fmt([G["none"], 1], days_with_threshold(G["none"], 1)),
        ],
    },
    {
        "id": "g5",
        "title": "One burn to limit the damage",
        "entry": "min_loss_one_burn",
        "minutes": 13,
        "prompt": (
            "Before the infection spreads (Part 2 rules: 1 spreads to 0, 2 is immune, no threshold, no recovery), you may burn at most one full row "
            "or one full column. Every healthy or infected cell on it is destroyed: each counts as one loss and afterwards behaves like an immune cell. "
            "Immune cells on the line are unaffected and cost nothing.\n\n"
            "Write min_loss_one_burn(grid) that returns the minimum possible total loss, where the loss is the number of burned cells plus the number of cells "
            "that are infected once the spread has finished. Burning nothing is allowed."
        ),
        "tests": [
            fmt([G["center"]], min_loss_one_burn(G["center"])),
            fmt([G["none"]], min_loss_one_burn(G["none"])),
            fmt([G["line"]], min_loss_one_burn(G["line"])),
            fmt([G["wall"]], min_loss_one_burn(G["wall"])),
            fmt([[[1, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]], min_loss_one_burn([[1, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]])),
            fmt([[[1, 2, 0, 0], [2, 2, 0, 0], [0, 0, 0, 0]]], min_loss_one_burn([[1, 2, 0, 0], [2, 2, 0, 0], [0, 0, 0, 0]])),
            fmt([G["big"]], min_loss_one_burn(G["big"])),
            fmt([G["empty"]], min_loss_one_burn(G["empty"])),
        ],
    },
]

question = {
    "id": "infection-spread",
    "title": "Infection spread (cellular automata)",
    "topic": "Graphs",
    "difficulty": "hard",
    "lang": "python",
    "source": "OpenAI, 60-minute onsite",
    "url": "https://www.1point3acres.com/interview/problems/company/openai/infection-spread-cellular-automata",
    "overview": (
        "A five-part escalating question. Interviewers expect a clean multi-source BFS for parts 1 and 2, then a careful simultaneous-update "
        "simulation for parts 3 and 4; part 5 is rarely reached. Clean code on the first three parts is usually a pass.\n\n"
        "Grid cells: 0 healthy, 1 infected, 2 immune. Neighbours are orthogonal only. Each part adds a rule to the previous ones; keep one "
        "file and build on it."
    ),
    "gates": [{**g, "tests": "\n".join(g["tests"])} for g in gates],
    "createdAt": "2026-10-07T06:00:00Z",
}

out = Path(__file__).resolve().parent.parent / "data" / "questions" / "infection-spread.json"
out.write_text(json.dumps(question, indent=1) + "\n")
print("wrote", out)
for g in gates:
    print(g["id"], g["entry"])
    for t in g["tests"]:
        print("  ", t)
