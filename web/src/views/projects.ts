// Projects: your level and pace, skills, every project and attempt, exams, technical domains and the timeline.
import { BAD, GOOD, NEUTRAL, S1, S2, type GanttItem, type SeatRow, empty, gantt, hbars, legend, lines, seatbars, vbars } from "../lib/charts";
import { radar, radarTop, type Skill } from "../lib/graphs";
import { ARROW, badge, esc, tipAttr } from "../lib/h";
import { pyRound } from "../fmt";
import { csv, facts, table } from "../lib/table";
import { Page, Section, aboveShare, block, cols, filters, headBlock, info, redMark, search, section, select, shortProject } from "./page";
import { workExperience } from "./evaluations";
import projectSkills from "@data/project_skills.json";

/** The skills 42's transcript associates with each project, by name (the owner's transcript, 2026-11-19: the C track's Common
 * Core and the OuterCore projects in it; "Work Experience" is the internship's, for every part of it). */
const PROJECT_SKILLS = projectSkills as Record<string, string[]>;

/** The students above you in Your promo: the slate faded toward the ground. */
const ABOVE = "color-mix(in oklab, var(--slate) 45%, var(--ground))";

/** The skills 42's transcript gives your validated projects, each with its projects (one project counts in each of its
 * skills; work experience parts take the internship's), most projects first. */
function skillRows(D: any): [string, string[]][] {
  const by = new Map<string, string[]>();
  for (const p of D.projects.filter((p: any) => p.validated === true && !p.exam)) {
    const skills = Object.hasOwn(PROJECT_SKILLS, p.name) ? PROJECT_SKILLS[p.name] : workExperience({ project: p.name }) ? PROJECT_SKILLS["Work Experience"] : [];
    for (const s of skills) by.set(s, [...(by.get(s) || []), p.name]);
  }
  return [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

/** The skills radar's levels for the page's period (owner, 2026-11-19: no switch of its own). */
function radarSkills(pg: Page): Skill[] {
  const X = pg.D.extras, cursus = pg.period === "piscine" ? "C Piscine" : "42cursus";
  return X.skills_by_cursus?.[cursus] || (cursus === "42cursus" ? X.skills || [] : []);
}

const PROJECT_GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "outside", "piscine"];

const groupLabel = (pg: Page, g: string) => (g === "piscine" ? pg.f.t("track.piscine") : g === "outside" ? pg.f.t("projects.outside") : pg.f.t(`groups.${g}`));

/** The projects of another cursus (a Discovery piscine, a Piscine Reload…), by slug: the ones whose evaluations name
 * some cursus and never the 42cursus. The report files them under OuterCore; one never evaluated can't be told. */
export function outsideCursus(D: any): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const e of [...(D.received || []), ...(D.given || [])]) {
    if (!seen.has(e.slug)) seen.set(e.slug, new Set());
    for (const c of e.cursus || []) seen.get(e.slug)!.add(c);
  }
  return new Set([...seen].filter(([, cs]) => cs.size && !cs.has("42cursus") && !cs.has("C Piscine")).map(([slug]) => slug));
}

export function projectFilters(pg: Page) {
  const statuses = [...new Set(pg.allProjects.map((p) => p.status).filter(Boolean))] as string[]; // the ones your projects have
  const outside = outsideCursus(pg.D);
  const groupOf = (p: any): string => (p.track !== "piscine" && outside.has(p.slug) ? "outside" : p.group || p.track);
  const milestones = PROJECT_GROUPS.filter((g) => pg.allProjects.some((p) => !p.exam && groupOf(p) === g)); // the ones your projects have
  const years = [...new Set(pg.allProjects.map((p) => (p.marked || p.registered || "").slice(0, 4)).filter(Boolean))].sort().reverse() as string[];
  return {
    track: pg.period, search: pg.q("q", "").slice(0, 80), // the page's period (owner, 2026-11-19: no switch of its own)
    marks: pg.q("marks", "all", ["all", "ok", "bonus", "max", "failed"]), year: pg.q("year", "all", ["all", ...years]),
    years, statuses, status: pg.q("status", "all", ["all", ...statuses]), milestone: pg.q("milestone", "", ["", ...milestones]), milestones, groupOf,
  };
}

