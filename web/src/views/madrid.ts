// The Campus side (owner, 2026-11-26): 42 Madrid as the weekly count sees it, apart from your own pages. Summary (last
// week, the twelve before it, who is here) and Exams (how each exam of both tracks and of the Piscine goes, and you);
// Projects and Piscine are holygraph.ts' campus figures. Every figure under 5 people says so; every tip says how it counts.
import { esc, tipAttr } from "../lib/h";
import { vbars, legend, waffle, S1, GOOD, BAD } from "../lib/charts";
import { table, type Col } from "../lib/table";
import { cohortsSection } from "./holygraph";
import { type Page, type Section, cols, block, info, myTrack, section } from "./page";

type Count = number | null | undefined;
const num = (v: Count) => v ?? 0;

/** "16 – 22 Nov 2026" */
const span = (pg: Page, from: string, to: string) => `${pg.f.day(from).replace(/ \d{4}$/, "")} – ${pg.f.day(to)}`;

/** No count yet (or one from before the figures asked for): one line saying so. */
const none = (pg: Page, id: string): Section[] => [{ id, nav: "", html: section(id, pg.f.t("campus.none_title"), `<p class="note">${esc(pg.f.t("campus.none"))}</p>`) }];

/** When the figures were counted and when they are counted again (every Monday). */
const when = (pg: Page, S: any) => `<p class="note">${esc(pg.f.t("campus.when", { date: pg.f.stamp(Date.parse(S.generated_at)) }))}</p>`;

/** Campus · Summary: last week in six figures, the twelve weeks before it, then who is here by start year. */
export function summaryPage(pg: Page, S: any): Section[] {
  const f = pg.f;
  if (!S?.generated_at) return none(pg, "week");
  const n = (v: Count) => (v === null ? f.t("holy.under5") : f.num(num(v)));
  const out: Section[] = [];
  const W = S.week;
  if (W) {
    const how = (key: string) => ["---", `# ${f.t("campus.how")}`, ...(f.raw(key) as string[]), f.t("campus.how_optout"), f.t("campus.how_under5")];
    const mod = (title: string, value: string, sub: string, tip: string[]) =>
      `<div${tipAttr([`${title} · ${span(pg, W.from, W.to)}`, ...tip].join("\n"))}><h3>${esc(title)}</h3><p class="v">${value}</p>${sub ? `<p class="s">${esc(sub)}</p>` : ""}</div>`;
    const exams = num(W.exams_passed) + num(W.exams_failed), marks = num(W.passed) + num(W.failed);
    // "6 in 10 of the projects marked": no share when either figure is under 5
    const marked = (v: Count) => (v == null || W.passed == null || W.failed == null || !marks ? "" : f.t("md2.w_share", { share: f.pct(v, marks) }));
    const mods = [
      mod(f.t("campus.w_evals"), esc(n(W.evaluations)), W.per_student != null ? f.t("campus.w_per", { n: f.num(W.per_student, 1) }) : "",
        [f.t("campus.t_evals", { n: n(W.evaluations), per: W.per_student != null ? f.num(W.per_student, 1) : f.t("holy.under5"), students: n(W.students) }), ...how("campus.how_evals")]),
      mod(f.t("campus.w_passed"), esc(n(W.passed)), marked(W.passed), [f.t("campus.t_passed", { n: n(W.passed) }), ...how("campus.how_projects")]),
      mod(f.t("campus.w_failed"), esc(n(W.failed)), marked(W.failed), [f.t("campus.t_failed", { n: n(W.failed) }), ...how("campus.how_projects")]),
      mod(f.t("campus.w_exams"), esc(n(W.exams_passed)), f.t("campus.w_exams_sub", { failed: n(W.exams_failed) }),
        [f.t("campus.t_exams", { passed: n(W.exams_passed), failed: n(W.exams_failed), share: W.exams_passed != null && W.exams_failed != null && exams ? f.pct(num(W.exams_passed), exams) : "–" }), ...how("campus.how_exams")]),
      mod(f.t("campus.w_out"), esc(n(W.outstanding)), f.t("campus.w_flags", { n: n(W.negative_flags) }),
        [f.t("campus.t_out", { out: n(W.outstanding), flags: n(W.negative_flags) }), ...how("campus.how_flags")]),
      mod(f.t("campus.w_bh"), esc(n(W.blackholed)), f.t("md2.w_bh_sub"), [f.t("campus.t_bh", { n: n(W.blackholed) }), ...how("campus.how_bh")]),
    ];
    out.push({ id: "week", nav: f.t("campus.week"), html: section("week", f.t("campus.week"), `<div class="kpis six">${mods.join("")}</div>${when(pg, S)}`, { count: span(pg, W.from, W.to) }) });
  } // a count from before the weekly figures: no empty section (user test, 2026-11-27); they come with the next count
  const weeks: any[] = S.weeks || [];
  if (weeks.length) {
    const labels = weeks.map((w) => f.day(w.from).replace(/ \d{4}$/, ""));
    const v = (k: string) => weeks.map((w) => num(w[k]));
    const tip = (w: any, lines: string[]) => [f.t("campus.t_week", { from: f.day(w.from) }), ...lines].join("\n");
    const evals = vbars(f, labels, [[f.t("campus.w_evals"), v("evaluations"), S1]], { label: f.t("campus.trend_evals"), four: true,
      tips: weeks.map((w) => tip(w, [f.t("campus.t_evals_week", { n: n(w.evaluations) })])), emptyText: f.t("campus.none") });
    const projects = vbars(f, labels, [[f.t("campus.w_passed"), v("passed"), GOOD], [f.t("campus.w_failed"), v("failed"), BAD]], { label: f.t("campus.trend_projects"), four: true,
      tips: weeks.map((w) => tip(w, [f.t("campus.t_passed", { n: n(w.passed) }), f.t("campus.t_failed", { n: n(w.failed) })])), colTips: true, emptyText: f.t("campus.none") });
    out.push({ id: "trend", nav: f.t("campus.trend"), html: section("trend", f.t("campus.trend"), cols(
      block("trend-evals", evals, f.t("campus.trend_evals"), f.t("campus.trend_evals_note")),
      `<div class="block" data-panel="trend-projects"><div class="block-head"><h3>${esc(f.t("campus.trend_projects"))} ${info(f.t("campus.trend_projects_note"))}</h3>`
        + `${legend([[f.t("campus.w_passed"), GOOD], [f.t("campus.w_failed"), BAD]])}</div>${projects}</div>`)) });
  }
  const p = S.people;
  if (p) out.push({ id: "people", nav: f.t("campus.people"), html: section("people", f.t("campus.people"),
    `<p class="hg-lead">${esc(f.t("holy.people_line", { total: n(p.total), active: n(p.by_state?.active), bh: n(p.by_state?.blackholed), tr: n(p.by_state?.transcender), al: n(p.by_state?.alumni) }))}</p>`
    + `<p class="note">${esc(f.t("campus.people_note"))}</p>`) });
  const cohorts = cohortsSection(pg, S);
  if (cohorts) out.push(cohorts);
  return out;
}

