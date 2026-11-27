// Holy graph: the C Piscine, or the Common Core of a track with the Outer Core around it, each project in the state your
// report gives it and a panel with its attempts, flags, XP and how 42 Madrid did on it (the weekly campus count); then the
// campus figures of that graph.
import data from "@data/holygraph.json";
import { cursusGraph, piscineGraph, type HolyData, type HolyState, type Item } from "../lib/holy";
import { esc } from "../lib/h";
import { donut, ringFunnel, splitBars, type Bar, type Ring, type Side } from "../lib/campusviz";
import { Page, type Section, filters, info, myRank, myTrack, search, section, select } from "./page";

/** The built-in holy graph (tools/holygraph/build.py); the owner's from the editor replaces it while a page draws. */
export const BUILT_IN = data as unknown as HolyData;
let G = BUILT_IN;
export const KINDS = ["piscine", "c", "python"] as const;
export type Kind = (typeof KINDS)[number];
const RANKS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06"];
const base = (s: string) => s.replace(/^42cursus-/, "");
const ok = (s: HolyState) => s === "done" || s === "bonus";

/** Every slug an item holds. */
const slugsOf = (it: Item): string[] => (typeof it === "string" ? [it] : "chain" in it ? it.chain : it.alt.flatMap(slugsOf));

export function holyKind(pg: Page): Kind {
  return pg.q("graph", pg.period === "piscine" ? "piscine" : myTrack(pg.D.extras) === "python" ? "python" : "c", KINDS) as Kind;
}

/** The state of every project of the graph, from your report: yours when you have it, else what its prerequisites allow. */
function states(pg: Page, kind: Kind) {
  const f_or = ` ${pg.f.t("holy.or")} `;
  const mine = new Map<string, any>();
  for (const p of pg.allProjects) if (p.slug) { mine.set(p.slug, p); if (!mine.has(base(p.slug))) mine.set(base(p.slug), p); }
  const project = (s: string) => mine.get(s) || mine.get(base(s));
  const rank = myRank(pg.D.extras), reached = rank === "outer-core" || rank === "alumni" ? 7 : rank ? RANKS.indexOf(rank) : 0;
  const own = (s: string): HolyState | null => {
    const p = project(s);
    if (!p) return null;
    if (p.validated === true) return (p.mark ?? 0) > 100 ? "bonus" : "done";
    return p.status !== "finished" ? "doing" : "failed";
  };
  const st = new Map<string, HolyState>(), why = new Map<string, [string, Record<string, string | number>]>();
  const name = (s: string) => G.projects[s]?.name || s;
  // a project not in your report: available or not yet, and why (the panel says it: the intra's "Forbidden" in words)
  const set = (s: string, open: boolean, because?: [string, Record<string, string | number>]) => {
    const o = own(s);
    st.set(s, o ?? (open ? "open" : "locked"));
    if (!o && !open && because) why.set(s, because);
  };
  if (kind === "piscine") G.piscine.flat().forEach((s) => set(s, false));
  else {
    G.common_core[kind].forEach((items, k) => items.forEach((it) => {
      const walk = (x: Item, open: boolean) => {
        if (typeof x === "string") set(x, open, ["holy.why_ms", { n: k }]);
        else if ("chain" in x) x.chain.forEach((s, i) => set(s, open && (i === 0 || ok(st.get(x.chain[i - 1])!)),
          !open ? ["holy.why_ms", { n: k }] : ["holy.why_after", { p: name(x.chain[i - 1]) }]));
        else {
          x.alt.forEach((m) => walk(m, open));
          const taken = x.alt.find((m) => slugsOf(m).some((s) => ok(st.get(s)!) || st.get(s) === "doing"));
          if (taken) x.alt.filter((m) => m !== taken).flatMap(slugsOf).forEach((s) => {
            if (st.get(s) === "open" || st.get(s) === "locked") { st.set(s, "other"); why.set(s, ["holy.why_other", { p: slugsOf(taken).map(name).join(", ") }]); }
          });
        }
      };
      walk(it, k <= reached);
    }));
    const parents = new Map<string, string[]>();
    for (const [a, b] of G.outer.edges) parents.set(b, [...(parents.get(b) || []), a]);
    const cc = reached >= 7, seen = new Set<string>();
    const visit = (s: string) => {
      if (seen.has(s)) return;
      seen.add(s);
      (parents.get(s) || []).forEach(visit);
      const box = G.outer.boxes[s];
      if (box) {
        for (const b of box) {
          const ms = b.modules.map((m) => own(m)), done = ms.filter((x) => x && ok(x)).length;
          st.set(b.slug, done && done === ms.length ? "done" : own(b.slug) || ms.some(Boolean) ? (done === ms.length ? "done" : "doing") : cc ? "open" : "locked");
        }
        return;
      }
      const ps = parents.get(s) || [];
      set(s, ps.length ? ps.some((p) => ok(st.get(p) || "locked")) : cc, ps.length ? ["holy.why_after", { p: ps.map(name).join(f_or) }] : ["holy.why_cc", {}]);
    };
    G.outer.roots.forEach(visit);
    G.outer.edges.forEach(([, b]) => visit(b));
  }
  return { st, project, reached, why };
}

