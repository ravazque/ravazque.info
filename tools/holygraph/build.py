#!/usr/bin/env python3
"""Builds server/core/data/holygraph.json: the holy graph's structure (the C Piscine grid, the Common Core's rings for the
C and the Python tracks, the Outer Core's branches) and, for every project in it, its name, XP and estimated hours.

The structure below is the owner's (2026-11-25): the intra's holy graph screenshots, cross-checked with the inscription
rules of 42 Madrid's project sessions (prerequisites, alternatives, milestone and track). The catalog comes from the API:
`go run ./cmd/devtools catalog RAW` (14 requests) writes RAW, this script reads it (no request of its own).

    python3 tools/holygraph/build.py RAW > server/core/data/holygraph.json   (make holygraph does both)

Outer names are the intra's display names; they are resolved to slugs through the catalog, preferring the `42cursus-`
slug when a name exists twice (the Outer versions of Call Me Maybe, RAG and Agent smith).
"""
import json
import re
import sys

# ---- the Common Core: one list per milestone; an item is a slug, {"alt": [...]} (one of them) or {"chain": [...]}
# (modules done in order, drawn as a cluster); an alt may hold chains.
CC = {
    "c": [
        ["42cursus-libft"],
        ["42cursus-get_next_line", "42cursus-ft_printf", "born2beroot"],
        ["42cursus-push_swap", {"alt": ["pipex", "minitalk"]}, {"alt": ["so_long", "42cursus-fdf", "42cursus-fract-ol"]}, "exam-rank-02"],
        ["42cursus-philosophers", "42cursus-minishell", "exam-rank-03"],
        [{"alt": ["minirt", "cub3d"]}, "netpractice", {"chain": [f"cpp-module-0{i}" for i in range(5)]}, "exam-rank-04"],
        [{"alt": ["ft_irc", "webserv"]}, "inception", {"chain": [f"cpp-module-0{i}" for i in range(5, 10)]}, "exam-rank-05"],
        ["ft_transcendence", "exam-rank-06", "42_collaborative_resume"],
    ],
    "python": [
        ["42cursus-libft"],
        ["42cursus-get_next_line", "42cursus-ft_printf", "42next-push_swap"],
        ["42next-born2beroot", "a-maze-ing", "42next-exam-rank-02",
         {"chain": [f"python-module-0{i}" for i in range(5)]},
         {"alt": [{"chain": [f"python-module-0{i}" for i in range(5, 9)]}, {"chain": ["python-module-05-bis", "python-module-06-bis"]}]},
         {"chain": ["python-module-09", "python-module-10"]}],
        ["call-me-maybe", "codexion", "fly-in", "42next-exam-rank-03"],
        ["pac-man", "rag-against-the-machine", "netpractice", "42next-exam-rank-04"],
        ["inception", {"alt": ["tree_nity", "agent-smith"]}, "the-answer-protocol", "42next-exam-rank-05"],
        ["ft_transcendence", "42next-exam-rank-06", "42_collaborative_resume"],
    ],
}

# ---- the C Piscine, as the intra lays it out: four rows
PISCINE = [
    ["c-piscine-shell-01", "c-piscine-c-01", "c-piscine-c-03", "c-piscine-c-05", "c-piscine-c-07", "c-piscine-c-09", "c-piscine-c-11", "c-piscine-c-13"],
    ["c-piscine-shell-00", "c-piscine-c-00", "c-piscine-c-02", "c-piscine-c-04", "c-piscine-c-06", "c-piscine-c-08", "c-piscine-c-10", "c-piscine-c-12"],
    ["c-piscine-rush-00", "c-piscine-rush-01", "c-piscine-rush-02", "c-piscine-bsq"],
    ["c-piscine-exam-00", "c-piscine-exam-01", "c-piscine-exam-02", "c-piscine-final-exam"],
]