type Exam = { slug: string; name: string; registered?: Count; passed?: Count; attempts?: Count; failed_attempts?: Count; first_try?: Count; tries?: Count[]; median_days?: number | null };

const RANK = /^(?:42next-)?exam-rank-0(\d)$/;

/** Campus · Exams: each exam of the C and Python Common Core (how many fail, pass the first time, how long it takes, you),
 * then the Piscine's. */
export function examsPage(pg: Page, S: any): Section[] {
  const f = pg.f;
  if (!S?.generated_at) return none(pg, "exams-c");
  const n = (v: Count) => (v === null ? f.t("holy.under5") : v === undefined ? "–" : f.num(v));
  const share = (a: Count, b: Count) => (a === null || b === null ? f.t("holy.under5") : num(b) ? f.pct(num(a), num(b)) : "–");
  const ratio = (a: Count, b: Count) => (a === null || b === null || !num(b) ? null : num(a) / num(b));
  // yours, from your report: the sitting you passed it in, or how many you have sat
  const mine = new Map<string, any>(pg.allProjects.filter((p: any) => p.exam).map((p: any) => [p.slug, p]));
  const you = (e: Exam) => {
    const p = mine.get(e.slug);
    if (!p?.attempts?.length) return "";
    const at = p.attempts.findIndex((a: any) => a.validated === true);
    return at >= 0 ? f.t("campus.you_passed", { n: at + 1 }) : f.plural(p.attempts.length, "campus.you_sat");
  };
  const triesWaffle = (e: Exam) => {
    const t = (e.tries || []).map(num);
    if (!t.some((v) => v) || (e.tries || []).some((x) => x === null)) return "";
    return `<h3 class="wf-title">${esc(f.t("md2.waffle_title", { exam: e.name }))}</h3>`
      + waffle(t.map((v, i) => ({ label: f.t(i === 3 ? "campus.k_try_more" : "campus.k_try", { n: i + 1 }), value: v, color: `var(--cat-${i + 1})` })), { label: f.t("md2.waffle_title", { exam: e.name }), num: (v) => f.num(v), note: f.t("wf.note") });
  };
  // the five columns that answer "is it hard?"; who signed up and how many sittings go in the exam's tip
  const rowTip = (e: Exam) => tipAttr(f.t("s3m.row_tip", { exam: e.name, registered: n(e.registered), sittings: n(e.attempts) }));
  const colsOf = (withYou: boolean): Col<Exam>[] => [
    { k: "name", t: f.t("col.exam"), nw: true, f: (e) => `<span${rowTip(e)}>${esc(e.name)}</span>` },
    { k: "passed", t: f.t("campus.c_passed"), num: true, nw: true, sv: (e) => ratio(e.passed, e.registered), f: (e) => esc(share(e.passed, e.registered)) },
    { k: "failed_attempts", t: f.t("campus.c_failed"), num: true, sv: (e) => ratio(e.failed_attempts, e.attempts), f: (e) => esc(share(e.failed_attempts, e.attempts)) },
    { k: "first_try", t: f.t("campus.c_first"), num: true, sv: (e) => ratio(e.first_try, e.passed), f: (e) => esc(share(e.first_try, e.passed)) },
    { k: "median_days", t: f.t("campus.c_days"), num: true, f: (e) => esc(e.median_days == null ? "–" : f.num(e.median_days, Number.isInteger(e.median_days) ? 0 : 1)) },
    ...(withYou ? [{ k: "you", t: f.t("campus.c_you"), nw: true, sv: (e: Exam) => you(e), f: (e: Exam) => esc(you(e) || "–") }] : []),
  ];
  const head = (title: string, note: string) => `<h2>${esc(title)} ${info(note)}</h2>`;
  const out: Section[] = [];
  let first = true;
  for (const track of ["c", "python"] as const) {
    const rows: Exam[] = (S.projects || []).filter((p: any) => p.track === track && RANK.test(p.slug)).sort((a: any, b: any) => a.slug.localeCompare(b.slug));
    if (!rows.length) continue;
    // the hardest: the most sittings that failed, among the exams with a share to show
    const hard = rows.filter((e) => ratio(e.failed_attempts, e.attempts) !== null).sort((a, b) => ratio(b.failed_attempts, b.attempts)! - ratio(a.failed_attempts, a.attempts)!)[0];
    const lede = hard ? f.t("campus.exams_lede", { exam: esc(hard.name), failed: `<b>${esc(share(hard.failed_attempts, hard.attempts))}</b>`, first: esc(share(hard.first_try, hard.passed)), days: esc(hard.median_days == null ? "–" : f.num(hard.median_days, 1)) }) : "";
    const tbl = table(f, colsOf(rows.some((e) => mine.has(e.slug))), rows, { label: f.t(`campus.exams_${track}`), sort: ["name", 1] });
    const showFirst = first;
    first = false;
    out.push({ id: `exams-${track}`, nav: f.t(`campus.exams_${track}`), html: section(`exams-${track}`, "",
      (lede ? `<p class="finding">${lede}</p>` : "") + (showFirst ? `<p class="note">${esc(f.t("md2.under5"))}</p>` : "") + `<div class="table-wrap">${tbl}</div>` + (hard ? triesWaffle(hard) : ""), { head: head(f.t(`campus.exams_${track}`) + (track === (myTrack(pg.D.extras) || "c") ? ` · ${f.t("s4.yours")}` : ""), f.t("campus.exams_note")) }) }); // which track is yours (user test)
  }
  const pis: any[] = (S.piscine?.projects || []).filter((p: any) => /^c-piscine-(?:exam-0\d|final-exam)$/.test(p.slug)).sort((a: any, b: any) => a.slug.localeCompare(b.slug));
  if (pis.length) {
    const tbl = table(f, [
      { k: "name", t: f.t("col.exam"), nw: true, f: (e: any) => esc(String(e.name).replace(/^C Piscine /, "")) },
      { k: "passed", t: f.t("campus.c_passed"), num: true, sv: (e: any) => ratio(e.passed, e.registered), f: (e: any) => esc(share(e.passed, e.registered)) },
      { k: "median_mark", t: f.t("s3m.c_mark"), num: true, f: (e: any) => (e.median_mark == null ? "–" : `<span${tipAttr(f.t("s3m.mark_tip"))}>${esc(f.num(e.median_mark))}</span>`) },
    ], pis, { label: f.t("campus.exams_piscine"), sort: ["name", 1] });
    out.push({ id: "exams-piscine", nav: f.t("campus.exams_piscine"), html: section("exams-piscine", "", `<div class="table-wrap">${tbl}</div>${when(pg, S)}`,
      { head: head(f.t("campus.exams_piscine"), f.t("campus.exams_piscine_note")) }) });
  }
  return out.length ? out : none(pg, "exams-c");
}