/** The campus count's row of a project (by its slug, or the same project under its other slug). */
function campusRow(stats: any, kind: Kind) {
  const rows = new Map<string, any>();
  for (const p of (kind === "piscine" ? stats?.piscine?.projects : stats?.projects) || []) {
    const had = rows.get(base(p.slug));
    rows.set(p.slug, p);
    if (!had || (p.registered ?? 0) > (had.registered ?? 0)) rows.set(base(p.slug), p);
  }
  return (s: string) => rows.get(s) || rows.get(base(s));
}

function panel(pg: Page, s: string, state: HolyState, p: any, row: any, kind: Kind, reasons: string[], because?: [string, Record<string, string | number>]): string {
  const f = pg.f, info = G.projects[s] || { name: s }, out: [string, string][] = [];
  const stText = f.t(kind === "piscine" && state === "locked" ? "holy.st.missed" : `holy.st.${state}`);
  const reason = because ? `<p class="hg-p-why">${esc(f.t(because[0], because[1]))}</p>` : "";
  if (p?.mark != null) out.push([f.t("holy.p.mark"), esc(String(p.mark))]);
  if (p?.validated === true && p.marked) out.push([f.t("holy.p.validated"), esc(f.day(p.marked))]);
  if (p?.days_to_validate != null) out.push([f.t("holy.p.took"), esc(f.t("holy.p.days", { n: f.num(p.days_to_validate, 1) }))]);
  if (info.xp) out.push([f.t("holy.p.xp"), esc(p?.xp_earned ? f.t("holy.p.xp_earned", { xp: f.num(info.xp), earned: f.num(p.xp_earned) }) : f.num(info.xp))]);
  if (info.hours) out.push([f.t("holy.p.hours"), esc(info.hours >= 72 ? f.t("holy.p.days", { n: f.num(Math.round(info.hours / 24)) }) : f.t("holy.p.h", { n: f.num(info.hours) }))]);
  const parents = G.outer.edges.filter(([, b]) => b === s).map(([a]) => G.projects[a]?.name || a);
  if (parents.length) out.push([f.t("holy.p.requires"), esc(parents.join(" · "))]);
  const box = Object.values(G.outer.boxes).flat().find((b) => b.slug === s);
  const mods = box?.modules || G.outer.parts[s] || [];
  const attempts = (p?.attempts || []).map((a: any) => {
    const flags = new Map<string, number>();
    for (const e of a.evaluations || []) if (e.flag) flags.set(e.flag, (flags.get(e.flag) || 0) + 1);
    const fl = [...flags].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(" · ");
    const when = a.start ? `${f.day(a.start)}${a.closed ? ` → ${f.day(a.closed)}` : ""}` : "";
    const mark = a.mark != null ? `${a.mark}${a.validated === true ? " ✓" : a.validated === false ? " ✗" : ""}` : f.t("holy.st.doing");
    // a failed attempt says what failed it: the negative flag an evaluator gave, or none (marks, the automatic grading)
    const neg = [...new Set((a.evaluations || []).filter((e: any) => e.negative && e.flag).map((e: any) => e.flag))] as string[];
    const failedBy = a.validated === false ? `<span class="${neg.length ? "neg" : "sub"}">${esc(neg.length ? f.t("holy.p.neg_flag", { flag: neg.join(", ") }) : f.t((a.evaluations || []).length ? "holy.p.no_neg" : "holy.p.no_eval"))}</span>` : "";
    return `<li><b>#${esc(a.n)}</b> ${esc(when)} · ${esc(mark)}${failedBy}${fl ? `<span class="sub">${esc(fl)}</span>` : ""}</li>`;
  }).join("");
  let campus = "";
  if (row) {
    const first = row.first_try != null && row.passed ? ` (${Math.round((row.first_try / row.passed) * 100)}% ${f.t("holy.p.first")})` : "";
    const n = (v: number | null | undefined) => (v === null ? f.t("holy.under5") : v === undefined ? "–" : f.num(v));
    const top = reasons.filter((k) => (row.reasons?.[k] || 0) > 0).sort((a, b) => row.reasons[b] - row.reasons[a]).slice(0, 3)
      .map((k) => `${f.t(`holy.reason.${k}`)} ${f.num(row.reasons[k])}`).join(" · ");
    campus = `<p class="hg-p-campus"><b>${esc(f.t("holy.campus"))}</b> ${esc(f.t("holy.p.campus_line", { reg: n(row.registered), passed: n(row.passed) }))}${esc(first)}`
      + `${row.median_days != null ? ` · ${esc(f.t("holy.p.median", { n: f.num(row.median_days, Number.isInteger(row.median_days) ? 0 : 1) }))}` : ""}`
      + `${row.median_mark != null && kind === "piscine" ? ` · ${esc(f.t("holy.p.median_mark", { n: f.num(row.median_mark) }))}` : ""}`
      + `${row.passed_admitted != null && row.passed ? ` · ${esc(f.t("holy.p.admitted_of_passed", { n: Math.round((row.passed_admitted / row.passed) * 100) }))}` : ""}${top ? `<span class="sub">${esc(f.t("holy.p.failed_mostly"))} ${esc(top)}</span>` : ""}${row.logins?.length ? `<span class="sub">${esc(f.t("holy.t.who", { who: row.logins.join(", ") }))}</span>` : ""}</p>`;
  }
  return `<template data-hg-panel="${esc(s)}"><p class="hg-p-head"><b>${esc(info.name)}</b><span class="hg-p-st st-${state}">${esc(stText)}</span></p>` + reason
    + (out.length ? `<dl class="hg-p-facts">${out.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>` : "")
    + (attempts ? `<p class="hg-p-sub">${esc(f.t("holy.p.attempts"))}</p><ol class="hg-p-list">${attempts}</ol>` : "")
    + (mods.length ? `<p class="hg-p-sub">${esc(f.t(box ? "holy.p.modules" : "holy.p.parts"))}</p><ul class="hg-p-list">${mods.map((m) => `<li>${esc(G.projects[m]?.name || m)}</li>`).join("")}</ul>` : "")
    + campus + "</template>";
}