# ---- the Outer Core: the branches that leave the last ring, clockwise from the top (as on the intra). A root is a name
# or a box (a piscine of modules: {"box": [piscine names], "modules": "<how to find them>"}); EDGES hang projects from it.
ROOTS = [
    "dr-quine", "woody-woodpacker", "tinky-winkey", "42sh", "corewar", {"box": ["Cybersecurity"]}, "ft_lex", "libasm",
    "ft_linux", "nm", "malloc", "ft_ls", "ft_script", "ft_select", "taskmaster", {"box": ["Piscine Object"]}, "avaj-launcher",
    {"box": ["Piscine ocaml"]}, "doom-nukem", "mod1", "guimp", "scop", {"box": ["Unity"]}, "rt", "zappy", "Open Project",
    {"box": ["AI Rushes"]}, {"box": ["Rushes"]}, "Startup Experience", "Work Experience II", "Work Experience I",
    "Part_Time I", "Part_Time II", {"box": ["Mobile"]}, {"box": ["Piscine Django", "Piscine RoR", "Piscine Symfony"]},
    "Datomic", "Tokenizer", "n-puzzle", "matrix", "computorv1", "Ftl_quantum",
    {"box": ["Piscine Deep Learning", "Piscine Data Science", "Python for Data Science"]},
    "Inception-of-Things", "cloud-1", "ft_lgtm", "Inception of context", "Inception of wisdom", "Ecomesh", "ActiveDiscovery",
    "Bgp At Doors of Autonomous Systems is Simple", "ft_malcolm", "ft_ping",
]
EDGES = """
woody-woodpacker > famine > pestilence > war > death
woody-woodpacker > ft_shield
Cybersecurity > snow-crash > rainfall > override
snow-crash > boot2root > UnleashTheBox
ft_lex > ft_yacc > cc1
libasm > B > cc1
ft_linux > little-penguin-1 > userspace_digressions
little-penguin-1 > drivers-and-interrupts > filesystem
little-penguin-1 > process-and-memory > filesystem
little-penguin-1 > kfs-1 > kfs-2 > kfs-3 > kfs-4 > kfs-5 > kfs-6 > kfs-7 > kfs-8 > kfs-9 > kfs-x
malloc > lem-ipc > nibbler
lem-ipc > strace
lem-ipc > RetroEmu
taskmaster > matt-daemon
Piscine Object > libftpp > Abstract_data
libftpp > abstract-vm
avaj-launcher > swingy > fix-me
Piscine ocaml > ft_turing > h42n42
ft_turing > ft_ality
scop > ft_vox > ft_minecraft > Very_Real_Engine
scop > 42run
scop > humangl > bomberman
humangl > particle-system
humangl > shaderpixel
humangl > ft_newton > Very_Real_Engine
Unity > in-the-shadows > xv > freddie-mercury
Mobile > swifty-companion > swifty-proteins > Peace_Break
Mobile > ft_hangouts
Piscine Django > darkly
Piscine Django > music-room
Piscine Django > red-tetris
Piscine Django > camagru > matcha > hypertube
Tokenizer > TokenizeArt > TokenZwap
n-puzzle > lem_in
n-puzzle > rubik
n-puzzle > gomoku
n-puzzle > krpsim
n-puzzle > expert-system
matrix > ft_kalman
matrix > ready set boole > ft_kleene
computorv1 > computorv2
Ftl_quantum > Supercharge
Piscine Deep Learning > dslr > Leaffliction
dslr > Learn2Slither
dslr > ft_linear_regression
dslr > total-perspective-vortex
dslr > multilayer-perceptron
Piscine Deep Learning > Call Me Maybe > RAG against the machine > Agent smith
ActiveDiscovery > AutomaticDirectory > AdministrativeDirectory > AccessibleDirectory > ActiveConnect
AccessibleDirectory > ActiveTechTales
AccessibleDirectory > MicroForensX
ft_ping > ft_traceroute > ft_nmap
ft_ping > ft_ssl_md5 > ft_ssl_des > ft_ssl_rsa
"""
# the modules of a box that the catalog doesn't parent: by name
AI_RUSHES = ["LeakLab", "BrickDepth", "PrompTrial", "grAff-it", "SpinDetect", "CVForge", "ChromaCraft", "GraphForge", "InterviewSim", "FaceSwap42"]
MODULE_NAMES = {"Piscine ocaml": r"^OCAML\b", "Piscine Deep Learning": r"^Deep Learning - \d"}


