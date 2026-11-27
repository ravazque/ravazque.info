import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { Page, type PageKey, type Section } from "./page";
import { BUILT_IN, campusPiscinePage, campusProjectsPage, cohortsSection, holyKind, holyPage } from "./holygraph";

const quests = (...n: number[]) => n.map((k) => ({ name: `Common Core Rank 0${k}`, validated: "2025-01-01" }));
const pageOf = (projects: any[], extras: any = {}, params: Record<string, string> = {}, period = "student", key: PageKey = "holygraph") =>
  new Page(new Fmt("en"), { period, report: { extras: { cursus: [{ name: "42cursus" }], quests: [], ...extras }, projects }, all_projects: projects } as any, key, params);
const done = (slug: string, mark = 100, more: any = {}) => ({ slug, name: slug, status: "finished", validated: true, mark, ...more });
const nodeOf = (html: string, slug: string) => new RegExp(`class="hg-n[^"]*st-([a-z]+)" data-hg="${slug}"`).exec(html)?.[1];

test("the graph shown: the Piscine's in the Piscine period, else your track's; the switch picks another", () => {
  expect(holyKind(pageOf([]))).toBe("c");
  expect(holyKind(pageOf([], {}, {}, "piscine"))).toBe("piscine");
  expect(holyKind(pageOf([], { quests: [{ name: "42Next", validated: "2025-01-01" }] }))).toBe("python");
  expect(holyKind(pageOf([], {}, { graph: "python" }))).toBe("python");
});

test("each project in its state: yours as the report says, an alternative left aside once you took another, modules in order", () => {
  const html = holyPage(pageOf([
    done("42cursus-libft", 115), done("42cursus-get_next_line"), { slug: "42cursus-ft_printf", status: "in_progress" },
    done("born2beroot"), done("pipex"), { slug: "42cursus-push_swap", status: "finished", validated: false, mark: 40 },
    done("cpp-module-00"),
  ], { quests: quests(0, 1, 2, 3) }), null)[0].html;
  expect(nodeOf(html, "42cursus-libft")).toBe("bonus");
  expect(nodeOf(html, "42cursus-ft_printf")).toBe("doing");
  expect(nodeOf(html, "42cursus-push_swap")).toBe("failed");
  expect(nodeOf(html, "minitalk")).toBe("other"); // pipex was the one taken
  expect(nodeOf(html, "so_long")).toBe("open"); // milestone 2 reached, none of the three taken yet
  expect(nodeOf(html, "cpp-module-01")).toBe("open"); // the module after the one done
  expect(nodeOf(html, "cpp-module-02")).toBe("locked"); // not before 01
  expect(nodeOf(html, "ft_transcendence")).toBe("locked"); // milestone 6 not reached
  expect(nodeOf(html, "42cursus-scop")).toBe("locked"); // the Outer Core waits for the Common Core
});

test("a project's panel tells its mark, attempts with their flags, XP and how the campus did on it", () => {
  const p = done("42cursus-minishell", 101, { marked: "2025-11-14 23:52", days_to_validate: 136.9, xp_earned: 2842, attempts: [{ n: 1, start: "2025-07-01 03:58", closed: "2025-11-13 23:36",
    mark: 101, validated: true, evaluations: [{ flag: "Outstanding project" }, { flag: "Outstanding project" }, { flag: "Ok" }] }] });
  const stats = { reasons: ["norme", "crash"], projects: [{ slug: "42cursus-minishell", registered: 848, passed: 783, first_try: 471, median_days: 82.2, reasons: { norme: 6, crash: 116 } }] };
  const html = holyPage(pageOf([p], { quests: quests(0, 1, 2) }), stats)[0].html;
  const panel = /<template data-hg-panel="42cursus-minishell">(.*?)<\/template>/s.exec(html)![1];
  for (const s of ["Validated with bonus", "101", "14 Nov 2025", "136.9 days", "2,814 (2,842 earned)", "1 Jul 2025 → 13 Nov 2025", "Outstanding project ×2 · Ok",
    "848 signed up · 783 passed", "60% on the first try", "half took 82.2 days or less", "Crash 116 · Norm 6"]) expect(panel).toContain(s);
});