/** The graph's section: the switch between the three graphs, the key, the stage and every node's panel. */
function graphSection(pg: Page, kind: Kind, stats: any): Section {
  const f = pg.f, { st, project, reached, why } = states(pg, kind), row = campusRow(stats, kind), reasons: string[] = stats?.reasons || [];
  // the other track's graph is only to look at: nothing of yours on it (owner, 2026-11-25)
  const viewOnly = kind !== "piscine" && kind !== (myTrack(pg.D.extras) || "c");
  if (viewOnly) for (const k of st.keys()) st.set(k, "view");
  const name = (s: string) => G.projects[s]?.name || s;
  const look = {
    state: (s: string) => st.get(s) || "locked",
    name,
    label: (s: string) => `${name(s)}: ${f.t(kind === "piscine" && (st.get(s) || "locked") === "locked" ? "holy.st.missed" : `holy.st.${st.get(s) || "locked"}`)}`,
    milestone: (k: number) => reached >= k + 1 || reached >= 7,
  };
  const title = f.t(`holy.kind_${kind}`);
  const svg = kind === "piscine" ? piscineGraph(G, look, title) : cursusGraph(G, kind, look, title);
  const panels = [...st.keys()].map((s) => panel(pg, s, st.get(s)!, viewOnly ? undefined : project(s), row(s), kind, reasons, viewOnly ? undefined : why.get(s))).join("");
  const keyStates: HolyState[] = viewOnly ? [] : kind === "piscine" ? ["done", "bonus", "failed", "locked"] : ["done", "bonus", "doing", "failed", "open", "locked", "other"];
  // what everyone should know before reading it: the states, what the intra's "Forbidden" is, where it all comes from
  const key = `<ul class="hg-key">${keyStates.map((k) => `<li><i class="st-${k}"></i>${esc(f.t(kind === "piscine" && k === "locked" ? "holy.st.missed" : `holy.st.${k}`))}</li>`).join("")}`
    + (viewOnly ? `<li class="hg-view">${esc(f.t("holy.view_only"))}</li>` : "")
    + `<li>${info(f.t(kind === "piscine" ? "holy.know_piscine" : "holy.know"))}</li></ul>`;
  const zoom = `<div class="hg-zoom">${(["in", "out", "fit"] as const).map((z) => `<button type="button" class="btn secondary" data-hg-zoom="${z}" aria-label="${esc(f.t(`holy.zoom_${z}`))}">${z === "in" ? "+" : z === "out" ? "−" : esc(f.t("holy.zoom_fit"))}</button>`).join("")}</div>`;
  const head = pg.seg("graph", KINDS.map((k) => [k, f.t(`holy.kind_${k}`)]), kind, f.t("holy.kind_label"), "graph");
  // the whole window, no frame: the switch and the key over the top of it, the zoom at its corner (owner, 2026-11-26)
  return { id: "graph", nav: "", html: `<section id="graph" class="hg-full" aria-label="${esc(title)}"><div class="hg-bar">${head}${key}</div>`
    + `<div class="hg-stage" tabindex="-1">${zoom}${svg}</div><p class="note hg-hint">${esc(f.t("holy.hint"))}</p>${panels}</section>` };
}

/** The title of a campus page's first section, with the switch between the tracks it can show. */
const kindSwitch = (pg: Page, kind: Kind, title: string, kinds: readonly Kind[]) => kinds.length < 2 ? `<h2>${esc(title)}</h2>`
  : `<div class="panel-head"><h2>${esc(title)}</h2>${pg.seg("graph", kinds.map((k) => [k, pg.f.t(`holy.kind_${k}`)]), kind, pg.f.t("holy.kind_label"), "madrid")}</div>`;

// ---- the campus figures (the weekly count): rings, donuts and 100% bars instead of long tables

/** The reasons, grouped so a bar has a handful of colours (the panel and the tips keep every reason): the negative flags
 * first, the worst first, then the rest (FLAG_GROUPS of them are flags). */
const REASON_GROUPS: [string, string[]][] = [
  ["cheat", ["cheat", "forbidden_function"]], ["tech", ["crash", "leaks", "invalid_compilation", "incomplete_work", "empty_work"]], ["norme", ["norme"]],
  ["other", ["cant_explain", "other_flag"]], ["marks", ["eval_marks"]], ["exam", ["exam"]], ["auto", ["auto_grading"]], ["none", ["no_evaluation"]],
];
const FLAG_GROUPS = 4;