def main(raw_path):
    raw = json.load(open(raw_path))
    projects = raw["projects_21"] + raw["projects_9"]
    sessions = {s["project"]["slug"]: s for s in raw["sessions_21"] + raw["sessions_9"]}
    by_slug = {p["slug"]: p for p in projects}
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    by_name = {}
    for p in projects:
        by_name.setdefault(norm(p["name"]), []).append(p["slug"])

    def slug(name):
        found = by_name.get(norm(name), [])
        if not found:
            sys.exit(f"holygraph: no project named {name!r} in the catalog")
        return next((s for s in found if s.startswith("42cursus-")), found[0])

    def rules(s, kind):
        return [" ".join(p["value"] for p in r["params"]) for r in sessions.get(s, {}).get("project_sessions_rules", [])
                if r["rule"]["kind"] == "inscription" and r["rule"]["internal_name"] == kind]

    def modules(box_slug, box_name):
        kids = [p["slug"] for p in projects if (p.get("parent") or {}).get("slug") == box_slug]
        kids += [s for s in sessions if box_slug in " ".join(rules(s, "ProjectsRegistered")).split() and s not in kids]
        if box_name in MODULE_NAMES:
            kids += [p["slug"] for p in projects if re.search(MODULE_NAMES[box_name], p["name"]) and p["slug"] not in kids]
        if box_name == "AI Rushes":
            kids += [slug(n) for n in AI_RUSHES]
        return sorted(set(kids), key=lambda s: by_slug[s]["name"].lower())

    roots, boxes = [], {}
    for r in ROOTS:
        if isinstance(r, dict):
            first = slug(r["box"][0])
            boxes[first] = [{"slug": slug(n), "modules": modules(slug(n), n)} for n in r["box"]]
            roots.append(first)
        else:
            roots.append(slug(r))
    edges = []
    for line in EDGES.strip().splitlines():
        chain = [slug(n.strip()) for n in line.split(">")]
        edges += [[a, b] for a, b in zip(chain, chain[1:])]
    # a project hung from a box hangs from the box's first piscine (the one drawn)
    first_of = {m["slug"]: first for first, ms in boxes.items() for m in ms}
    edges = [[first_of.get(a, a), b] for a, b in edges]

    used = set(roots) | {b for _, b in edges} | {m for ms in boxes.values() for b in ms for m in [b["slug"], *b["modules"]]}
    used |= {s for row in PISCINE for s in row}

    def walk(x):
        if isinstance(x, str):
            used.add(x)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        else:
            for v in x:
                walk(v)
    walk(CC)
    # the internships' and the open project's parts belong to them: listed under their project
    parts = {s: [p["slug"] for p in projects if (p.get("parent") or {}).get("slug") == s] for s in list(used)}
    parts = {s: v for s, v in parts.items() if v and s not in boxes}
    for v in parts.values():
        used |= set(v)

    def hours(s):
        t = (sessions.get(s) or {}).get("estimate_time") or next((ps.get("estimate_time") for ps in by_slug[s].get("project_sessions", []) if ps.get("estimate_time")), None)
        if not t:
            return None
        n, unit = t.split()[0], t.split()[1] if len(t.split()) > 1 else "hours"
        n = float(n)
        return round(n * 24 if unit.startswith("day") else n * 24 * 365 if unit.startswith("year") else n)

    def xp(s):  # the project's own XP, as the intra shows it (Startup Experience: 63,000, its Madrid session says 42,000)
        v = by_slug[s].get("difficulty")
        return v if v is not None else (sessions.get(s) or {}).get("difficulty")

    catalog = {}
    for s in sorted(used):
        if s not in by_slug:
            sys.exit(f"holygraph: {s} is not in the catalog")
        p = by_slug[s]
        e = {"name": p["name"].strip()}
        if xp(s):
            e["xp"] = xp(s)
        if hours(s):
            e["hours"] = hours(s)
        if p.get("exam"):
            e["exam"] = True
        catalog[s] = e
    out = {
        "_notes": "Built by tools/holygraph/build.py (make holygraph) from the API's catalog and the owner's structure (2026-11-25): "
                  "the C Piscine's rows, the Common Core's milestones per track (alt: one of them; chain: modules in order), "
                  "the Outer Core's roots clockwise from the top, its edges (parent, child) and its boxes (piscines of modules). "
                  "Edit the structure in build.py, not here.",
        "piscine": PISCINE, "common_core": CC,
        "outer": {"roots": roots, "edges": edges, "boxes": boxes, "parts": parts},
        "projects": catalog,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