test("the other track's graph is only to look at: nothing of yours on it, nor in its panels", () => {
  const html = holyPage(pageOf([done("42cursus-libft", 115, { attempts: [{ n: 1, mark: 115, validated: true }] })], { quests: quests(0) }, { graph: "python" }), null)[0].html;
  expect(nodeOf(html, "42cursus-libft")).toBe("view");
  expect(html).toContain("Not your path: only to look at");
  expect(/<template data-hg-panel="42cursus-libft">(.*?)<\/template>/s.exec(html)![1]).not.toContain("Attempts");
});

test("a failed attempt names the negative flag that failed it, or says it had none; a project not open says why", () => {
  const p = { slug: "42cursus-push_swap", status: "finished", validated: false, mark: 0, attempts: [
    { n: 1, start: "2025-01-01 10:00", mark: 0, validated: false, evaluations: [{ flag: "Norme", negative: true }, { flag: "Ok", negative: false }] },
    { n: 2, start: "2025-02-01 10:00", mark: 30, validated: false, evaluations: [{ flag: "Ok", negative: false }] },
  ] };
  const html = holyPage(pageOf([done("42cursus-libft"), p, done("pipex")], { quests: quests(0, 1) }), null)[0].html;
  const panel = (s: string) => new RegExp(`<template data-hg-panel="${s}">(.*?)</template>`, "s").exec(html)![1];
  expect(panel("42cursus-push_swap")).toContain("Red flag: Norme");
  expect(panel("42cursus-push_swap")).toContain("No red flag: it failed on its marks");
  expect(panel("minitalk")).toContain("Not needed: you took pipex");
  expect(panel("42cursus-philosophers")).toContain("Opens when you reach Stage 3.");
  expect(panel("42cursus-scop")).toContain("Opens once the Common Core is done.");
});

test("the Outer Core lists every project of the holy graph, tried or not, branch by branch, with a search and a branch to pick", () => {
  const stats = { generated_at: "2026-11-25T17:00:00Z", requests: 1, seconds: 60, people: { total: 10, by_state: {} }, funnel: { c: { people: 10, reached: [10, 0, 0, 0, 0, 0, 0] }, python: { people: 0, reached: [0, 0, 0, 0, 0, 0, 0] } },
    blackhole: { by_milestone: {}, lost_on: [] }, cohorts: [], reasons: [], projects: [{ slug: "42cursus-scop", name: "scop", milestone: "outer-core", registered: 40, passed: 30, first_try: 20, failed: 5, lost_blackhole: 0 }] };
  const outer = (params: Record<string, string> = {}) => campusProjectsPage(pageOf([], { quests: quests(0) }, params), stats).find((s) => s.id === "outer-core")!.html;
  const all = outer();
  expect(all).toContain("<b>scop</b>");
  expect(all).toContain("<b>kfs-x</b>"); // never tried at 42 Madrid: still there, its donut empty
  expect(all).toContain("no one at 42 Madrid has tried it yet");
  expect(all).toMatch(/<h3>scop<span class="count">/); // a branch of its own, named after its root
  const found = outer({ oq: "kfs" });
  expect(found).toContain("<b>kfs-7</b>");
  expect(found).not.toContain("<b>scop</b>");
  const branch = outer({ branch: "42cursus-scop" });
  expect(branch).toContain("<b>humangl</b>");
  expect(branch).not.toContain("<b>kfs-x</b>");
});

const statsWith = (projects: any[]) => ({ generated_at: "2026-11-25T17:00:00Z", requests: 1, seconds: 60, people: { total: 10, by_state: {} },
  funnel: { c: { people: 10, reached: [10, 0, 0, 0, 0, 0, 0] }, python: { people: 0, reached: [0, 0, 0, 0, 0, 0, 0] } }, blackhole: { by_milestone: {}, lost_on: [] }, cohorts: [], reasons: [], projects });
const outerOf = (projects: any[], params: Record<string, string> = {}, graph: any = null) =>
  campusProjectsPage(pageOf([], { quests: quests(0) }, params), statsWith(projects), graph).find((s) => s.id === "outer-core")!.html;
const donutOf = (html: string, name: string) => html.match(new RegExp(`<li class="donut[^"]*"[^>]*>(?:(?!</li>)[\\s\\S])*<b>${name}</b>`))![0];