type Count = number | null | undefined;
type Row = { registered?: Count; passed?: Count; failed?: Count; lost_blackhole?: Count; first_try?: Count; median_days?: number | null; median_mark?: number | null; reasons?: Record<string, number | null>;
  in_progress?: Count; abandoned?: Count; closed_unmarked?: Count; attempts?: Count; failed_attempts?: Count; bonus?: Count; max?: Count; outstanding?: Count; outstanding_3?: Count;
  logins?: string[] }; // logins: only a project 1 to 4 people signed up for, with its exact figures (core/campus.go, policy v8)
/** The reasons an attempt fails that are a negative flag, and those that aren't (core/campus.go reasonOrder). */
const FLAGGED = ["cheat", "forbidden_function", "norme", "leaks", "crash", "invalid_compilation", "empty_work", "incomplete_work", "cant_explain", "other_flag"];
const UNFLAGGED = ["eval_marks", "auto_grading", "exam", "no_evaluation"];
const num = (v: number | null | undefined) => v ?? 0;

/** One project's (or a series') donut: first try, after retries, failed, ran out of days; the share that passed inside. */
function projectDonut(pg: Page, name: string, r: Row | undefined, under: string): string {
  const f = pg.f;
  // nobody at 42 Madrid has tried it: the ring's outline alone; 1 to 4 signed up: the ring, its figures hidden under 5
  if (!r || r.registered === 0) return donut([], "–", name, f.t("holy.dn_none"), `${name}\n${f.t("holy.dn_none")}`);
  if (r.registered === null) return donut([{ cls: "few", value: 1, label: "" }], f.t("holy.under5"), name, f.t("holy.dn_few"),
    `${name}\n${f.t("holy.t.few")}${r.logins?.length ? `\n${f.t("holy.t.who", { who: r.logins.join(", ") })}` : ""}`);
  const passed = num(r.passed), out = Math.min(num(r.outstanding_3), passed), reg = num(r.registered), gone = num(r.abandoned) + num(r.closed_unmarked);
  const share = reg ? Math.round((100 * passed) / reg) : 0, few = reg > 0 && reg < 5; // 1 to 4: every figure, "< 5" in the middle (policy v8)
  if (!passed && !num(r.failed) && !num(r.lost_blackhole) && !gone) return donut([{ cls: "few", value: 1, label: "" }], few || r.passed === null ? f.t("holy.under5") : "–", name, under, donutTip(pg, name, r)); // every outcome under 5
  // passed with 3 Outstandings in deep green, the other passes in green, then failed, out of days and left unfinished; still on it: the track
  return donut([{ cls: "out", value: out, label: "" }, { cls: "pass", value: passed - out, label: "" }, { cls: "failed", value: num(r.failed), label: "" },
    { cls: "lost", value: num(r.lost_blackhole), label: "" }, { cls: "gone", value: gone, label: "" }], few || r.passed === null ? f.t("holy.under5") : reg ? `${share}%` : "–", name, under, donutTip(pg, name, r)); // under 5: not a 0%
}

/** Everything the count knows of a project, worst to best (owner, 2026-11-25): out of days, failed attempts by flag and
 * without one, never passed, still on it, then passed, on the first try, with a bonus, with three Outstandings, how many
 * Outstandings. A figure under 5 says so; one the count doesn't have (an older count) leaves its line out. */
function donutTip(pg: Page, name: string, r: Row): string {
  const f = pg.f, n = (v: Count) => (v === null ? f.t("holy.under5") : f.num(v ?? 0));
  const has = (v: Count) => v !== undefined, some = (v: Count) => v === null || (v ?? 0) > 0;
  const reasons = (keys: string[], key: string) => keys.filter((k) => some(r.reasons?.[k])).map((k) => f.t(key, { why: f.t(`holy.reason.${k}`), n: n(r.reasons![k]) }));
  // where everyone who signed up stands, as shares first: "75% passed · 120"; a figure under 5 says so, with no share
  const share = (key: string, v: Count) => {
    const label = f.t(`holy.o.${key}`);
    return v === null || !r.registered ? `${label[0].toUpperCase()}${label.slice(1)}: ${n(v)}` : `${Math.round((100 * num(v)) / r.registered)}% ${label} · ${f.num(num(v))}`;
  };
  const failing = [...reasons(FLAGGED, "holy.t.flag"), ...reasons(UNFLAGGED, "holy.t.noflag")];
  const passing = [
    has(r.first_try) && f.t("holy.t.first", { n: n(r.first_try) }),
    some(r.bonus) && f.t("holy.t.bonus", { n: n(r.bonus), m: n(r.max) }),
    has(r.outstanding_3) && f.t("holy.t.out3", { n: n(r.outstanding_3) }),
    has(r.outstanding) && f.t("holy.t.out", { n: n(r.outstanding) }),
    r.median_days != null && f.t("holy.t.median", { days: f.num(r.median_days, Number.isInteger(r.median_days) ? 0 : 1), mark: r.median_mark != null ? f.num(r.median_mark) : "–" }),
  ].filter(Boolean) as string[];
  const lines = [
    has(r.attempts) ? f.t("holy.t.signed", { reg: n(r.registered), attempts: n(r.attempts) }) : f.t("holy.t.signed_only", { reg: n(r.registered) }),
    ...(r.logins?.length ? [f.t("holy.t.who", { who: r.logins.join(", ") })] : []), "---",
    share("passed", r.passed),
    ...([["failed", r.failed], ["lost", r.lost_blackhole], ["open", r.in_progress], ["gone", r.abandoned], ["unmarked", r.closed_unmarked]] as [string, Count][])
      .filter(([, v]) => some(v)).map(([k, v]) => share(k, v)),
    ...(some(r.failed_attempts) || failing.length ? ["---", `# ${f.t("holy.t.failed_attempts", { n: n(r.failed_attempts) })}`, ...failing] : []),
    ...(passing.length ? ["---", `# ${f.t("holy.t.how_passed")}`, ...passing] : []),
  ];
  return [name, ...lines].join("\n");
}

