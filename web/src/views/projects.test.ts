import { expect, test } from "vitest";
import { achievementSeries, activity, profile, widgetPicker, widgets } from "./profile";
import { Page } from "./page";
import { Fmt } from "../fmt";
import { portfolioCsv, projectFilters, projectView, projects, timelineLanes, tryChip } from "./projects";
import { parseCsv } from "../lib/table";

const a = (name: string, description: string, at: string) => ({ name, description, at, tier: "none" });

test("achievements of one series show their highest level first and keep the others", () => {
  const s = achievementSeries([
    a("Attendee", "Attended 1 event.", "2025-09-20"), a("Attendee", "Attended 21 events.", "2026-03-02"),
    a("Solo", "Did it once.", "2026-01-01"), a("Attendee", "Attended 3 events.", "2025-10-04"),
    a("Rich", "Collected 1.000 wallet points.", "2026-02-01"), a("Rich", "Collected 200 wallet points.", "2026-02-01"),
    a("Code Explorer", "Validated your first project.", "2024-10-01"), a("Code Explorer", "Validated 3 projects", "2024-11-01"),
  ]);
  expect(s.map((x) => [x.top.description, x.rest.map((r) => r.description)])).toEqual([
    ["Attended 21 events.", ["Attended 3 events.", "Attended 1 event."]],
    ["Collected 1.000 wallet points.", ["Collected 200 wallet points."]],
    ["Did it once.", []],
    ["Validated 3 projects", ["Validated your first project."]],
  ]);
});

test("an exam try with no mark is a grey chip, not a red one", () => {
  const f = new Fmt("en");
  expect(tryChip(f, { mark: null, passed: false, date: "2026-03-02" })).toMatch(/^<span class="mark" title="[^"]+">–<\/span>$/);
  expect(tryChip(f, { mark: 0, passed: false, date: "2026-03-02" })).toContain('class="mark fail"');
  expect(tryChip(f, { mark: 100, passed: true, date: "2026-03-02" })).toContain('class="mark pass"');
});

test("Activity holds the campuses you have been to, beside titles, expertises and quests", () => {
  const f = new Fmt("en");
  const D = { extras: { achievements: [], events: [], titles: [], expertises: [], quests: [], event_kinds: {} },
    campuses: [{ name: "Madrid", city: "Madrid", joined: "2024-09-16", sessions: 3, hours: 12.5, first: "2024-09-16", last: "2026-11-01" }] };
  const [s] = activity(new Page(f, { report: D, all_projects: [] } as any, "home", {}));
  expect(s.id).toBe("activity");
  const panels = [...s.html.matchAll(/data-panel="([a-z-]+)"/g)].map((m) => m[1]);
  expect(panels).toEqual(["achievements", "events", "misc", "campuses"]);
  expect(s.html).toContain(f.t("foot.campuses"));
  expect(s.html).toContain("12:30h");
});

const extras = { achievements: [], events: [], titles: [{ name: "Mastermind", selected: true, at: "2026-05-18" }], expertises: [], quests: [], event_kinds: {} };
const activityPage = () => new Page(new Fmt("en"), { report: { extras, campuses: [] }, all_projects: [] } as any, "home", {});

test("no tag on the selected title", () => {
  const [s] = activity(activityPage());
  expect(s.html).toContain("Mastermind");
  expect(s.html).not.toContain("selected");
});

test("Activity is a widget like the rest: offered in the picker until added, then drawn with the others", () => {
  expect(widgetPicker(activityPage(), [])[0].html).toContain('value="home:activity"');
  expect(widgetPicker(activityPage(), [{ page: "home", id: "activity" }])[0].html).not.toContain('value="home:activity"');
  const [grid] = widgets(activityPage(), [{ page: "home", id: "activity", wide: false }]);
  expect(grid.html).toContain('class="widget half" data-widget="home:activity"');
  expect(grid.html).toContain('data-panel="achievements"');
  expect(profile(cardPage()).map((s) => s.id)).not.toContain("activity"); // only as a widget
});