export function projectView(projects: any[], fl: ReturnType<typeof projectFilters>) {
  const q = fl.search.trim().toLowerCase();
  const markOk: Record<string, (p: any) => boolean> = {
    ok: (p) => p.validated === true, bonus: (p) => (p.mark || 0) > 100, max: (p) => p.mark === 125,
    failed: (p) => !p.validated && p.mark !== null && p.status === "finished",
  };
  return projects.filter((p) => !p.exam // exams have their own section
    && (fl.track === "all" || (p.track === "piscine") === (fl.track === "piscine"))
    && (!q || p.name.toLowerCase().includes(q)) && (markOk[fl.marks] || (() => true))(p)
    && (!fl.milestone || fl.groupOf(p) === fl.milestone) && (fl.status === "all" || p.status === fl.status) && (fl.year === "all" || (p.marked || p.registered || "").startsWith(fl.year)));
}

function markChip(pg: Page, a: any) {
  const f = pg.f;
  const state = a.validated === true ? "pass" : a.validated === false ? "fail" : a.mark === null ? "open" : "";
  const outcome = a.validated === true ? `, ${f.t("outcome.validated").toLowerCase()}` : a.validated === false ? `, ${f.t("outcome.failed").toLowerCase()}` : "";
  const title = [f.t("projects.attempt_title", { n: a.n }) + outcome, a.start, a.members?.length ? f.t("projects.with", { list: a.members.join(", ") }) : "",
    a.moulinette?.length ? f.t("projects.moulinette", { marks: a.moulinette.map((m: any) => m.mark).join(", ") }) : ""].filter(Boolean).join(" · ");
  return `<span class="mark ${state}" title="${esc(title)}">${esc(a.mark ?? f.t("projects.pending"))}</span>`;
}

/** The CSV downloads: the table as filtered, and the portfolio (validated projects, nobody else's data). */
export function projectsCsv(pg: Page): string {
  const f = pg.f, fl = projectFilters(pg);
  return csv([[f.t("col.project"), f.t("col.track"), f.t("col.group"), f.t("col.status"), f.t("col.final"), f.t("col.attempts"), f.t("col.outstanding"),
    f.t("col.xp"), f.t("col.started"), f.t("col.marked")],
  ...projectView(pg.allProjects, fl).map((p) => [p.name, f.t(`track.${p.track}`), groupLabel(pg, p.group || p.track), p.status, p.mark,
    p.attempts.length, p.outstanding, p.xp_earned, (p.registered || "").slice(0, 10), (p.marked || "").slice(0, 10)])]);
}

export function portfolioCsv(pg: Page): string {
  const f = pg.f, cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
  // the skills 42's transcript gives the project (official), else its RNCP domains by name, as the chart says them
  const areas = (row: any[]) => {
    const skills = Object.hasOwn(PROJECT_SKILLS, row[0]) ? PROJECT_SKILLS[row[0]] : workExperience({ project: row[0] }) ? PROJECT_SKILLS["Work Experience"] : null;
    return (skills || String(row[2] || "").split(", ").filter(Boolean).map((k) => cap(f.has(`domains.tag.${k}`) ? f.t(`domains.tag.${k}`) : k))).join(", ");
  };
  return csv([[f.t("col.project"), f.t("col.track"), f.t("col.areas"), f.t("col.started"), f.t("col.marked"), f.t("col.final"), f.t("col.attempts"),
    f.t("col.xp"), f.t("col.team"), f.t("col.days_to_validate")], ...(pg.v.derive?.portfolio || []).map((r: any[]) => [r[0], r[1], areas(r), ...r.slice(3)])]);
}

/** Preview and download, by the section's title; phones have neither (csv-top, owner 2026-11-25). */
const csvButtons = (pg: Page, kind: string, title: string, button: string) =>
  `<span class="head-actions csv-top"><button class="btn secondary" type="button" data-preview="${kind}" data-title="${esc(title)}" aria-haspopup="dialog">${esc(pg.f.t("common.preview"))}</button>`
  + `<button class="btn secondary" type="button" data-download="${kind}">${esc(button)}</button></span>`;

/** One exam try: its mark in green (passed) or red, or a grey "–" when it has none. */
export const tryChip = (f: Page["f"], x: any) =>
  `<span class="mark${x.mark === null || x.mark === undefined ? "" : x.passed ? " pass" : " fail"}" title="${esc(f.day(x.date))}">${esc(x.mark ?? "–")}</span>`;

/** One exam of yours beside 42 Madrid's (the weekly count): its slug from your projects (both tracks name their exams
 * alike: the one with the same sittings and first day), then the share who pass it the first time and the median days.
 * Null with no count, or none for that exam. */