/** The figures of a series of modules added up (CPP 00–04: every attempt of the five). */
function seriesRow(rows: (Row | undefined)[]): Row | undefined {
  const rs = rows.filter(Boolean) as Row[];
  if (!rs.length) return undefined;
  const sum = (k: keyof Row) => rs.reduce((a, r) => a + num(r[k] as number), 0);
  return { registered: sum("registered"), passed: sum("passed"), failed: sum("failed"), lost_blackhole: sum("lost_blackhole"), first_try: sum("first_try"),
    in_progress: sum("in_progress"), abandoned: sum("abandoned"), closed_unmarked: sum("closed_unmarked") };
}

function reasonParts(rows: (Row | undefined)[]) {
  return REASON_GROUPS.map(([key, rs]) => ({ key, value: rows.reduce((a, r) => a + rs.reduce((b, k) => b + num(r?.reasons?.[k]), 0), 0) }));
}

/** Why attempts fail: a bar per group of projects and one for them all, the negative flags left of the axis. */
function whyBars(pg: Page, groups: [string, (Row | undefined)[]][]): string {
  const f = pg.f;
  const bar = (label: string, rows: (Row | undefined)[]): Bar => {
    const parts = reasonParts(rows);
    return { label, count: f.num(parts.reduce((a, p) => a + p.value, 0)), parts, tip: (k, v, sh) => `${label} · ${f.t(`holy.rg.${k}`)}: ${f.num(v)} (${Math.round(sh * 100)}%)` };
  };
  const side = (label: string, gs: [string, string[]][]): Side => ({ label: f.t(label), keys: gs.map(([key]) => ({ key, label: f.t(`holy.rg.${key}`) })) });
  return splitBars(bar(f.t("holy.sum"), groups.flatMap(([, rs]) => rs)), groups.map(([label, rs]) => bar(label, rs)), side("holy.side_flag", REASON_GROUPS.slice(0, FLAG_GROUPS)),
    side("holy.side_noflag", REASON_GROUPS.slice(FLAG_GROUPS)), { lead: f.t("holy.h_flag"), count: f.t("holy.h_failed") }, f.t("holy.why"), f.num);
}

/** The Outer Core's branches as the intra draws them, clockwise from the top: each root (a piscine box: its piscines) and
 * every project hanging from it; a project two branches lead to (cc1: ft_yacc and B) is in both. */
export function outerBranches(g: HolyData = G): { root: string; slugs: string[] }[] {
  const kids = new Map<string, string[]>();
  for (const [a, b] of g.outer.edges) kids.set(a, [...(kids.get(a) || []), b]);
  return g.outer.roots.map((root) => {
    const out: string[] = [], seen = new Set<string>();
    const walk = (x: string) => {
      if (seen.has(x)) return;
      seen.add(x);
      out.push(...(g.outer.boxes[x] ? g.outer.boxes[x].map((b) => b.slug) : [x]));
      (kids.get(x) || []).forEach(walk);
    };
    walk(root);
    return { root, slugs: out };
  });
}

/** The Outer Core's groups on the page: the owner's from the editor (outer.groups) and every other project under one
 * heading; without them, each branch of two or more projects and the single ones together. */
function outerGroups(pg: Page): { key: string; name: string; slugs: string[] }[] {
  const branches = outerBranches(), all = [...new Set(branches.flatMap((b) => b.slugs))];
  const own = (G.outer.groups || []).map((g, i) => ({ key: `g${i}`, name: g.name, slugs: g.slugs.filter((s) => G.projects[s]) }));
  if (own.length) {
    const grouped = new Set(own.flatMap((g) => g.slugs)), rest = all.filter((s) => !grouped.has(s));
    return [...own, ...(rest.length ? [{ key: "rest", name: pg.f.t("holy.o_rest"), slugs: rest }] : [])].filter((g) => g.slugs.length);
  }
  const single = branches.filter((b) => b.slugs.length < 2).flatMap((b) => b.slugs);
  return [...branches.filter((b) => b.slugs.length >= 2).map((b) => ({ key: b.root, name: G.projects[b.root]?.name || b.root, slugs: b.slugs })),
    ...(single.length ? [{ key: "single", name: pg.f.t("holy.o_single"), slugs: single }] : [])];
}