const cardPage = (more: any = {}) => new Page(new Fmt("en"), { period: "student", report: {
  profile: { login: "peer01", wallet: 576, correction_point: 5 }, extras: { ...extras, cursus: [{ name: "42cursus", level: 17.29, grade: "Transcender" }] },
  correction_points: { earned: 12, spent: 8 }, summary: { validated: 0, projects: 0, attempts: 0, retries: 0, received: 0, given: 0 },
  logtime: { total_seconds: 0, days_present: 0 }, projects: [{ status: "finished", validated: false }] }, all_projects: [],
  promo: { rank: 3, size: 424, percentile: 99.5, median: 9.2 }, ...more } as any, "home", {});
const cardLines = (pg: Page) => [...profile(pg)[0].html.matchAll(/<p class="line">(.*?)<\/p>/g)].map((m) => (Object.assign(document.createElement("p"), { innerHTML: m[1] }).textContent || "").trim());

test("the four figures of the card each carry a line: your place in Madrid, in your kickoff, the wallet, the points", () => {
  const f = new Fmt("en");
  expect(cardLines(cardPage({ madrid: { size: 913, rank: 30, top: 3.3 } }))).toEqual([f.t("profile.madrid_top", { pct: "3.3" }),
    f.t("profile.promo_line", { pct: "99.5" }), f.t("profile.wallet_line"),
    f.t("profile.points_line", { earned: "13", spent: "8" })]); // 5 = 12 - 8 + 1 left from the Piscine, counted as earned
  expect(profile(cardPage({ madrid: { size: 913, rank: 30, top: 3.3 } }))[0].html).toContain(f.t("profile.madrid_tip", { n: "913" }));
});

test("low in Madrid it says how many you are above; with no Madrid figures yet, the way to the next level", () => {
  const f = new Fmt("en");
  expect(cardLines(cardPage({ madrid: { size: 1000, rank: 801, top: 80.1 } }))[0]).toBe(f.t("profile.madrid_above", { pct: "19.9" }));
  expect(cardLines(cardPage())[0]).toBe(f.t("profile.level_next", { pct: 29, next: 18 }));
});

test("the projects module no longer counts the ones closed without validating", () => {
  const html = profile(cardPage())[1].html;
  expect(html).not.toContain(new Fmt("en").plural(1, "count.closed"));
});

test("the card's figures count up like the modules", () => {
  const html = profile(cardPage())[0].html;
  expect(html.match(/data-count=/g)?.length).toBe(4);
});

test("a widget starts at full width, and keeps the half width the student chose", () => {
  const pg = new Page(new Fmt("en"), { report: { coalition_points: { sources: [], months: [], bonuses: [] }, given: [], projects: [] }, all_projects: [] } as any, "home", {});
  expect(widgets(pg, [{ page: "coalition", id: "bonus" }])[0].html).toContain('class="widget wide"');
  expect(widgets(pg, [{ page: "coalition", id: "bonus", wide: false }])[0].html).toContain('class="widget half"');
  // only a section with figures or a description of them over its charts folds (owner, 2026-11-24): the rest stays open
  expect(widgets(pg, [{ page: "coalition", id: "coal-points", folded: true }])[0].html).toMatch(/class="widget wide folded" data-fold /);
  expect(widgets(pg, [{ page: "coalition", id: "bonus", folded: true }])[0].html).toMatch(/class="widget wide" data-widget=/); // a saved fold left over
});