test("a project with 1 to 4 people signed up shows its ring and \"< 5\"; one nobody tried, only the ring's outline", () => {
  const html = outerOf([{ slug: "b", name: "B", milestone: "outer-core", registered: null, passed: 0 }, { slug: "cc1", name: "cc1", milestone: "outer-core", registered: 0 }]);
  const b = donutOf(html, "B"), cc1 = donutOf(html, "cc1");
  expect(b).toContain('class="dn-few"');
  expect(b).toContain(">&lt; 5</text>");
  expect(cc1).toContain("donut empty");
  expect(cc1).toContain('class="dn-edge"');
  expect(cc1).not.toContain("dn-few");
});

test("a donut's tip in sections: the shares first (passed, failed, out of days, on it, unfinished), a rule, the failed attempts by flag, a rule, how they passed", () => {
  const html = outerOf([{ slug: "libasm", name: "libasm", milestone: "outer-core", registered: 159, passed: 120, first_try: 99, failed: 30, lost_blackhole: 5, in_progress: 4,
    abandoned: null, closed_unmarked: 0, attempts: 182, failed_attempts: 41, bonus: 34, max: 15, outstanding: 210, outstanding_3: 40, median_days: 23.2, median_mark: 100,
    reasons: { cheat: 0, norme: 7, leaks: null, eval_marks: 12, auto_grading: 5, no_evaluation: 0, exam: 0 } }]);
  const tip = donutOf(html, "libasm").match(/data-tip="([^"]*)"/)![1].replace(/&lt;/g, "<");
  const lines = tip.split("\n");
  expect(lines.slice(0, 3)).toEqual(["libasm", "159 signed up, 182 attempts", "---"]);
  expect(lines.slice(3, 8)).toEqual(["75% passed · 120", "19% failed, never passed · 30", "3% ran out of days (black hole) · 5", "3% still on it · 4", "Left unfinished (alumni, frozen or gone): < 5"]);
  const rules = lines.map((l, i) => (l === "---" ? i : -1)).filter((i) => i > 0);
  expect(rules.length).toBe(3);
  expect(lines[rules[1] + 1]).toBe("# Failed attempts: 41");
  expect(lines.slice(rules[1] + 2, rules[2])).toEqual(["· flag Norm: 7", "· flag Leaks: < 5", "· no flag, Evaluation marks: 12", "· no flag, Automatic tests (best guess): 5"]);
  expect(lines[rules[2] + 1]).toBe("# How they passed");
  for (const s of ["first try: 99", "3 Outstandings: 40", "Outstandings given: 210"]) expect(lines.slice(rules[2]).some((l) => l.includes(s))).toBe(true);
  expect(tip).not.toContain("Cheat"); // nothing to say: no line
  expect(tip).not.toContain("without a mark"); // 0: no line
});

test("a donut's ring: passed with 3 Outstandings in deep green, the other passes in green, failed, out of days, then unfinished", () => {
  const html = outerOf([{ slug: "libasm", name: "libasm", milestone: "outer-core", registered: 100, passed: 60, outstanding_3: 10, failed: 20, lost_blackhole: 5, abandoned: 6, closed_unmarked: 5 }]);
  const ring = donutOf(html, "libasm");
  expect([...ring.matchAll(/<path class="dn-([a-z]+)"/g)].map((m) => m[1])).toEqual(["track", "out", "pass", "failed", "lost", "gone"]);
});

test("the Outer Core's groups: the owner's from the editor, the rest under one heading; without them, branches of two or more and the single ones together", () => {
  const plain = outerOf([]);
  expect(plain).toMatch(/<h3>Single projects<span class="count">/);
  expect(plain).not.toMatch(/<h3>dr-quine<span/); // a branch of one goes with the single ones
  // cc1, which libasm's B and ft_yacc both lead to, shows in both branches
  expect((plain.match(/<b>cc1<\/b>/g) || []).length).toBe(2);
  const g = JSON.parse(JSON.stringify(BUILT_IN));
  g.outer.groups = [{ name: "Assembly", slugs: ["libasm", "b"] }];
  const own = outerOf([], {}, g);
  expect(own).toMatch(/<h3>Assembly<span class="count">/);
  expect(own).toMatch(/<h3>Every other project<span class="count">/);
  expect(outerOf([], { branch: "g0" }, g)).not.toContain("<b>scop</b>");
});