function campusSections(pg: Page, kind: "c" | "python", stats: any): Section[] {
  const f = pg.f, S = stats;
  if (!S?.people || !S.generated_at) return []; // no count yet, or one of another shape
  const n = (v: number | null | undefined) => (v === null ? f.t("holy.under5") : v === undefined ? "–" : f.num(v));
  const row = campusRow(S, kind), F = S.funnel[kind], people = num(F.people);
  const note = f.t("holy.campus_note", { date: f.stamp(Date.parse(S.generated_at)), requests: f.num(S.requests), minutes: f.num(Math.max(1, Math.round(S.seconds / 60))) });
  // where they got: a ring per milestone, filled to the share of the track that reached it, then the black hole on it
  const bhTotal = RANKS.map((m) => num(S.blackhole.by_milestone[m]));
  const rings: Ring[] = RANKS.map((m, i) => {
    const reached = people ? num(F.reached[i]) / people : 0, lost = num(S.funnel.c.people) + num(S.funnel.python.people) ? bhTotal[i] / (num(S.funnel.c.people) + num(S.funnel.python.people)) : 0;
    return { label: `${i}`, reached, lost, tip: f.t("holy.ring_tip", { m: f.t(`groups.${m}`), reached: n(F.reached[i]), share: Math.round(reached * 100), bh: n(S.blackhole.by_milestone[m]) }) };
  });
  const funnel = `<div class="hg-funnel">${ringFunnel(rings, f.num(people), f.t("holy.funnel"))}<div class="hg-funnel-text">`
    + `<p class="hg-lead">${esc(f.t("holy.funnel_lead", { people: n(F.people), track: f.t(`holy.track_${kind}`), m6: Math.round((100 * num(F.reached[6])) / Math.max(1, people)) }))}</p>`
    + `<ul class="sb-key"><li><i class="rf-reached"></i>${esc(f.t("holy.key_reached"))}</li><li><i class="rf-lost"></i>${esc(f.t("holy.key_bh"))}</li></ul>`
    + `<p class="note">${esc(f.t("holy.people_line", { total: n(S.people.total), active: n(S.people.by_state.active), bh: n(S.people.by_state.blackholed), tr: n(S.people.by_state.transcender), al: n(S.people.by_state.alumni) }))}</p>`
    + (S.people.excluded !== undefined && S.people.excluded !== 0 ? `<p class="note">${esc(f.t("holy.excluded", { n: n(S.people.excluded) }))}</p>` : "")
    + `<p class="note">${esc(note)}</p></div></div>`;
  // every project of the track's milestones as a donut; alternatives side by side; a series of modules as one
  const strips = G.common_core[kind].map((items, k) => {
    const donuts = items.map((it) => {
      if (typeof it === "string") return projectDonut(pg, G.projects[it]?.name || it, row(it), row(it)?.median_days != null ? f.t("holy.dn_days", { n: f.num(row(it)!.median_days!) }) : "");
      if ("chain" in it) {
        const names = it.chain.map((s) => G.projects[s]?.name || s);
        return projectDonut(pg, `${names[0]} – ${names[names.length - 1].split(" ").pop()}`, seriesRow(it.chain.map(row)), f.t("holy.dn_series", { n: it.chain.length }));
      }
      return `<li class="donut-alt" style="--n:${it.alt.length}"><ol>${it.alt.map((m) => typeof m === "string" ? projectDonut(pg, G.projects[m]?.name || m, row(m), f.t("holy.dn_or"))
        : ((ch: string[]) => projectDonut(pg, `${G.projects[ch[0]]?.name || ch[0]} – ${(G.projects[ch[ch.length - 1]]?.name || "").split(" ").slice(-2).join(" ")}`, seriesRow(ch.map(row)), f.t("holy.dn_series", { n: ch.length })))((m as { chain: string[] }).chain)).join("")}</ol></li>`;
    }).join("");
    const rs = items.flatMap(slugsOf).map(row).filter(Boolean) as Row[];
    const avg = rs.length ? Math.round((100 * rs.reduce((a, r) => a + num(r.passed), 0)) / Math.max(1, rs.reduce((a, r) => a + num(r.registered), 0))) : 0;
    return `<div class="hg-strip"><h3>${esc(f.t(`groups.${RANKS[k]}`))}<span class="count"><span class="sep"> · </span>${esc(f.t("holy.strip_avg", { n: avg }))}</span></h3><ol class="donuts">${donuts}</ol></div>`;
  }).join("");
  // the Outer Core's projects as the graph draws them (no internship part, no project 42 retired)
  const drawn = new Set([...G.outer.roots, ...G.outer.edges.map(([, x]) => x), ...Object.values(G.outer.boxes).flat().map((b) => b.slug)].map(base));
  const outer = (S.projects || []).filter((p: any) => p.milestone === "outer-core" && drawn.has(base(p.slug)) && num(p.registered) >= 5).sort((a: any, b: any) => num(b.registered) - num(a.registered));
  // the Outer Core: every project the holy graph draws, tried at 42 Madrid or not, branch by branch as on the intra, with a
  // search and a branch to pick (owner, 2026-11-25)
  const groups = outerGroups(pg), oq = pg.q("oq", "").trim().toLowerCase().slice(0, 60);
  const branch = pg.q("branch", "", ["", ...groups.map((b) => b.key)]);
  const pname = (s: string) => G.projects[s]?.name || s;
  const shown = groups.filter((b) => !branch || b.key === branch).map((b) => ({ ...b, slugs: b.slugs.filter((x) => !oq || pname(x).toLowerCase().includes(oq)) })).filter((b) => b.slugs.length);
  const every = [...new Set(groups.flatMap((b) => b.slugs))], tried = every.filter((x) => num(row(x)?.registered) > 0 || row(x)?.registered === null).length;
  const outerForm = filters("outer-core", search("oq", oq, f.t("holy.o_search"), f.t("holy.o_search_ph"))
    + select("branch", f.t("holy.o_branch"), [["", f.t("holy.o_all")], ...groups.map((b) => [b.key, b.name] as [string, string])], branch));
  const outerHtml = `<p class="note">${esc(f.t("holy.o_lead", { n: every.length, tried }))}</p>${outerForm}`
    + (shown.length ? shown.map((b) => `<div class="hg-strip"><h3>${esc(b.name)}<span class="count"><span class="sep"> · </span>${esc(f.plural(b.slugs.length, "holy.o_count"))}</span></h3>`
      + `<ol class="donuts">${b.slugs.map((x) => projectDonut(pg, pname(x), row(x), row(x)?.median_days != null ? f.t("holy.dn_days", { n: f.num(row(x)!.median_days!) }) : "")).join("")}</ol></div>`).join("")
      : `<p class="note">${esc(f.t("holy.o_none"))}</p>`);
  const donutKey = `<ul class="sb-key">${(["pass", "out", "failed", "lost", "gone"] as const).map((k) => `<li><i class="dn-${k}"></i>${esc(f.t(`holy.dn_${k}`))}</li>`).join("")}`
    + `<li><i class="dn-few"></i>${esc(f.t("holy.dn_few_key"))}</li><li><i class="dn-nobody"></i>${esc(f.t("holy.dn_nobody"))}</li></ul>`;
  // why attempts failed, per milestone and for the Outer Core
  const reasonBars = whyBars(pg, [...G.common_core[kind].map((items, k): [string, (Row | undefined)[]] => [f.t(`groups.${RANKS[k]}`), items.flatMap(slugsOf).map(row)]), [f.t("groups.outer-core"), outer]]);
  return [
    { id: "madrid", nav: f.t("holy.campus"), html: section("madrid", f.t("holy.campus"), funnel, { head: kindSwitch(pg, kind, f.t("holy.campus"), ["c", "python"]) }) },
    { id: "by-milestone", nav: f.t("holy.by_milestone"), html: section("by-milestone", f.t("holy.by_milestone"), donutKey + strips) },
    { id: "outer-core", nav: f.t("groups.outer-core"), html: section("outer-core", f.t("groups.outer-core"), donutKey + outerHtml) },
    { id: "why", nav: f.t("holy.why"), html: section("why", f.t("holy.why"), `<p class="note">${esc(f.t("holy.why_note"))}</p>${reasonBars}`) },
  ];
}