test("the card names who you are beside your name, and lists coalition, milestone, grade, track and groups as tags", () => {
  const f = new Fmt("en");
  const pg = (grade: string | null, more: any = {}) => new Page(f, { period: "student", report: {
    profile: { login: "peer01", name: "Pat Peer", groups: ["Mentor"], coalition: { name: "Zefiria", color: "#e39f0b", rank: 3 }, ...more },
    extras: { ...extras, titles: [], cursus: [{ name: "42cursus", level: 9.5, grade }], quests: [{ name: "Common Core Rank 02", validated: "2026-01-01" }] },
    summary: { validated: 0, projects: 0, attempts: 0, retries: 0, received: 0, given: 0 }, logtime: { total_seconds: 0, days_present: 0 }, projects: [] }, all_projects: [] } as any, "home", {});
  const student = profile(pg(null))[0].html;
  expect(student).toContain(`<span class="pf-status">${f.t("profile.st_student")}</span>`);
  expect(student).toMatch(/<span class="badge tag k-coal" style="--tag:[^"]+">Zefiria<\/span>/); // its name alone: no dot, no place, framed in its colour
  expect(student).not.toContain(f.t("home.nth", { n: 3 }));
  expect(student).toContain(`<span class="badge tag k-milestone g-cc">${f.t("groups.rank-03")}</span>`); // its state's colour: Common Core
  expect(student).toContain('<span class="badge tag k-group">Mentor</span>');
  expect(profile(pg("Transcender"))[0].html).toContain(`<span class="pf-status">${f.t("profile.st_outer")}</span>`);
  expect(profile(pg("Alumni"))[0].html).toContain(`<span class="pf-status">${f.t("profile.st_alumni")}</span>`);
});

test("the projects table filters by status (the ones your projects have) and by a validated mark", () => {
  const p = (name: string, status: string, mark: number | null, validated: boolean | null) => ({ name, status, mark, validated, track: "student", attempts: [], registered: "2026-01-01" });
  const all = [p("Libft", "finished", 100, true), p("minishell", "waiting_for_correction", null, null), p("cub3d", "searching_a_group", null, null), p("pipex", "finished", 40, false)];
  const page = (q: Record<string, string>) => new Page(new Fmt("en"), { period: "student", report: { projects: all }, all_projects: all } as any, "projects", q);
  const names = (q: Record<string, string>) => projectView(all, projectFilters(page(q))).map((x) => x.name);
  expect(projectFilters(page({})).statuses).toEqual(["finished", "waiting_for_correction", "searching_a_group"]);
  expect(names({ status: "waiting_for_correction" })).toEqual(["minishell"]);
  expect(names({ status: "searching_a_group" })).toEqual(["cub3d"]);
  expect(names({ status: "nonsense" })).toEqual(["Libft", "minishell", "cub3d", "pipex"]);
  expect(names({ marks: "ok" })).toEqual(["Libft"]);
});

const at = (name: string, group: string, spans: [number, number][], o: any = {}) => ({ name, group, track: group === "piscine" ? "piscine" : "common-core", status: "finished", mark: 100, validated: true,
  registered: "2026-01-01", first_ms: spans[0][0], xp_earned: 0, xp_base: 0, outstanding: 0, ...o,
  attempts: spans.map(([a, b], i) => ({ n: i + 1, start_ms: a, end_ms: b, start: "2026-01-01 10:00", validated: true, mark: 100, days: 1, evals: [] })) });

test("the attempts line has a row per milestone, not per project: exams out, work experience on its own, attempts at the same time on a row under", () => {
  const rows = timelineLanes([at("Libft", "rank-00", [[0, 10]]), at("get_next_line", "rank-01", [[10, 20]]), at("ft_printf", "rank-01", [[15, 30]]), at("Born2beroot", "rank-01", [[30, 40]]),
    at("Exam Rank 02", "rank-02", [[40, 41]], { exam: true }), at("Work Exp. I - Duration", "outer-core", [[50, 60]]), at("ft_ls", "outer-core", [[50, 70]])], (g) => g.toUpperCase());
  expect(rows.map(([label, spans]) => [label, spans.map((s) => s.name)])).toEqual([
    ["RANK-00", ["Libft"]], ["RANK-01", ["get_next_line", "Born2beroot"]], ["", ["ft_printf"]], ["OUTER-CORE", ["ft_ls"]], ["WORK", ["Work Exp. I - Duration"]]]);
});