export function examMadrid(pg: Page, e: any, stats: any): { text: string; tip: string } | null {
  const f = pg.f, same = (pg.D.projects || []).filter((p: any) => p.exam && p.name === e.name);
  const mine = same.find((p: any) => p.attempts?.length === e.attempts && String(p.attempts[0]?.start || "").slice(0, 10) === e.tries?.[0]?.date) || same[0];
  const r = mine && (stats?.projects || []).find((p: any) => p.slug === mine.slug);
  const n = (v: number | null | undefined) => (v === null ? f.t("holy.under5") : f.num(v ?? 0));
  const pis = !r && mine && (stats?.piscine?.projects || []).find((p: any) => p.slug === mine.slug); // a Piscine exam: how many passed, the median mark
  if (pis) {
    const passed = pis.passed === null || pis.registered === null ? f.t("holy.under5") : pis.registered ? f.pct(pis.passed ?? 0, pis.registered) : "–";
    const mark = pis.median_mark == null ? "–" : f.num(pis.median_mark);
    return { text: f.t("exams.madrid_piscine", { passed, mark }), tip: [`${e.name} · ${f.t("pages.madrid")}`, f.t("exams.madrid_piscine_tip", { passed, mark, registered: n(pis.registered) }),
      "---", `# ${f.t("campus.how")}`, f.t("exams.madrid_piscine_how")].join("\n") };
  }
  if (!r) return null;
  const first = r.first_try === null || r.passed === null ? f.t("holy.under5") : r.passed ? f.pct(r.first_try ?? 0, r.passed) : "–";
  const days = r.median_days == null ? "–" : f.num(r.median_days, Number.isInteger(r.median_days) ? 0 : 1);
  return { text: f.t("exams.madrid", { first, days }), tip: [`${e.name} · ${f.t("pages.madrid")}`, f.t("exams.madrid_tip", { first, days, registered: n(r.registered) }),
    "---", `# ${f.t("campus.how")}`, f.t("exams.madrid_how")].join("\n") };
}