/** Where each start year of the 42cursus stands now (Campus' summary). */
export function cohortsSection(pg: Page, S: any): Section | null {
  const f = pg.f;
  if (!S?.cohorts?.length) return null;
  // where each start year stands now: still here or finished (Alumni furthest from the axis, frozen nearest), the black hole
  const STILL = ["alumni", "transcender", "active", "inactive"], years = new Map<string, Record<string, number>>(), allYears: Record<string, number> = {};
  for (const c of S.cohorts || []) {
    const y = String(c.cohort).slice(0, 4), acc = years.get(y) || {};
    for (const k of [...STILL, "blackholed"]) { acc[k] = (acc[k] || 0) + num(c[k]); allYears[k] = (allYears[k] || 0) + num(c[k]); }
    years.set(y, acc);
  }
  const yearBar = (label: string, acc: Record<string, number>): Bar => ({ label, count: f.num(Object.values(acc).reduce((a, v) => a + v, 0)),
    parts: [...STILL, "blackholed"].map((k) => ({ key: `st-${k}`, value: acc[k] || 0 })),
    tip: (k, v, sh) => `${label} · ${f.t(`holy.state.${k.slice(3)}`)}: ${f.num(v)} (${Math.round(sh * 100)}%)` });
  const yearBars = splitBars(yearBar(f.t("holy.sum"), allYears), [...years].sort((a, b) => b[0].localeCompare(a[0])).map(([y, acc]) => yearBar(y, acc)),
    { label: f.t("holy.side_still"), keys: STILL.map((k) => ({ key: `st-${k}`, label: f.t(`holy.state.${k}`) })) },
    { label: f.t("holy.state.blackholed"), keys: [{ key: "st-blackholed", label: f.t("holy.state.blackholed") }] },
    { lead: f.t("holy.h_still"), count: f.t("holy.h_people") }, f.t("holy.cohorts"), f.num);
  return { id: "cohorts", nav: f.t("holy.cohorts"), html: section("cohorts", f.t("holy.cohorts"), `<p class="note">${esc(f.t("holy.cohorts_note"))}</p>${yearBars}`) };
}

/** The Piscine's figures: everyone who did it in Madrid, admitted or not: who got in per Piscine, and every day, rush and
 * exam as a donut. */