test("the projects table is one open list like the evaluation log: no groups, its count in the title, a milestone filter, Clear filters while one is set", () => {
  const all = [at("Libft", "rank-00", [[1, 2]]), at("get_next_line", "rank-01", [[3, 4]]), at("ft_printf", "rank-01", [[5, 6]], { status: "in_progress" })];
  const html = (q: Record<string, string>) => {
    const f = new Fmt("en");
    const D = { projects: all, extras: { cursus: [], skills: [] }, insights: {}, summary: {} };
    return projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", q)).find((s) => s.id === "projects-table")!.html;
  };
  const rowsOf = (h: string) => [...h.matchAll(/<td class="proj" data-v="([^"]+)"/g)].map((m) => m[1]);
  const first = html({});
  expect(first).not.toContain('<tbody class="group');
  expect(rowsOf(first)).toEqual(["ft_printf", "get_next_line", "Libft"]); // newest first
  expect(first).toContain('class="table-wrap tall"'); // the log's box
  expect(first).toMatch(/<h2>Projects<span class="count"><span class="sep"> · <\/span>3 projects<\/span><\/h2>/);
  expect(first).toMatch(/<option value="rank-01"[^>]*>Milestone 1</);
  expect(first).not.toMatch(/<option value="rank-02"/); // only the milestones your projects have
  expect(first).not.toContain("log-clear");
  const one = html({ milestone: "rank-01" });
  expect(rowsOf(one)).toEqual(["ft_printf", "get_next_line"]);
  expect(one).toContain("log-clear");
  expect(rowsOf(html({ milestone: "nonsense" })).length).toBe(3);
});

test("projects of another cursus (a Discovery piscine, a Piscine Reload) are a milestone of their own, in the table's filter and on the attempts line", () => {
  const all = [at("ft_ls", "outer-core", [[1, 2]], { slug: "ft_ls", track: "outer-core" }), at("Cellule0.0 - Shell", "outer-core", [[3, 4]], { slug: "cellule0-0-shell", track: "outer-core" }),
    at("Piscine Django", "outer-core", [[5, 6]], { slug: "piscine-django", track: "outer-core" })];
  const D = { projects: all, extras: { cursus: [], skills: [] }, insights: {}, summary: {}, given: [],
    received: [{ slug: "cellule0-0-shell", cursus: ["Discovery Piscine - Web"] }, { slug: "ft_ls", cursus: ["42cursus", "42Senior"] }] };
  const f = new Fmt("en");
  const secs = projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", {}, true));
  const table = secs.find((s) => s.id === "projects-table")!.html;
  expect(table).toContain(`<option value="outside">${f.t("projects.outside")}</option>`);
  expect(table).not.toContain("csv-bottom"); // phones: no Preview nor Download (owner, 2026-11-25)
  const only = (m: string) => [...projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", { milestone: m }))
    .find((s) => s.id === "projects-table")!.html.matchAll(/<td class="proj" data-v="([^"]+)"/g)].map((x) => x[1]).sort();
  expect(only("outside")).toEqual(["Cellule0.0 - Shell"]);
  expect(only("outer-core")).toEqual(["Piscine Django", "ft_ls"]); // not evaluated in another cursus: it stays
  expect(secs.find((s) => s.id === "timeline")!.html).toContain(`<span class="gt-group">${f.t("projects.outside")}</span>`);
});

test("the portfolio's areas: the skills 42's transcript gives a project, else its RNCP domains by name; work experience the internship's", () => {
  const f = new Fmt("en");
  const row = (name: string, track: string, areas: string) => [name, track, areas, "2024-09-17", "2024-10-09", 125, 2, 578, 1, 17.3];
  const pg = { f, v: { derive: { portfolio: [row("Libft", "common-core", ""), row("dslr", "outer-core", "ai"), row("ft_ping", "outer-core", "unix, security"),
    row("Work Experience I - Duration", "outer-core", ""), row("Exam Rank 02", "common-core", "")] } } } as any;
  const areas = parseCsv(portfolioCsv(pg)).slice(1).map((r) => r[2]);
  expect(areas).toEqual(["Algorithms & AI, Imperative programming, Rigor", "DB & Data, Algorithms & AI", "Unix & kernel, Security",
    "Group & interpersonal, Company experience", ""]); // exams have none
});