test("enough signed up but every outcome under 5: the grey ring of hidden figures, not the outline of nobody", () => {
  const html = outerOf([{ slug: "war", name: "war", milestone: "outer-core", registered: 7, passed: null, failed: null, lost_blackhole: null, first_try: null }]);
  const war = donutOf(html, "war");
  expect(war).toContain('class="dn-few"');
  expect(war).not.toContain("donut empty");
  expect(war).toContain("7 signed up");
});

const sectionOf = (stats: any, id: string, kind = "c") => {
  const pg = pageOf([], { quests: quests(0) }, kind === "c" ? {} : { graph: kind });
  const all = [...(kind === "piscine" ? campusPiscinePage(pg, stats) : campusProjectsPage(pg, stats)), cohortsSection(pg, stats)].filter(Boolean) as Section[];
  return all.find((s) => s.id === id)!.html;
};
const cells = (html: string, row: string) => {
  const li = new RegExp(`<li class="${row}">([\\s\\S]*?)</li>`).exec(html)![1];
  const keys = (cell: string) => [...(new RegExp(`<span class="${cell}">([\\s\\S]*?)</span>`).exec(li)?.[1] || "").matchAll(/class="sb-([a-z-]+)"/g)].map((m) => m[1]);
  return { li, left: keys("spl-l"), right: keys("spl-r"), lead: /<span class="spl-lead">([^<]*)</.exec(li)![1] };
};

test("why attempts fail: the negative flags left of one axis in reds, the rest right of it, a total row with the share flagged, a key with totals", () => {
  const html = sectionOf(statsWith([{ slug: "42cursus-libft", name: "Libft", milestone: "milestone-0", registered: 100, passed: 60,
    reasons: { crash: 20, norme: 10, eval_marks: 50, auto_grading: 20 } }]), "why");
  const sum = cells(html, "spl-sum");
  expect(sum.li).toContain("In total");
  expect(sum.lead).toBe("30%");
  expect(sum.left).toEqual(["tech", "norme"]); // the worst furthest from the axis
  expect(sum.right).toEqual(["marks", "auto"]);
  expect(html).toMatch(/<p class="spl-side">Red flag<\/p>/);
  expect(html).toMatch(/<i class="sb-norme"><\/i><span>Norm<\/span><b>10<\/b><em>10%<\/em>/);
});

test("by start year: still here or finished left of the axis, from Alumni to frozen, the black hole right of it, every year at one scale", () => {
  const stats = { ...statsWith([]), cohorts: [{ cohort: "2024-09", active: 30, transcender: 10, alumni: 0, inactive: 5, blackholed: 55 }, { cohort: "2023-09", alumni: 20, blackholed: 80 }] };
  const html = sectionOf(stats, "cohorts");
  const sum = cells(html, "spl-sum");
  expect(sum.lead).toBe("33%"); // 65 of 200
  expect(sum.left).toEqual(["st-alumni", "st-transcender", "st-active", "st-inactive"]);
  expect(sum.right).toEqual(["st-blackholed"]);
  expect(html).toMatch(/<li><span class="sb-label">2024<\/span><span class="spl-lead">45%<\/span>/);
  expect(html).toMatch(/--l:\d+(\.\d)?%/);
});

test("a project 1 to 4 people signed up for names them in its donut's tip and its panel; who left one unfinished has a line", () => {
  const html = outerOf([{ slug: "b", name: "B", milestone: "outer-core", registered: null, logins: ["peer01", "peer02"] },
    { slug: "libasm", name: "libasm", milestone: "outer-core", registered: 40, passed: 20, first_try: 10, failed: 5, in_progress: 8, abandoned: 7, closed_unmarked: 6 }]);
  expect(donutOf(html, "B")).toMatch(/data-tip="B\n[^"]*\nWho did it: peer01, peer02"/);
  expect(donutOf(html, "libasm").match(/data-tip="([^"]*)"/)![1]).toContain("18% left unfinished (alumni, frozen or gone) · 7");
  expect(donutOf(html, "libasm").match(/data-tip="([^"]*)"/)![1]).toContain("15% closed without a mark · 6");
  const graph = holyPage(pageOf([], { quests: quests(0) }), statsWith([{ slug: "b", name: "B", milestone: "outer-core", registered: null, logins: ["peer01", "peer02"] }]))[0].html;
  expect(/<template data-hg-panel="b">(.*?)<\/template>/s.exec(graph)![1]).toContain("Who did it: peer01, peer02");
});