function piscineSections(pg: Page, stats: any): Section[] {
  const f = pg.f, P = stats?.piscine;
  if (!P?.people) return [];
  const n = (v: number | null | undefined) => (v === null ? f.t("holy.under5") : v === undefined ? "–" : f.num(v));
  const row = campusRow(stats, "piscine");
  const share = num(P.people.total) ? Math.round((100 * num(P.people.admitted)) / num(P.people.total)) : 0;
  const summary = `<div class="hg-funnel">${ringFunnel([{ label: "", reached: share / 100, lost: 0, tip: f.t("holy.adm_tip", { adm: n(P.people.admitted), total: n(P.people.total), share }) }], `${share}%`, f.t("holy.admission"))}`
    + `<div class="hg-funnel-text"><p class="hg-lead">${esc(f.t("holy.piscine_lead", { total: n(P.people.total), adm: n(P.people.admitted), share }))}</p>`
    + (P.people.excluded !== undefined && P.people.excluded !== 0 ? `<p class="note">${esc(f.t("holy.excluded", { n: n(P.people.excluded) }))}</p>` : "")
    + (stats.generated_at ? `<p class="note">${esc(f.t("holy.piscine_note", { date: f.stamp(Date.parse(stats.generated_at)) }))}</p>` : "") + "</div></div>";
  const strip = (title: string, slugs: string[]) => `<div class="hg-strip"><h3>${esc(title)}</h3><ol class="donuts">${slugs.map((s) => projectDonut(pg, G.projects[s]?.name.replace(/^C Piscine /, "") || s, row(s),
    row(s)?.median_mark != null ? f.t("holy.dn_mark", { n: f.num(row(s)!.median_mark!) }) : "")).join("")}</ol></div>`;
  const days = G.piscine.slice(0, 2).flat().sort(), [rushes, exams] = [G.piscine[2], G.piscine[3]];
  const donutKey = `<ul class="sb-key">${(["pass", "failed", "gone"] as const).map((k) => `<li><i class="dn-${k}"></i>${esc(f.t(`holy.dn_${k}`))}</li>`).join("")}</ul>`;
  const admBar = (label: string, people: number | null, admitted: number): Bar => ({ label, count: n(people),
    parts: [{ key: "st-active", value: admitted }, { key: "st-piscine", value: num(people) - admitted }],
    tip: (k, v, sh) => `${label} · ${f.t(k === "st-active" ? "holy.admitted" : "holy.not_admitted")}: ${f.num(v)} (${Math.round(sh * 100)}%)` });
  const ps = (P.piscines || []).slice().reverse().filter((p: any) => num(p.people));
  const adm = splitBars(admBar(f.t("holy.sum"), ps.reduce((a: number, p: any) => a + num(p.people), 0), ps.reduce((a: number, p: any) => a + num(p.admitted), 0)),
    ps.map((p: any) => admBar(p.cohort, p.people, num(p.admitted))), { label: f.t("holy.admitted"), keys: [{ key: "st-active", label: f.t("holy.admitted") }] },
    { label: f.t("holy.not_admitted"), keys: [{ key: "st-piscine", label: f.t("holy.not_admitted") }] }, { lead: f.t("holy.admitted"), count: f.t("holy.h_people") }, f.t("holy.piscines"), f.num);
  return [
    { id: "madrid", nav: f.t("holy.campus"), html: section("madrid", f.t("holy.campus"), summary, { head: kindSwitch(pg, "piscine", f.t("holy.campus"), []) }) },
    { id: "by-milestone", nav: f.t("holy.by_project"), html: section("by-milestone", f.t("holy.by_project"), donutKey + strip(f.t("holy.pi_days"), days) + strip(f.t("holy.pi_rushes"), rushes) + strip(f.t("holy.pi_exams"), exams)) },
    { id: "why", nav: f.t("holy.why"), html: section("why", f.t("holy.why"), `<p class="note">${esc(f.t("holy.why_note"))}</p>` + whyBars(pg, [[f.t("holy.pi_days"), days.map(row)], [f.t("holy.pi_rushes"), rushes.map(row)], [f.t("holy.pi_exams"), exams.map(row)]])) },
    { id: "piscines", nav: f.t("holy.piscines"), html: section("piscines", f.t("holy.piscines"), adm) },
  ];
}

/** The Holy graph page: the graph alone over the whole window, yours marked (Profile's button leads here). */
export function holyPage(pg: Page, stats: any, drawn: HolyData | null = null): Section[] {
  G = drawn || BUILT_IN;
  return [graphSection(pg, holyKind(pg), stats)];
}

/** Campus · Projects: a Common Core track's figures (C or Python, yours first) and the Outer Core's. */
export function campusProjectsPage(pg: Page, stats: any, drawn: HolyData | null = null): Section[] {
  G = drawn || BUILT_IN;
  return campusSections(pg, holyKind(pg) === "python" ? "python" : "c", stats);
}

/** Campus · Piscine: everyone who did the C Piscine in Madrid. */
export function campusPiscinePage(pg: Page, stats: any, drawn: HolyData | null = null): Section[] {
  G = drawn || BUILT_IN;
  return piscineSections(pg, stats);
}