test("Technical domains: Skills or RNCP, RNCP first when there is any; RNCP a square per validated project, Skills twenty lit by the radar's level; the XP", () => {
  const f = new Fmt("en");
  const libft = { name: "Libft", validated: true, exam: false, xp_earned: 462, attempts: [] }; // three skills in the transcript
  const skills42 = [{ name: "Rigor", level: 7.5 }, { name: "Imperative programming", level: 10 }, { name: "Algorithms & AI", level: 2.6 }, { name: "Unix", level: 0 }];
  const view = (domains: any[]) => ({ period: "student", report: { projects: [libft], extras: { skills: skills42 }, insights: {} }, all_projects: [libft], derive: { domains } }) as any;
  const lit = (h: string) => [...h.matchAll(/<span class="seats"[^>]*>(.*?)<\/span>/g)].map((m) => [m[1].match(/class="on"/g)?.length || 0, m[1].match(/<i/g)!.length]);
  const html = (domains: any[], q = {}) => projects(new Page(f, view(domains), "projects", q)).find((s) => s.id === "domains")!.html;
  const web = [{ key: "web", xp: 1234, projects: ["webserv", "ft_transcendence"] }];
  expect(html(web)).toContain(`${f.t("domains.tag.web")}</span>`); // RNCP shown first
  expect(html(web)).toContain("2 projects · ≈ 1,234 XP");
  expect(html(web)).toContain('style="--of:10"'); // ten squares at least, the same on every row
  expect(lit(html(web))).toEqual([[2, 10]]);
  const skills = html(web, { domains: "skills" });
  expect(skills.match(/<li>/g)?.length).toBe(3); // Libft's three skills
  expect(skills).toContain("1 project · ≈ 462 XP");
  // the radar's scale: its top is the highest level rounded up to a multiple of 5 (10 here), a lit square per 5 %
  expect(skills).toContain('style="--of:20"');
  expect(lit(skills)).toEqual([[20, 20], [15, 20], [5, 20]]); // the highest level first
  expect(skills).toContain("Level 7.50 · 75% of 10"); // in the tip: the level and its share of the radar's top
  expect(skills).toMatch(/aria-label="[^"]*Rigor Level 7\.50/); // the level is read out too
  expect(html([])).toMatch(/aria-pressed="true">Skills/); // no RNCP domain: the skills
  expect(html(web)).toContain('data-preview="portfolio"'); // the portfolio is previewed, not downloaded (owner, 2026-11-23)
  expect(html(web)).not.toContain('data-download="portfolio"');
  expect(html(web).match(/class="seg dom-switch/g)?.length).toBe(2); // by the title, and on top of the rows for phones
  expect(html(web)).not.toContain("csv-bottom"); // phones: no Preview (owner, 2026-11-25)
});

test("the attempts line shows in dev only; ravazque.info has the two cumulative charts alone", () => {
  const f = new Fmt("en");
  const all = [at("Libft", "rank-00", [[1, 2]])];
  const D = { projects: all, extras: { cursus: [], skills: [] }, insights: {}, summary: {}, given: [], received: [] };
  const html = (dev: boolean) => projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", {}, dev)).find((s) => s.id === "timeline")!.html;
  expect(html(true)).toContain('data-panel="timeline"');
  expect(html(false)).not.toContain('data-panel="timeline"');
  expect(html(false)).toContain('data-panel="cum-validated"');
});

test("Pace for a transcender: how long the Common Core took, and how far the alumni estimate is", () => {
  const f = new Fmt("en");
  const view = (o: { quests?: any[]; due?: string; alumnized?: string; period?: string } = {}) => ({ period: o.period || "student", derive: { alumni_due: o.due },
    report: { generated: "2026-11-23T10:00:00", projects: [], profile: { alumnized: o.alumnized }, insights: { pace: { months_since_kickoff: 26, xp_per_month: 100, months: [] } },
      extras: { cursus: [{ name: "42cursus", begin: "2024-09-02T08:00:00" }], quests: o.quests ?? [{ name: "Common Core Rank 06", validated: "2026-01-15T10:00:00" }], skills: [] } },
    all_projects: [] }) as any;
  const pace = (o = {}) => projects(new Page(f, view(o), "projects", {})).find((s) => s.id === "pace")!.html;
  const html = pace({ due: "2027-03-23" });
  expect(html).toContain(f.t("pr2.transcended"));
  expect(html).toContain("16 months"); // 2 Sep 2024 → 15 Jan 2026
  expect(html).toContain(f.t("pr2.alumni_in"));
  expect(html).toContain("≈ 4 months"); // 23 Nov 2026 → 23 Mar 2027
  expect(pace({ due: "2026-12-10" })).toContain("17 days left");
  expect(pace({ due: "paused" })).toContain(f.t("profile.paused"));
  expect(pace({ due: "2027-03-23", alumnized: "2026-11-01" })).not.toContain(f.t("pr2.alumni_in")); // alumni already
  expect(pace({ quests: [] })).not.toContain(f.t("pr2.transcended")); // not a transcender
  expect(pace({ period: "piscine" })).not.toContain(f.t("pr2.transcended"));
});

test("the grade tag takes its state's colour, as in Connections: Transcender orange, Alumni blue, a Cadet green", () => {
  const f = new Fmt("en");
  const card = (grade: string, quests: any[]) => profile(new Page(f, { period: "student", report: {
    profile: { login: "peer01", name: "Pat Peer" }, extras: { ...extras, titles: [], cursus: [{ name: "42cursus", level: 12, grade }], quests },
    summary: { validated: 0, projects: 0, attempts: 0, retries: 0, received: 0, given: 0 }, logtime: { total_seconds: 0, days_present: 0 }, projects: [] }, all_projects: [] } as any, "home", {}))[0].html;
  expect(card("Transcender", [{ name: "Common Core", validated: "2026-01-01" }])).toContain('class="badge tag k-grade g-outer">Transcender<');
  expect(card("Alumni", [])).toContain('class="badge tag k-grade g-alumni">Alumni<');
  expect(card("Cadet", [{ name: "Common Core Rank 02", validated: "2026-01-01" }])).toContain('class="badge tag k-grade g-cc">Cadet<');
});

test("a passed exam's badge is the passed green, not the Outstanding one", async () => {
  const { projects } = await import("./projects");
  const html = projects(new Page(new Fmt("en"), { period: "student", all_projects: [], report: { profile: { login: "me" }, extras: { cursus: [], quests: [] }, projects: [],
    summary: {}, logtime: {}, insights: { exams: [{ name: "Exam Rank 02", passed: true, attempts: 1, best: 100, tries: [100] }] } } } as any, "projects", {})).map((s) => s.html).join("");
  expect(html).toContain('<span class="badge ok">');
  expect(html).not.toMatch(/<span class="badge out">[^<]*Passed/);
});


test("friendlier findings: pace with the expected finish, your promo in tenths, your best skill, exams passed", () => {
  const f = new Fmt("en");
  const report = { generated: "2026-11-23T10:00:00", projects: [], profile: {}, summary: {}, logtime: {},
    extras: { quests: [], cursus: [], skills: [{ name: "Algorithms", level: 7.5 }, { name: "Rigor", level: 3 }] },
    insights: { pace: { months_since_kickoff: 26, xp_per_month: 100.4, months: [] }, exams: [{ name: "Exam Rank 02", passed: true, attempts: 1, best: 100, tries: [] }, { name: "Exam Rank 03", passed: false, attempts: 1, best: 0, tries: [] }] } };
  const view = { period: "student", report, all_projects: [], derive: { alumni_due: "2027-03-23" }, promo: { rank: 4, size: 11, percentile: 70, below: 7, mine: 5.2, histogram: [{ level: 4, count: 7 }, { level: 5, count: 1 }, { level: 6, count: 3 }] } } as any;
  const html = projects(new Page(f, view, "projects", {})).map((s) => s.html).join("");
  expect(html).toContain("You earn about <b>100 XP</b> a month");
  expect(html).toContain("<b>Mar 2027</b>");
  expect(html).toContain("ahead of <b>7 in 10</b>");
  expect(html).toContain("<b>Algorithms</b>, at level");
  expect(html).toContain("<b>1 of 2</b> exams");
});