test("42 Madrid · 42cursus switches between the two tracks only, the graph itself not on it; 42 Madrid · Piscine has its title alone", () => {
  const pg = pageOf([done("42cursus-libft", 115)], { quests: quests(0) }, {}, "student", "cc");
  const html = campusProjectsPage(pg, statsWith([])).map((s) => s.html).join("");
  const seg = /<section id="madrid"><div class="panel-head"><h2>42 Madrid<\/h2>(<div class="seg".*?<\/div>)/s.exec(html)![1];
  expect([...seg.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))).toEqual(["/app/madrid/42cursus?period=student&graph=c#madrid", "/app/madrid/42cursus?period=student&graph=python#madrid"]);
  expect(html).not.toContain('class="hg-stage"');
  expect(html).not.toContain('id="cohorts"'); // on the summary now
  const piscine = campusPiscinePage(pageOf([], {}, {}, "student", "piscine"), { ...statsWith([]), piscine: { people: { total: 10, admitted: 5 }, piscines: [], projects: [] } });
  expect(piscine[0].html).toMatch(/^<section id="madrid"><h2>42 Madrid<\/h2>/);
});

test("the Holy graph page is the graph alone: no section title, the switch and key over it", () => {
  const [graph, ...rest] = holyPage(pageOf([done("42cursus-libft", 115)], { quests: quests(0) }), statsWith([]));
  expect(rest).toEqual([]);
  expect(graph.html).toMatch(/^<section id="graph" class="hg-full" aria-label="[^"]+"><div class="hg-bar"><div class="seg"/);
  expect(graph.html).not.toContain("<h2>");
});


test("a project 1 to 4 people did (policy v8): its slices and its whole tip with who did it, \"< 5\" in the middle", () => {
  const html = outerOf([{ slug: "b", name: "B", milestone: "outer-core", registered: 2, passed: 1, failed: 1, first_try: 1, attempts: 3, failed_attempts: 2,
    logins: ["peer01", "peer02"], reasons: { norme: 2 } }]);
  const b = donutOf(html, "B");
  expect(b).toContain(">&lt; 5</text>");
  expect([...b.matchAll(/<path class="dn-([a-z]+)"/g)].map((m) => m[1])).toEqual(["track", "pass", "failed"]);
  const lines = b.match(/data-tip="([^"]*)"/)![1].split("\n");
  expect(lines.slice(0, 4)).toEqual(["B", "2 signed up, 3 attempts", "Who did it: peer01, peer02", "---"]);
  for (const s of ["50% passed · 1", "50% failed, never passed · 1", "· flag Norm: 2", "Passed on the first try: 1"]) expect(lines).toContain(s);
});

test("friendlier forms: admission as 100 squares with a finding, why attempts fail opens with its most common reason, details of the count in a tip", () => {
  const stats = { ...statsWith([]), piscine: { people: { total: 200, admitted: 50 }, piscines: [], projects: [] } };
  const adm = sectionOf(stats, "madrid", "piscine");
  expect(adm.match(/class="wf-sq"/g)).toHaveLength(100);
  expect(adm).toMatch(/<p class="finding"[^>]*><b>25%<\/b> of the 200 people/);
  const why = sectionOf({ ...statsWith([{ slug: "42cursus-libft", name: "Libft", milestone: "rank-00", track: "c", registered: 50, attempts: 60, failed_attempts: 10, reasons: { norme: 8, cheat: 2 } }]) }, "why");
  expect(why).toContain('<p class="finding">The [[most common reason]] an attempt fails: Norm, <b>80%</b> of the 10 failed attempts.');
  const madrid = sectionOf(statsWith([]), "madrid");
  expect(madrid).toContain('<p class="finding">');
  expect(madrid).toContain("The count used 1 requests to 42"); // the cost lives in the tip, not the visible note
  expect(madrid).not.toMatch(/<p class="note">[^<]*requests/);
});