export function projects(pg: Page, stats: any = null): Section[] {
  const f = pg.f, D = pg.D, X = D.extras;
  const out: Section[] = [];

  // level, pace and the alumni estimate (Home held them in v1)
  // your pace; the level, the validated projects and the alumni date are Profile's (owner, 2026-11-13: nothing twice)
  const pc = D.insights?.pace;
  const lvl: [string, string][] = [];
  if (pc) {
    if (pc.months_since_kickoff !== null && pc.months_since_kickoff !== undefined) lvl.push([f.t("pr2.since"), esc(f.plural(pc.months_since_kickoff, "pace.months"))]);
    lvl.push([f.t("pr2.xp_month"), f.num(pc.xp_per_month)]);
  }
  // transcenders (owner, 2026-11-23): how long the Common Core took (42cursus kickoff → the Rank 06 quest) and how far the
  // alumni estimate is (Profile's path has the dates); not in the Piscine's view
  const q6 = (X.quests || []).find((q: any) => /rank 06/i.test(q.name || "") && q.validated);
  const kick = (pg.v.all_cursus || X.cursus || []).find((c: any) => c.name === "42cursus")?.begin;
  if (q6 && pg.period !== "piscine") {
    const day = (s: string) => Date.parse(String(s).slice(0, 10)), month = 30.44 * 864e5;
    if (kick) lvl.push([f.t("pr2.transcended"), esc(f.plural(Math.round((day(q6.validated) - day(kick)) / month), "pace.months"))]);
    const due = pg.v.derive?.alumni_due;
    if (due && !D.profile?.alumnized) {
      const left = due === "paused" ? NaN : day(due) - day(pg.asOf || new Date().toISOString());
      lvl.push([f.t("pr2.alumni_in"), esc(due === "paused" ? f.t("profile.paused") : left <= 0 ? f.t("pace.alumni_due")
        : left < 31 * 864e5 ? f.plural(Math.round(left / 864e5), "pace.days_left") : `≈ ${f.plural(Math.round(left / month), "pace.months")}`)]);
    }
  }
  let finish = "";
  const dueDay = pg.v.derive?.alumni_due;
  if (pg.period !== "piscine" && dueDay && dueDay !== "paused" && !D.profile?.alumnized && Date.parse(String(dueDay).slice(0, 10)) > Date.parse(String(pg.asOf || new Date().toISOString()).slice(0, 10)))
    finish = " " + f.t("pr2.pace_finish", { when: esc(`${f.months[+String(dueDay).slice(5, 7) - 1]} ${String(dueDay).slice(0, 4)}`) });
  const paceFinding = pc && pc.xp_per_month ? `<p class="finding">${f.t("pr2.pace_finding", { xp: f.num(Math.round(pc.xp_per_month)) })}${finish}</p>` : "";
  const months = pc?.months || [], promo = pg.v.promo;
  const xpLabels = months.map((m: any) => f.monthLabel(m.month));
  // the month's XP in bars, the running total in each tip (owner's pick 2026-11-23); four even steps, as Your promo beside it
  const xpChart = vbars(f, xpLabels, [[f.t("pace.xp"), months.map((m: any) => m.xp), S1]], { label: f.t("pr2.xp_title"), four: true, colTips: true, fmt: (v) => f.num(v),
    tips: months.map((m: any, i: number) => `${xpLabels[i]}\n${f.t("pace.xp")}: ${f.num(m.xp)}\n${f.t("pace.cumulative")}: ${f.num(m.cumulative)}`), emptyText: f.t("empty.period") });
  out.push({ id: "pace", nav: f.t("nav.pace"), html: section("pace", f.t("pace.title"), paceFinding + `<dl class="facts">${facts(lvl)}</dl>` + cols(headBlock("pace-xp", f.t("pr2.xp_title"), "", xpChart),
    // the same shape as XP per month beside it: title and key on one line, then the plot (its sentence is the title's ⓘ)
    promo ? `<div class="block" data-panel="promo"><div class="block-head"><h3>${esc(f.t("pr2.promo_title"))} ${info(f.t("pr2.promo_info") + " " + f.t("standing.promo_lede", { rank: f.num(promo.rank), size: f.num(promo.size), pct: f.num(aboveShare(promo, promo.percentile), 1) })
      + (promo.tied ? " " + f.plural(promo.tied, "standing.promo_tied") : ""))}</h3>`
      + legend([[f.t("standing.below_you"), S2], [f.t("standing.your_level"), S1], [f.t("standing.above_you"), ABOVE]])
      + "</div>" + promoFinding(pg, promo) + promoChart(pg, promo) + "</div>" : "")) });

  const show = pg.q("skills", "radar", ["radar", "bars"]); // phones show one of the two (the switch is theirs only)
  const items = radarSkills(pg);
  let skills = empty(f.t("empty.period"));
  if (items.length) {
    const graded = items.filter((s: any) => s.level > 0);
    const bars = hbars(f, graded.map((s: any) => s.name), [[f.t("extras.level"), graded.map((s: any) => s.level), S1]],
      { label: f.t("extras.skills_title"), end: (_i, v) => f.level(v), big: true });
    const best = graded.reduce((a: any, b: any) => (b.level > a.level ? b : a), graded[0] || { level: 0 });
    skills = (best.level > 0 ? `<p class="finding">${f.t("pr2.skills_finding", { name: esc(best.name), level: f.level(best.level) })}</p>` : "")
      + `<div class="radar-pair" data-show="${show}"><div class="radar-fig">${radar(f, items, f.t("extras.skills_title"))}</div><div class="radar-bars">${bars}</div></div>`;
  }
  const sw = items.length ? pg.seg("skills", [["radar", f.t("skills.radar")], ["bars", f.t("skills.bars")]], show, f.t("skills.view"), "skills", "phone-only title-line skills-sw") : "";
  out.push({ id: "skills", nav: f.t("extras.skills_title"), html: section("skills", "", cols(block("skills", skills)),
    { head: `<div class="panel-head"><h2>${esc(f.t("pr2.skills_title"))} ${info(f.t("pr2.skills_info"))}</h2>${sw}</div>` }) });

  // every project with each attempt
  const fl = projectFilters(pg);
  const rows = projectView(pg.allProjects, fl);
  const evalLine = (e: any) => {
    const state = e.mark === null || e.mark === undefined ? "open" : redMark(e) ? "fail" : "pass";
    const flag = e.outstanding ? " " + badge(f.t("flag.outstanding"), "out") : e.negative ? " " + badge(e.flag || "", "bad") : "";
    return `<li><span class="code">${esc(e.corrector)}</span> <span class="mark ${state}">${esc(e.mark ?? "–")}</span>${flag} <span class="note">${esc(e.begin ? f.dayTime(e.begin) : "")}</span></li>`;
  };
  const detail = (p: any) => {
    if (!p.attempts.length) return "";
    const lis = p.attempts.map((a: any) => `<li><p><b>${esc(f.t("projects.attempt_title", { n: a.n }))}</b> ${markChip(pg, a)} <span class="note">${esc(f.dayTime(a.start))} ${ARROW} `
      + `${esc(a.closed || a.locked ? f.dayTime(a.closed || a.locked) : f.t("projects.tip_open"))}</span></p><p class="note">${esc(a.members?.length ? f.t("projects_table.team", { list: a.members.join(", ") }) : f.t("projects_table.solo"))}</p>`
      + (a.evaluations?.length ? `<ul class="evals">${a.evaluations.map(evalLine).join("")}</ul>` : `<p class="note">${esc(f.t("projects_table.no_evals"))}</p>`) + "</li>").join("");
    const n = p.attempts.length;
    return `<details><summary>${esc(f.t("projects_table.detail", { count: n, n }))}</summary><ol class="attempts">${lis}</ol></details>`;
  };
  const statusName = (s: string) => (f.has(`status.${s}`) ? f.t(`status.${s}`) : s.replace(/_/g, " "));
  const status = (p: any) => esc(statusName(p.status || ""));
  const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
  // one open list, like the evaluation log (owner, 2026-11-13): the milestone is a column and a filter, not a group
  const groupOf = fl.groupOf;
  const filtering = !!fl.search.trim() || fl.marks !== "all" || fl.status !== "all" || fl.year !== "all" || !!fl.milestone;
  const tbl = table(f, [
    { k: "name", t: f.t("col.project"), cls: "proj" },
    { k: "group", t: f.t("log.milestone"), nw: true, hide: true, sv: (p) => PROJECT_GROUPS.indexOf(groupOf(p)), f: (p) => esc(groupLabel(pg, groupOf(p))) },
    { k: "status", t: f.t("col.status"), nw: true, hide: true, f: status },
    { k: "mark", t: f.t("col.final"), num: true, f: (p) => (p.mark !== null && p.mark !== undefined ? esc(p.mark) : "–") },
    { k: "attempts", t: f.t("col.attempts"), s: f.t("abbr.attempts"), cls: "marks-col", sv: (p) => p.attempts.length,
      f: (p) => '<span class="marks">' + p.attempts.map((a: any, i: number) => (i === 0 ? markChip(pg, a) : `<span class="step">${ARROW}${markChip(pg, a)}</span>`)).join("") + "</span>" },
    { k: "outstanding", t: f.t("col.outstanding"), s: f.t("abbr.outstanding"), num: true },
    { k: "xp_earned", t: f.t("col.xp"), num: true, nw: true, f: (p) => `${f.num(p.xp_earned)}<span class="sub">${esc(f.t("projects_table.xp_base", { xp: f.num(p.xp_base) }))}</span>` },
    { k: "first_ms", t: f.t("col.started"), nw: true, hide: true, f: (p) => esc(f.day(p.registered)) },
  ], rows, { label: f.t("projects_table.title"), sort: ["first_ms", -1], sticky: true, detail, empty: f.t("projects_table.none") });
  const form = filters("projects-table",
    search("q", fl.search, f.t("common.search"), f.t("projects_table.search"))
    + select("milestone", f.t("log.milestone"), [["", f.t("log.milestone_all")], ...fl.milestones.map((m) => [m, groupLabel(pg, m)] as [string, string])], fl.milestone)
    + select("status", f.t("projects_table.status"), [["all", f.t("projects_table.status_all")], ...fl.statuses.map((s) => [s, capital(statusName(s))] as [string, string])], fl.status)
    + select("marks", f.t("projects_table.marks"), ["all", "ok", "bonus", "max", "failed"].map((v) => [v, f.t(`projects_table.marks_${v}`)]), fl.marks)
    + select("year", f.t("projects_table.year"), [["all", f.t("projects_table.year_all")], ...fl.years.map((y) => [y, y] as [string, string])], fl.year)
    + (filtering ? `<a class="btn secondary log-clear" href="${esc(pg.url(undefined, { q: "", milestone: "", status: "", marks: "", year: "" }))}" data-keep>${esc(f.t("log.clear"))}</a>` : ""));
  out.push({ id: "projects-table", nav: f.t("nav.projects_table"), html: section("projects-table", f.t("projects_table.title"),
    form + `<div id="projects-table-results">` + cols(`<div class="block" data-panel="projects-table"><div class="table-wrap tall">${tbl}</div></div>`) + "</div>",
    { head: `<div class="panel-head"><h2>${esc(f.t("projects_table.title"))}<span class="count"><span class="sep"> · </span>${esc(f.plural(rows.length, "projects_table.count"))}</span></h2>`
      + `${csvButtons(pg, "projects", f.t("projects_table.title"), f.t("projects_table.csv"))}</div>` }) });

  const exams = D.insights?.exams || [];
  out.push({ id: "exams", nav: f.t("nav.exams"), html: section("exams", f.t("exams.title"), (exams.length ? `<p class="finding">${f.t("pr2.exams_finding", { passed: f.num(exams.filter((e: any) => e.passed).length), total: f.num(exams.length) })}</p>` : "") + cols(block("exams", `<div class="table-wrap">${table(f, [
    { k: "name", t: f.t("col.exam"), nw: true },
    { k: "passed", t: f.t("col.status"), nw: true, sv: (e) => (e.passed ? 1 : 0), f: (e) => badge(f.t(e.passed ? "exams.passed" : "exams.pending"), e.passed ? "ok" : "") }, // passed: the passed green (deep green is Outstanding)
    { k: "attempts", t: f.t("col.attempts"), s: f.t("abbr.attempts"), num: true }, { k: "best", t: f.t("col.best"), num: true },
    { k: "days_to_pass", t: f.t("col.days_to_pass"), s: f.t("abbr.days_to_pass"), num: true, f: (e) => esc(f.num(e.days_to_pass)) },
    { k: "tries", t: f.t("col.tries"), ph: true, sv: (e) => e.tries.length, f: (e) => '<span class="marks">' + e.tries.map((x: any) => tryChip(f, x)).join("") + "</span>" },
    { k: "madrid", t: f.t("pages.madrid"), nw: true, sv: (e) => examMadrid(pg, e, stats)?.text ?? "",
      f: (e) => { const m = examMadrid(pg, e, stats); return m ? `<span${tipAttr(m.tip)}>${esc(m.text)}</span>` : "–"; } },
  ], exams, { label: f.t("exams.title"), sort: ["name", 1], empty: f.t("exams.none") })}</div>`
    + (exams.length ? `<p class="note"><a href="${esc(pg.url("exams"))}">${esc(f.t("exams.madrid_all"))}</a></p>` : "")))) });

  const [domains, domainsSwitch] = domainsBody(pg);
  out.push({ id: "domains", nav: f.t("domains.title"), html: section("domains", "", domains,
    { head: `<div class="panel-head"><h2>${esc(f.t("pr2.domains_title"))} ${info(`${f.t("pr2.domains_info")} ${f.t("domains.skills_note")} ${f.t("domains.xp_note")}`)}</h2>`
      + `<div class="dom-actions"><button class="btn secondary" type="button" data-preview="portfolio" data-title="${esc(f.t("domains.portfolio_title"))}" aria-haspopup="dialog">`
      + `${esc(f.t("common.preview"))}</button>${domainsSwitch("dom-head")}</div></div>` }) });

  const laneName = (g: string) => (g === "work" ? f.t("projects.lane_work") : g === "other" ? f.t("log.milestone_other") : groupLabel(pg, g));
  const colour = (a: any) => (a.validated === true ? GOOD : a.validated === false ? BAD : NEUTRAL);
  const attemptTip = (p: any, a: any) => {
    const outcome = a.validated ? f.t("outcome.validated") : a.validated === false ? f.t("outcome.failed") : a.status ? (f.has(`status.${a.status}`) ? f.t(`status.${a.status}`) : a.status.replace(/_/g, " ")) : "";
    return [f.t("projects.tip_title", { name: p.name, n: a.n, of: p.attempts.length }), `${outcome} · ${f.t("projects.tip_mark", { mark: a.mark ?? "–" })}`,
      `${a.start} ➜ ${a.closed || a.locked || f.t("projects.tip_open")} (${f.t("projects.tip_days", { count: pyRound(a.days, 1), n: f.num(a.days, 1) })})`,
      f.plural((a.evals || []).length, "count.evaluations") + (a.outstanding ? ` · ${a.outstanding} ${f.t("flag.outstanding")}` : ""),
      a.correctors?.length ? f.t("projects.by", { list: a.correctors.join(", ") }) : "", a.members?.length ? f.t("projects.team", { list: a.members.join(", ") }) : ""].filter(Boolean).join(" · ");
  };
  const retries = D.projects.flatMap((p: any) => p.attempts.slice(1).map((a: any) => a.start_ms)).sort((a: number, b: number) => a - b).map((x: number, i: number) => ({ x, y: i + 1 }));
  const validated = D.projects.map((p: any) => p.attempts.find((a: any) => a.validated && a.end_ms)?.end_ms).filter(Boolean)
    .sort((a: number, b: number) => a - b).map((x: number, i: number) => ({ x, y: i + 1 }));
  const cumulative = [block("cum-retries", lines(f, [[f.t("col.retries"), retries, S1]], { label: f.t("pr2.retries_title"), emptyText: f.t("empty.period") }), f.t("pr2.retries_title"), f.t("pr2.retries_note")),
    block("cum-validated", lines(f, [[f.t("outcome.validated"), validated, GOOD]], { label: f.t("pr2.validated_title"), emptyText: f.t("empty.period") }), f.t("pr2.validated_title"), f.t("pr2.validated_note"))];
  const key = legend([[f.t("outcome.validated"), GOOD], [f.t("outcome.failed"), BAD], [f.t("outcome.in_progress"), NEUTRAL]]);
  // each project's attempts on one row with its name, packed so the history fits the screen (owner, 2026-11-22); shown in
  // dev only until the owner says (2026-11-23): ravazque.info has the two cumulative charts alone
  const blocks: string[] = [];
  if (pg.dev) {
    const lanes = new Map<string, GanttItem[]>();
    for (const [lane, spans] of timelineLanes(D.projects.map((p: any) => (groupOf(p) === "outside" ? { ...p, group: "outside" } : p)), laneName)) {
      const name = lane || [...lanes.keys()].at(-1)!;
      if (!lanes.has(name)) lanes.set(name, []);
      for (const s of spans) lanes.get(name)!.push(s as any);
    }
    const groups = [...lanes].map(([lane, spans]) => {
      const byProject = new Map<any, any[]>();
      for (const s of spans as any[]) byProject.set(s.p, [...(byProject.get(s.p) || []), s.a]);
      const items: GanttItem[] = [...byProject].map(([p, atts]) => ({ name: shortProject(p.name, 24), tip: [p.name, ...atts.map((a: any) => attemptTip(p, a).split(" · ").slice(1).join(" · "))].join("\n---\n"),
        spans: atts.map((a: any) => [a.start_ms, a.end_ms || a.start_ms, colour(a), attemptTip(p, a)]) }));
      // the parts of a work experience are one internship: one row, by the shortest name (the whole one, not a part)
      return [lane, lane === laneName("work") && items.length > 1 ? [{ name: items.map((x) => x.name).sort((x, y) => x.length - y.length)[0],
        tip: items.map((x) => x.tip).join("\n---\n"), spans: items.flatMap((x) => x.spans).sort((x, y) => x[0] - y[0]) }] : items] as [string, GanttItem[]];
    });
    blocks.push(`<div class="block" data-panel="timeline"><div class="block-head"><h3>${esc(f.t("projects.timeline_title"))}</h3>${key}</div>`
      + `${gantt(f, groups, { label: f.t("projects.timeline_aria"), emptyText: f.t("empty.period") })}</div>`);
  }
  out.push({ id: "timeline", nav: f.t(pg.dev ? "nav.projects" : "projects.title"), html: section("timeline", f.t("projects.title"), cols(...blocks, ...cumulative)) });
  return out;
}

/** The attempts line's rows: one per milestone (then OuterCore, work experience, the Piscine, anything else), not per
 * project, with every attempt of its projects; attempts that overlap in time go on a row under it (no label). Exams
 * are left out: they have their own table. */
export function timelineLanes(projects: any[], label: (lane: string) => string): [string, { name: string; p: any; a: any }[]][] {
  const lanes = new Map<string, { name: string; p: any; a: any }[]>();
  for (const p of projects) {
    if (p.exam) continue;
    const lane = p.track === "piscine" ? "piscine" : /^Work Exp/i.test(p.name) ? "work" : p.group || "other";
    if (!lanes.has(lane)) lanes.set(lane, []);
    for (const a of p.attempts) lanes.get(lane)!.push({ name: p.name, p, a });
  }
  const order = [...PROJECT_GROUPS.filter((g) => g !== "piscine" && g !== "outside"), "work", "outside", "piscine", "other"];
  const out: [string, { name: string; p: any; a: any }[]][] = [];
  for (const lane of [...lanes.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const rows: { end: number; spans: { name: string; p: any; a: any }[] }[] = [];
    for (const s of lanes.get(lane)!.sort((x, y) => x.a.start_ms - y.a.start_ms)) {
      const end = Math.max(s.a.end_ms || s.a.start_ms, s.a.start_ms);
      const row = rows.find((r) => r.end <= s.a.start_ms) || rows[rows.push({ end: 0, spans: [] }) - 1];
      row.spans.push(s);
      row.end = end;
    }
    rows.forEach((r, i) => out.push([i ? "" : label(lane), r.spans]));
  }
  return out;
}

/** "You are ahead of 7 in 10 of your promo": the share of the others strictly below you, in tenths; nothing when no one is. */
function promoFinding(pg: Page, promo: any): string {
  const n = Math.round(aboveShare(promo, promo.percentile) / 10);
  return n > 0 ? `<p class="finding">${pg.f.t("pr2.promo_finding", { n: pg.f.num(n) })}</p>` : "";
}

/** Your promo by level, your level's bar in the accent. */
function promoChart(pg: Page, promo: any) {
  const f = pg.f;
  const hist = new Map<number, number>(promo.histogram.map((h: any) => [h.level, h.count]));
  const keys = [...hist.keys()];
  const levels = keys.length ? Array.from({ length: Math.max(...keys) - Math.min(...keys) + 1 }, (_, i) => Math.min(...keys) + i) : [];
  const mine = Math.floor(promo.mine);
  const tips = levels.map((lv) => [f.t("standing.level_tip", { level: lv }), f.plural(hist.get(lv) || 0, "standing.n_students"), ...(lv === mine ? [f.t("standing.you_here")] : [])].join(" · "));
  // below you and above you in two tones, your level marked by a line and "You" (owner's pick 2026-11-20: your bar alone may be a sliver)
  const part = (keep: (lv: number) => boolean) => levels.map((lv) => (keep(lv) ? hist.get(lv) || 0 : 0));
  return vbars(f, levels.map(String), [[f.t("standing.below_you"), part((lv) => lv < mine), S2], [f.t("standing.your_level"), part((lv) => lv === mine), S1],
    [f.t("standing.above_you"), part((lv) => lv > mine), ABOVE]], { label: f.t("standing.promo"), stacked: true, four: true, colTips: true, fmt: (v) => f.num(v), tips, mark: [levels.indexOf(mine), f.t("network.key_me")] });
}

/** Technical domains: the skills 42's transcript gives your validated projects, or the RNCP domains, one at a time (RNCP
 * first when you have any, owner 2026-11-23), each row across the whole width with the projects and the XP they add up to
 * (a project counts in each of its skills or domains). RNCP: a square per validated project, out of the longest list (ten
 * at least). Skills: twenty squares lit by the skill's level on the radar's scale, a square per 5 % (owner, 2026-11-23).
 * Returns the body and the Skills | RNCP switch (by the title from 600px; on phones under the title's line). */
function domainsBody(pg: Page): [string, (cls: string) => string] {
  const f = pg.f, areas: any[] = pg.v.derive?.domains || [];
  const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
  const xpOf = new Map<string, number>(pg.D.projects.filter((p: any) => p.validated === true).map((p: any) => [p.name, p.xp_earned || 0]));
  const lists = {
    skills: skillRows(pg.D).map(([label, projects]) => ({ label, projects, xp: projects.reduce((t, n) => t + (xpOf.get(n) || 0), 0) })),
    rncp: areas.map((a) => ({ label: cap(f.t(`domains.tag.${a.key}`)), projects: a.projects as string[], xp: a.xp as number })),
  };
  const show = pg.q("domains", lists.rncp.length ? "rncp" : "skills", ["skills", "rncp"]) as "skills" | "rncp";
  const radarItems = radarSkills(pg), top = radarTop(radarItems), SQUARES = 20;
  const levelOf = new Map(radarItems.map((s) => [s.name, s.level || 0]));
  const of = show === "skills" ? SQUARES : Math.max(10, ...lists.rncp.map((r) => r.projects.length));
  const rows: SeatRow[] = lists[show].map((r) => ({ ...r, level: levelOf.get(r.label) || 0 }))
    .sort((a, b) => (show === "skills" ? b.level - a.level : 0) || b.projects.length - a.projects.length || b.xp - a.xp).map((r) => {
      const end = f.plural(r.projects.length, "domains.projects") + (r.xp ? ` · ≈ ${f.num(r.xp)} XP` : ""); // work experience parts carry none
      const note = show === "skills" ? f.t("domains.level_tip", { level: f.level(r.level), pct: f.num(Math.round((100 * r.level) / top)), top: f.num(top) }) : "";
      return { label: r.label, n: show === "skills" ? Math.min(SQUARES, Math.round((SQUARES * r.level) / top)) : r.projects.length, end, note,
        tip: `${r.label}\n${note ? `${note}\n` : ""}${end}\n---\n${r.projects.join("\n")}` };
    });
  const sw = (cls: string) => pg.seg("domains", [["skills", f.t("domains.skills_title")], ["rncp", f.t("domains.rncp_title")]], show, f.t("domains.title"), "domains", `dom-switch ${cls}`);
  const chart = seatbars(rows, { label: f.t(`domains.${show}_title`), of, emptyText: f.t("domains.none") });
  return [cols(`<div class="block" data-panel="domains">${sw("under-title")}${chart}</div>`), sw];
}
