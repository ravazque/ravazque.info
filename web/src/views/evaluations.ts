// Evaluations: what you give back and by milestone, the full log, cancelled evaluations, correction points, feedback,
// and received and given over time, when and how long.
import type { Fmt } from "../fmt";
import { GOOD, BAD, NEUTRAL, OUTSTANDING, S1, S2, type Series, legend, lines, qline, vbars, waffle } from "../lib/charts";
import { ACCENT, GROUPS, SLATE, groupDot, heat } from "../lib/graphs";
import { ARROW, avatar, badge, esc, tipAttr } from "../lib/h";
import { facts, table } from "../lib/table";
import { KINDS, Page, Section, block, cols, failed, filters, flagBadge, redMark, headBlock, info, kpis, monthsBetween, negativeFlags, noMark, radios, search, section, select, shownLogin, erased, fillTable, projectName } from "./page";
import tracks from "@data/tracks.json";

/** Common Core project slug → its milestone (rank-00…rank-06), C and Python tracks alike. */
const MILESTONE = new Map(Object.entries(tracks.common_core as Record<string, string[]>).flatMap(([rank, slugs]) => slugs.map((s) => [s, rank] as [string, string])));
const MILESTONES = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "other"];

/** An evaluation's project by milestone: the Common Core's from its list, the rest of the 42cursus OuterCore, anything
 * else (the Piscine, other cursus) other. */
export const milestoneOf = (e: any) => MILESTONE.get(e.slug) || ((e.cursus || []).includes("42cursus") ? "outer-core" : "other");

/** A period's evaluations by when you took part, not by the project (owner, 2026-11-19, the log too since 2026-11-20): the
 * report files a rush you corrected as a student under the Piscine; the student view hands those over (piscine_as_student)
 * and the Piscine keeps what came before the 42cursus kickoff. Feedback and the log read it; the counts and charts don't. */
export function tookPart(pg: Page, k: "received" | "given"): any[] {
  const D = pg.D, kick = (pg.v.all_cursus || D.extras?.cursus || []).find((c: any) => c.name === "42cursus")?.begin || "";
  return pg.period === "student" ? [...D[k], ...(pg.v.piscine_as_student?.[k] || [])]
    : pg.period === "piscine" && kick ? D[k].filter((e: any) => !(e.begin >= kick)) : D[k];
}

/** A histogram's bins from its edges, each with its unit: "0–1h", "1–3h", "3+h". */
export const binLabels = (edges: number[], unit: string) => edges.map((x, i) => `${i < edges.length - 1 ? `${x}–${edges[i + 1]}` : `${x}+`}${unit}`);

/** A section's finding, said first: the text of `key` with every value in `vars` in bold, all else escaped. */
export const say = (f: Fmt, key: string, vars: Record<string, string | number>) =>
  `<p class="finding">${esc(f.t(key, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, `\u0001${v}\u0002`])))).replace(/\u0001/g, "<b>").replace(/\u0002/g, "</b>")}</p>`;

/** The evaluations behind a histogram's long bars (bins from `from` on), for their tips: "project · the other side · value",
 * longest first, at most eight and "+N more". Durations count finished evaluations only, as the server's histogram does. */
export function longOnes(f: Fmt, evs: any[], role: "received" | "given", key: "duration_min" | "lead_h", edges: number[], from: number): string[][] {
  const out: any[][] = edges.map(() => []);
  for (const e of key === "duration_min" ? evs.filter((e) => e.status === "done") : evs) {
    const v = e[key];
    if (typeof v !== "number" || v < from) continue;
    out[Math.max(0, edges.findLastIndex((x) => x <= v))].push(e);
  }
  const name = (login: string) => (erased(login) ? f.t("who.erased_name") : login || "?");
  const who = (e: any) => (role === "received" ? name(e.corrector?.login)
    : `${name(e.correcteds?.[0]?.login)}${(e.correcteds?.length || 0) > 1 ? ` +${e.correcteds.length - 1}` : ""}`);
  const value = (v: number) => (key === "lead_h" ? f.nb(v, "h") : f.t("unit.min", { n: f.num(v) }));
  return out.map((bin) => {
    const lines = bin.sort((a, b) => b[key] - a[key]).slice(0, 8).map((e) => `${e.project} · ${who(e)} · ${value(e[key])}`);
    return bin.length > 8 ? [...lines, f.t("common.plus_more", { n: bin.length - 8 })] : lines;
  });
}

/** By milestone with the deleted accounts on a row of their own: the report counts them with whoever has no 42cursus. The
 * evaluations themselves all stay. */
export function deletedApart(byGroup: Record<string, any>, received: any[], given: any[], me?: string): Record<string, any> {
  const row = { received: 0, received_out: 0, given: 0, given_out: 0 };
  for (const e of received) if (erased(e.corrector?.login)) { row.received++; if (e.outstanding) row.received_out++; }
  for (const e of given) for (const c of e.correcteds || []) if (c.login !== me && erased(c.login)) { row.given++; if (e.outstanding) row.given_out++; }
  if (!row.received && !row.given) return byGroup;
  const { "no-cursus": rest = {}, ...others } = byGroup;
  const left = { received: (rest.received || 0) - row.received, received_out: (rest.received_out || 0) - row.received_out, given: (rest.given || 0) - row.given, given_out: (rest.given_out || 0) - row.given_out };
  return { ...others, ...(left.received > 0 || left.given > 0 ? { "no-cursus": left } : {}), deleted: row };
}

/** By milestone with the staff on a row of their own: the report counts each of them in the group their account has (no
 * cursus, or the one they once studied in), told by `groupOf` (the view's connections). Nothing is lost on the way. */
export function staffApart(byGroup: Record<string, any>, received: any[], given: any[], me: string | undefined, groupOf: Map<string, string>): Record<string, any> {
  const out: Record<string, any> = Object.fromEntries(Object.entries(byGroup).map(([g, r]) => [g, { ...r }]));
  const row = { received: 0, received_out: 0, given: 0, given_out: 0 };
  const move = (p: any, k: "received" | "given", outstanding: boolean) => {
    if (!p?.staff || erased(p.login) || p.login === me) return;
    const from = out[groupOf.get(p.login) || "no-cursus"];
    for (const key of outstanding ? [k, `${k}_out`] : [k]) { (row as any)[key]++; if (from) from[key] = Math.max(0, (from[key] || 0) - 1); }
  };
  for (const e of received) move(e.corrector, "received", !!e.outstanding);
  for (const e of given) for (const c of e.correcteds || []) move(c, "given", !!e.outstanding);
  if (!row.received && !row.given) return byGroup;
  for (const g of Object.keys(out)) if (!out[g].received && !out[g].given) delete out[g];
  return { ...out, staff: row };
}

export function evaluations(pg: Page): Section[] {
  const f = pg.f, D = pg.D, S = D.summary, W = D.when;
  const out: Section[] = [];
  const me = D.profile.login;
  const received = tookPart(pg, "received"), given = tookPart(pg, "given");
  // as a student, the 42cursus, the Piscine's projects and a Piscine Reload count: Discovery piscines are set apart below
  const counts = (e: any) => pg.period !== "student" || !Array.isArray(e.cursus) || e.cursus.some((c: string) => c === "42cursus" || c === "C Piscine" || /reload/i.test(c));
  // 42's automatic feedback (the student did not fill theirs in) is nobody's opinion: out of the averages and the list
  const real = (e: any) => e.feedbacks.filter((x: any) => !autoFeedback(x));
  const theirs = given.filter(counts).flatMap(real);
  const avg = (fbs: any[], k: string) => { const v = fbs.map((x) => x[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // your rating as evaluator is Feedback's (the same ratings, a rush corrected as a student among them), not the report's,
  // which leaves those rushes in the Piscine
  const myRating = avg(theirs, "rating"), myRated = theirs.filter((x: any) => x.rating !== null && x.rating !== undefined).length;
  const role = pg.q("role", "received", ["received", "given"]);
  const m = W[`${role}_monthly`];
  // negative flags only when there are some, a full stop only after them (owner, 2026-11-24)
  const negatives = role === "received" ? S.received_negative : S.given_negative;
  const lede = (role === "received"
    ? f.t("received.lede", { mark: f.num(S.received_avg_mark, 1), pct: f.pct(S.received_outstanding, S.received) })
    : f.t("given.lede", { mark: f.num(S.given_avg_mark, 1) })) + (negatives ? ` · ${f.plural(negatives, "over_time.negatives")}.` : "");
  const bins: [string, (x: number) => boolean][] = [["0", (x) => x === 0], ["1–49", (x) => x > 0 && x < 50], ["50–79", (x) => x >= 50 && x < 80], ["80–99", (x) => x >= 80 && x < 100],
    ["100", (x) => x === 100], ["101–124", (x) => x > 100 && x < 125], ["125", (x) => x >= 125]];
  const count = (evs: any[]) => bins.map(([, ok]) => evs.filter((e) => e.mark !== null && e.mark !== undefined && ok(e.mark)).length);
  const roles: [string, string][] = [[f.t("role.received"), S1], [f.t("role.given"), S2]];
  const cm = pg.v.derive?.community || { hours: 0, people: 0, correctors: 0 };

  // correction statistics live in Contribution
  let statBlocks: string[] = [], byGroup = "", groupFinding = "", fails = "";
  const st = D.stats;
  if (st) {
    const rate = (r: any, key: string) => `<div class="rate"><p class="v">${r.pct === null || r.pct === undefined ? "–" : `${f.num(r.pct, 1)}<small>%</small>`}`
      + `<span class="frac">${esc(f.t("stats.of", { n: r.n, total: r.total }))}</span></p>${waffle([{ label: f.t("ev2.failed"), value: r.n, color: BAD }, { label: f.t("ev2.rest"), value: r.total - r.n, color: NEUTRAL }], { label: f.t(key), num: (v) => f.num(v), note: f.t("wf.note") })}<p class="k">${esc(f.t(key))}</p></div>`;
    const recip = (n: number, total: number, text: string) => `<div class="recip-row">${waffle([{ label: f.t("ev2.back"), value: n, color: OUTSTANDING }, { label: f.t("ev2.not_back"), value: total - n, color: NEUTRAL }], { label: text, num: (v) => f.num(v), note: f.t("wf.note") })}<p class="s">${esc(text)}</p></div>`;
    const R = st.outstanding_reciprocity;
    // every group, always, in order (as Points by source has every source): the ones with nothing greyed
    const groupOf = new Map<string, string>((pg.v.connections || []).map((c: any) => [c.login, c.group]));
    const by = staffApart(deletedApart(st.by_group || {}, D.received, D.given, D.profile?.login), D.received, D.given, D.profile?.login, groupOf), none = { received: 0, received_out: 0, given: 0, given_out: 0 };
    // staff, deleted accounts and pisciners only when you met any (owner, 2026-11-12 and 13)
    const groups = [...new Set([...GROUPS, ...Object.keys(by)])].filter((g) => !["staff", "deleted", "no-cursus"].includes(g) || by[g]).map((g) => ({ g, ...none, ...by[g] })).map((v: any) => ({ ...v, i: GROUPS.includes(v.g) ? GROUPS.indexOf(v.g) : 99,
      in_pct: v.received ? (100 * v.received_out) / v.received : null, out_pct: v.given ? (100 * v.given_out) / v.given : null }));
    const top = [...groups].sort((a: any, b: any) => b.received - a.received)[0], totalIn = groups.reduce((s: number, g: any) => s + g.received, 0);
    if (top && top.received) groupFinding = say(f, "ev2.find_group", { n: top.received, total: totalIn, group: f.t(`groups.${top.g}`) });
    const sentence = (r: any, key: string) => (r.total ? say(f, key, { b: f.t("ev2.of_the", { n: r.n, total: r.total }) }) : "");
    fails = sentence(st.failed_given, "ev2.find_given") + sentence(st.failed_received, "ev2.find_received");
    const pctCell = (v: number | null) => (v === null ? "–" : `${f.num(v)}%`);
    statBlocks = [
      block("fail-rates", `<div class="rates">${rate(st.failed_given, "stats.failed_given")}${rate(st.failed_received, "stats.failed_received")}`
        + `<div class="rate recip"><h3>${esc(f.t("stats.reciprocity_title"))}</h3>${recip(R.i_gave_back, R.gave_me, f.t("stats.recip_in", { back: R.i_gave_back, gave_me: R.gave_me }))}`
        + `${recip(R.they_gave_back, R.i_gave, f.t("stats.recip_out", { back: R.they_gave_back, i_gave: R.i_gave }))}</div></div>`)];
    byGroup = `<div class="block" data-panel="by-group"><h3>${esc(f.t("nav.by_group"))}</h3><div class="table-wrap">${table(f, [
        { k: "i", t: f.t("col.group"), nw: true, f: (r) => groupDot(r.g) + esc(f.t(`groups.${r.g}`)) },
        { k: "received", t: f.t("col.received"), s: f.t("abbr.received"), num: true, nw: true },
        { k: "in_pct", t: f.t("col.out_pct"), s: f.t("abbr.out_pct"), num: true, nw: true, f: (r) => pctCell(r.in_pct) },
        { k: "given", t: f.t("col.given"), s: f.t("abbr.given"), num: true, nw: true },
        { k: "out_pct", t: f.t("col.out_pct"), s: f.t("abbr.out_pct"), num: true, nw: true, f: (r) => pctCell(r.out_pct) },
      ], groups, { label: f.t("stats.group_title"), sort: ["i", 1], rowCls: (r) => (r.received || r.given ? "" : "zero") })}</div></div>`;
  }

  out.push({ id: "community", nav: f.t("community.title"), html: section("community", f.t("community.title"), fails + cols(block("kpis", kpis([
    [f.t("community.k_hours"), `${esc(f.hmm(cm.hours))}&nbsp;h`, [esc(f.t("community.s_hours", { n: f.num(D.given.length) }))]],
    [f.t("community.k_people"), f.num(cm.people), [esc(f.t("community.s_people"))]],
    [f.t("community.k_correctors"), f.num(cm.correctors), [esc(f.t("community.s_correctors"))]],
    [f.t("community.k_rating"), myRating !== null ? f.num(myRating, 2) : "–", [esc(f.t("community.s_rating", { n: f.num(myRated) }))]],
  ])), ...statBlocks)) });
  // by the other person's milestone, and beside it, small, the projects you corrected
  const corrected = `<div class="block" data-panel="depth-projects" id="in-depth"><h3>${esc(f.t("depth.given_title"))}</h3>`
    + `<div class="table-wrap fit">${correctedTable(pg)}${fillTable()}</div></div>`; // as tall as the table by milestone
  out.push({ id: "by-group", nav: f.t("stats.group_section"), html: section("by-group", "", groupFinding + cols(byGroup, corrected),
    { head: `<h2>${esc(f.t("stats.group_section"))} ${info(f.t("stats.group_note"))}</h2>` }) });

  // by the title; on phones under its line, over the description (owner, 2026-11-23)
  const sw = (cls: string) => pg.seg("role", [["received", f.t("role.received")], ["given", f.t("role.given")]], role, f.t("log.role_label"), "over-time", cls);
  const reportDay = pg.asOf ? Date.parse(`${pg.asOf}T12:00:00Z`) : undefined; // the cumulative lines carry on to it
  // the months up to the report's, the quiet ones as zero
  const months: string[] = W.months.length ? monthsBetween(W.months[0], [W.months[W.months.length - 1], pg.asOf.slice(0, 7)].sort()[1]) : [];
  const at = (vals: number[]) => months.map((x) => vals[W.months.indexOf(x)] || 0);
  // each month's tip names its negative flags
  const flagSeries: [string, number[], string][] = [[f.t("flag.ok"), at(m.ok), GOOD], [f.t("flag.outstanding"), at(m.outstanding), OUTSTANDING], [f.t("flag.negative"), at(m.negative), BAD]];
  const negs = negativeFlags(D[role]);
  const flagTips = months.map((x, i) => [f.monthLabel(x), ...flagSeries.map(([n, v], s) => `${n} ${f.num(v[i])}` + (s === 2 && negs.get(x) ? `: ${negs.get(x)}` : ""))].join("\n"));
  const perMonth = W.months.map((_: string, i: number) => (m.ok[i] || 0) + (m.outstanding[i] || 0) + (m.negative[i] || 0));
  const peak = Math.max(0, ...perMonth);
  const monthFinding = peak ? say(f, `ev2.find_month_${role}`, { month: f.monthLabel(W.months[perMonth.indexOf(peak)]), n: peak }) : "";
  out.push({ id: "over-time", nav: f.t("over_time.title"), html: section("over-time", "", monthFinding + cols(
    headBlock("recv-monthly", f.t(role === "received" ? "received.monthly_title" : "given.monthly_title"),
      legend([[f.t("flag.ok"), GOOD], [f.t("flag.outstanding"), OUTSTANDING], [f.t("flag.negative"), BAD]]),
      vbars(f, months.map((x: string) => f.monthLabel(x)), flagSeries,
        { label: f.t("received.monthly_title"), stacked: true, colTips: true, fmt: (v) => f.num(v), tips: flagTips, emptyText: f.t("empty.period") })),
    headBlock("marks", f.t("received.marks_title"), legend(roles), vbars(f, bins.map(([b]) => b), [[f.t("role.received"), count(D.received), S1], [f.t("role.given"), count(D.given), S2]],
      { label: f.t("received.marks_title"), lanes: true, fmt: (v) => f.num(v), emptyText: f.t("empty.period") })),
    headBlock("cum-evals", f.t("received.cum_title"), legend(roles), lines(f, [[f.t("role.received"), W.cum_received, S1], [f.t("role.given"), W.cum_given, S2]],
      { label: f.t("received.cum_title"), emptyText: f.t("empty.period"), to: reportDay })),
    headBlock("cum-out", f.t("received.cum_out_title"), legend(roles), lines(f, [[f.t("received.out_received"), W.cum_out_received, S1], [f.t("received.out_given"), W.cum_out_given, S2]],
      { label: f.t("received.cum_out_title"), emptyText: f.t("empty.period"), to: reportDay }))),
  { head: `<div class="panel-head"><h2>${esc(f.t("over_time.title"))}</h2>${sw("wide-only")}</div>${sw("under-title")}`, lede: esc(lede) }) });

  const dp = D.insights?.evaluations;
  const dur = (d: any) => (d.avg === null || d.avg === undefined ? "–" : f.t("depth.minutes", { avg: f.num(d.avg), median: f.num(d.median) }));
  const factsHtml = dp ? `<dl class="facts">${facts([[f.t("depth.received_duration"), esc(dur(dp.received_duration))], [f.t("depth.given_duration"), esc(dur(dp.given_duration))],
    [f.t("depth.lead"), esc(dp.received_lead_h === null || dp.received_lead_h === undefined ? "–" : f.t("depth.hours", { h: f.hmm(dp.received_lead_h) }))],
    [f.t("depth.streak"), f.num(dp.outstanding_streak)]])}</dl>` : "";
  // each bar its own tip; the long ones (75 minutes or more, booked 3 hours or more ahead; owner 2026-11-23) name their evaluations
  const named = (labels: string[], series: Series[], key: "duration_min" | "lead_h", edges: number[], from: number) => {
    const lists = [longOnes(f, D.received, "received", key, edges, from), longOnes(f, D.given, "given", key, edges, from)];
    return series.map(([n, v], si) => labels.map((lab, i) => `${lab}\n${n}: ${f.num(v[i] || 0)}` + (lists[si][i].length ? `\n---\n${lists[si][i].join("\n")}` : "")));
  };
  const durLabels = binLabels(W.duration_edges, "m"), leadLabels = binLabels(W.lead_edges, "h");
  const durSeries: Series[] = [[f.t("role.received"), W.duration_received, S1], [f.t("role.given"), W.duration_given, S2]];
  const leadSeries: Series[] = [[f.t("role.received"), W.lead_received, S1], [f.t("role.given"), W.lead_given, S2]];
  const both = W.heat_received.map((row: number[], d: number) => row.map((v, h) => v + (W.heat_given[d]?.[h] || 0)));
  const top = Math.max(0, ...both.flat()), td = both.findIndex((row: number[]) => row.includes(top)), th = td < 0 ? 0 : both[td].indexOf(top);
  const whenFinding = top ? say(f, "ev2.find_when", { slot: `${f.weekdays[td]} ${String(th).padStart(2, "0")}:00`, n: top }) : "";
  out.push({ id: "when", nav: f.t("nav.when"), html: section("when", f.t("when.title"), whenFinding + factsHtml + cols(
    block("heat-recv", heat(f, W.heat_received, ACCENT, f.t("unit.evaluations")), f.t("when.heat_recv_title")),
    block("heat-given", heat(f, W.heat_given, SLATE, f.t("unit.evaluations")), f.t("when.heat_given_title")),
    `<div class="block" data-panel="duration"><div class="block-head"><h3>${esc(f.t("when.duration_title"))} ${info(f.t("when.duration_note"))}</h3>${legend(roles)}</div>` + vbars(f, durLabels, durSeries,
      { label: f.t("when.duration_title"), barTips: named(durLabels, durSeries, "duration_min", W.duration_edges, 75), fmt: (v) => f.num(v), emptyText: f.t("empty.period") }) + "</div>",
    headBlock("lead", f.t("when.lead_title"), legend(roles), vbars(f, leadLabels, leadSeries,
      { label: f.t("when.lead_title"), barTips: named(leadLabels, leadSeries, "lead_h", W.lead_edges, 3), fmt: (v) => f.num(v), emptyText: f.t("empty.period") }))),
  { lede: esc(f.t("when.lede", { recv: f.num(W.median_duration_received), given: f.num(W.median_duration_given), lead: f.num(W.median_lead_received, 1) })) }) });

  // feedback: the criteria both ways, and every rating under the maximum you got as a corrector
  // feedback's evaluations (received, given, counts, theirs) are set at the top: Contribution's rating reads them too
  const outside = [...received, ...given].filter((e: any) => !counts(e));
  const mine = received.filter(counts).flatMap((e: any) => e.feedbacks.filter((x: any) => x.by === me));
  const autos = given.filter((e: any) => e.feedbacks.some(autoFeedback)); // named apart below
  const below = (fbs: any[], k: string, top: number) => fbs.filter((x) => x[k] !== null && x[k] !== undefined && x[k] < top).length;
  let crit = "";
  if (!pg.light) {
    const rows = [["overall", "rating", 5] as const, ...KINDS.map((k) => [k, k, 4] as const)].map(([lab, k, top]) => ({
      label: `${f.t(`criterion.${lab}`)} (/${top})`, mineAvg: avg(mine, k), mineLow: below(mine, k, top),
      theirAvg: avg(theirs, k), theirLow: below(theirs, k, top) }));
    crit = table(f, [{ k: "label", t: f.t("col.criterion") },
      { k: "mineAvg", t: f.t("col.you_to_correctors", { n: mine.length }), num: true, f: (r) => `${f.num(r.mineAvg, 2)}<span class="sub">${esc(f.t("feedback.below_max", { n: r.mineLow }))}</span>` },
      { k: "theirAvg", t: f.t("col.evaluated_to_you", { n: theirs.length }), num: true, f: (r) => `${f.num(r.theirAvg, 2)}<span class="sub">${esc(f.t("feedback.below_max", { n: r.theirLow }))}</span>` }],
    rows, { label: f.t("feedback.criteria_title") });
  }
  // a given evaluation's ratings, each with its project and day
  const ratings = (e: any, keep: (x: any) => boolean) => e.feedbacks.filter((x: any) => keep(x) && x.rating !== null && x.rating !== undefined).map((x: any) => ({ ...x, project: e.project, begin: e.begin }));
  const isLow = (x: any) => x.rating < 5 || KINDS.some((k) => x[k] !== null && x[k] !== undefined && x[k] < 4);
  const rated = given.filter(counts).flatMap((e: any) => ratings(e, (x) => !autoFeedback(x)));
  const score = (x: any) => KINDS.reduce((s, k) => s + (x[k] ?? 4), 0);
  const low = rated.filter(isLow).sort((a: any, b: any) => a.rating - b.rating || score(a) - score(b));
  const meter = (label: string, n: number | null | undefined, top: number, tip = "") => {
    const pips = Array.from({ length: top }, (_, i) => `<i class="${n !== null && n !== undefined && i < n ? "on" : ""}"></i>`).join("");
    const shown = n === null || n === undefined ? "–" : n;
    return `<div class="${n !== null && n !== undefined && n < top ? "low" : ""}"><dt title="${esc(tip || label)}">${esc(label)}</dt>`
      + `<dd><span class="pips" role="img" aria-label="${esc(f.t("feedback.pips", { label, n: shown, max: top }))}">${pips}</span><b>${shown}<small>/${top}</small></b></dd></div>`;
  };
  const fbItem = (x: any, head: string) => `<li class="fb-item"><p class="fb-head"><span>${head}</span>`
    + `<span class="when">${esc(f.day(x.begin))}</span></p><dl class="fb-crit">${meter(f.t("feedback.overall"), x.rating, 5)}`
    + ["punctuality", "interested", "rigorous", "nice"].map((k) => meter(f.t(`feedback.c.${k}`), x[k], 4, f.t(`feedback.q.${k}`))).join("") + "</dl>"
    + ((x.comment || "").trim() && !autoFeedback(x) ? `<p class="note fb-quote">“${esc(x.comment.trim())}”</p>` : "") + "</li>"; // 42's text is the same every time
  const lowItem = (x: any) => fbItem(x, byLine(f, "feedback.by", x.by, { project: x.project }));
  // the lists that open: a rating you got under the maximum shows its squares, the rest one plain line each
  const plain = (e: any, sub: string) => `<li><span>${esc(e.project)}<br><span class="note">${sub}</span></span><span class="when">${esc(f.day(e.begin))}</span></li>`;
  const lowItems = low.map(lowItem).join("") || `<li class="note">${esc(f.t(rated.length ? "feedback.all_max" : "empty.ratings"))}</li>`;
  // what was left out, and the averages if it counted
  let apart = "";
  if (outside.length) {
    const allMine = received.flatMap((e: any) => e.feedbacks.filter((x: any) => x.by === me)), allTheirs = given.flatMap(real);
    const items = outside.map((e: any) => {
      const lows = e.role === "received" ? [] : ratings(e, (x) => !autoFeedback(x)).filter(isLow);
      return lows.length ? lows.map(lowItem).join("")
        : plain(e, esc(f.t(e.role === "received" ? "role.received" : "role.given")) + (e.cursus?.length ? ` · ${esc(e.cursus.join(", "))}` : ""));
    }).join("");
    apart = `<details class="apart"><summary>${esc(f.plural(outside.length, "feedback.apart"))}</summary>`
      + `<p class="note">${esc(f.t("feedback.apart_avg", { mine: f.num(avg(allMine, "rating"), 2), theirs: f.num(avg(allTheirs, "rating"), 2) }))}</p><ul class="list">${items}</ul></details>`;
  }
  const autoApart = autos.length ? `<details class="apart auto-apart"><summary>${esc(f.plural(autos.length, "feedback.auto_apart"))}</summary>`
    + `<p class="note">${esc(f.t("feedback.auto_note"))}</p><ul class="list">${autos.map((e: any) => {
      const who = (e.correcteds || []).length > 1 && e.team ? e.team : f.t("role.given"), lows = ratings(e, autoFeedback).filter(isLow);
      return lows.length ? lows.map((x: any) => fbItem(x, esc(`${e.project} · ${who}`))).join("") : plain(e, esc(who));
    }).join("")}</ul></details>` : "";
  const fbFinding = rated.length ? say(f, "ev2.find_fb", { b: f.t("ev2.of_the", { n: low.length, total: rated.length }) }) : "";
  out.push({ id: "feedback", nav: f.t("nav.feedback"), html: section("feedback", f.t("feedback.title"), fbFinding + cols(
    crit ? block("table-feedback", `<div class="table-wrap">${crit}</div>`, f.t("feedback.criteria_title"), f.t("feedback.criteria_note")) : "",
    block("low-feedback", `<ul class="list">${lowItems}</ul>${apart}${autoApart}`, f.t("feedback.low_title"),
      rated.length ? f.t("feedback.low_note", { low: low.length, ratings: f.plural(rated.length, "count.ratings") }) : "")),
  ) });

  out.push(pointsSection(pg));

  const cancelled = cancelledSection(pg);
  if (cancelled) out.push(cancelled);
  out.push(logSection(pg));
  // the page's order (owner, 2026-11-09): what you give back and by milestone, then the log, what was cancelled and the
  // correction points it is read from, the feedback, and over time and when at the bottom
  const ORDER = ["community", "by-group", "log", "cancelled", "points", "feedback", "over-time", "when"];
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/** The projects you corrected in this period: how often, how many people, the marks you gave. */
/** The projects you corrected, compact: how often, your average mark and, opened, whom you evaluated with each mark. */
function correctedTable(pg: Page): string {
  const f = pg.f;
  const by = new Map<string, any[]>();
  for (const e of pg.D.given) {
    if (!by.has(e.project)) by.set(e.project, []);
    by.get(e.project)!.push(e);
  }
  const rows = [...by].map(([project, evs]) => {
    const marks = evs.filter((e) => e.mark !== null && e.mark !== undefined).map((e) => e.mark);
    const whom = new Map<string, any[]>();
    for (const e of evs) for (const c of e.correcteds || []) { const l = c.login || "?"; if (!whom.has(l)) whom.set(l, []); whom.get(l)!.push(e); }
    const begins = evs.map((e) => e.begin).sort();
    return { project, times: evs.length, people: whom.size, avg: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null,
      fails: evs.filter(failed).length, outstanding: evs.filter((e) => e.outstanding).length, first: begins[0].slice(0, 10),
      last: begins[begins.length - 1].slice(0, 10), whom, last_e: evs.reduce((a, b) => (b.begin > a.begin ? b : a)) };
  });
  const chip = (e: any) => {
    const state = e.mark === null || e.mark === undefined ? "open" : redMark(e) ? "fail" : "pass";
    return `<span class="mark ${state}" title="${esc(f.day(e.begin) + (e.negative_flag && e.flag ? ` · ${e.flag}` : ""))}">${e.mark !== null && e.mark !== undefined ? esc(e.mark) : noMark(f, e)}</span>`;
  };
  const detail = (r: any) => {
    const people = [...r.whom].sort((a: any, b: any) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const lis = people.map(([login, evs]: [string, any[]]) => `<li><a class="code" href="${esc(pg.url("evaluations", { q: login, log: "given" }))}#log">${esc(login)}</a>`
      + `${evs.length > 1 ? ` ×${evs.length}` : ""} <span class="marks">${[...evs].sort((a, b) => a.begin.localeCompare(b.begin)).map(chip).join("")}</span></li>`).join("");
    return `<details><summary>${esc(f.plural(r.people, "depth.whom"))}</summary><ul class="evals">${lis}</ul></details>`;
  };
  return table(f, [
    { k: "project", t: f.t("col.project"), f: (r) => projectName(r.project) }, { k: "times", t: f.t("col.times"), num: true },
    { k: "avg", t: f.t("col.avg_mark"), s: f.t("abbr.avg_mark"), num: true, f: (r) => (r.avg !== null ? f.num(r.avg, 1) : noMark(f, r.last_e)) },
  ], rows, { label: f.t("depth.given_title"), sort: ["times", -1], detail, empty: f.t("empty.period") });
}

/** The feedback 42 writes itself when the evaluated student did not fill theirs in in time: no author, always 4/5 and
 * the same text (seen in every saved report, 2026-11-12). It is 42's, not somebody's opinion of you. */
export const autoFeedback = (x: any) => x.auto === true || (!x.by && /^You failed to complete this feedback/.test(x.comment || ""));

/** A text that names who wrote a feedback, the login as a link (a deleted or hidden one plain; "?" when 42 gave none). */
const byLine = (f: Fmt, key: string, login: string | null | undefined, vars: Record<string, unknown>) =>
  esc(f.t(key, { ...vars, login: "\u0001" })).replace("\u0001", login ? shownLogin(f, login, false) : "?");

/** How long after an evaluation's start the evaluated student logged in ("12m late", "1h 15m late"). */
export const lateText = (f: Fmt, min: number) => f.t("log.late", { time: min < 60 ? f.t("unit.min", { n: min }) : f.hm(min * 60) });

/** Work experience evaluations (company mid and final evaluations, peer video) are set by the school, not booked
 * between students: no booking lead or lateness for them. */
export const workExperience = (e: any) => /^(42cursus-)?work-experience-i/.test(e.slug || "") || /^work (experience|exp\.)/i.test(e.project || "");

/** No lateness in a work experience evaluation, nor of 3 minutes or less (server's LateGraceMin: logging in takes about
 * that long), also in reports saved before the server stopped working them out. */
export const shownLate = (e: any) => {
  const keep = (m: any) => (workExperience(e) || !(m > 3) ? null : m);
  return { ...e, my_late_min: keep(e.my_late_min), correcteds: (e.correcteds || []).map((c: any) => ({ ...c, late_min: keep(c.late_min) })) };
};

const seatText = (f: Fmt, p: any, checked: boolean) => (checked ? (p.host ? f.t("log.at_seat", { seat: p.host }) : f.t("log.not_logged")) : "");

/** Someone in the log: photo and login, and under them their seat (looked up for recent evaluations only) and how late
 * they logged in. */
const logPerson = (f: Fmt, p: any, checked: boolean) => {
  const sub = [seatText(f, p, checked), p.late_min ? lateText(f, p.late_min) : ""].filter(Boolean).join(" · ");
  return `${erased(p.login) ? "" : avatar(p)}${shownLogin(f, p.login, false)}` + (sub ? `<span class="sub">${esc(sub)}</span>` : "");
};

/** The students you evaluated: one alone as they are; a team on one line, its leader (the first one when not known) and
 * "+N", which open every member with their seat and lateness, as in Everyone you met's details; the leader's seat under. */
export function teamCell(f: Fmt, e: any): string {
  const cs: any[] = e.correcteds || [];
  if (cs.length < 2) return cs.map((c) => logPerson(f, c, e.other_host_checked)).join("");
  const lead = cs.find((c) => c.leader) || cs[0];
  const sub = (c: any) => [seatText(f, c, e.other_host_checked), c.late_min ? lateText(f, c.late_min) : ""].filter(Boolean).join(" · ");
  const rest = (c: any) => [c === lead ? f.t("log.leader") : "", sub(c)].filter(Boolean).join(" · ");
  return `<details class="pop who-pop team-pop" data-float><summary>${erased(lead.login) ? "" : avatar(lead)}${shownLogin(f, lead.login, false, false)}`
    + ` <span class="more">${esc(f.t("common.plus_more", { n: cs.length - 1 }))}</span></summary><div class="pop-panel"><b>${esc(e.team || f.t("col.evaluated"))}</b>`
    + `<ul>${cs.map((c) => `<li>${shownLogin(f, c.login, false)}${rest(c) ? ` · ${esc(rest(c))}` : ""}</li>`).join("")}</ul></div></details>`
    + (sub(lead) ? `<span class="sub">${esc(sub(lead))}</span>` : ""); // the leader's seat and lateness under the line
}

/** The Mondays from one "YYYY-MM-DD" to another, both included. */
const weeksBetween = (from: string, to: string, step = 7) => { // every step-th day from one to the other
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += step * 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Correction points: the balance at the end of each month, week by week when the chart is enlarged (the weekly one only
 * shows in the zoom), built from the sums (what the period started with is today's balance less its net; the Piscine
 * starts at 0); each tip says what came in and went out by reason. Then every reason. Reports saved before the months
 * were kept keep the old line. */
export function pointsSection(pg: Page): Section {
  const f = pg.f, D = pg.D, CP = D.correction_points;
  // a report saved before the months were kept: the balance at the end of each month from its own line, no reasons yet
  const monthEnds = () => {
    const last = new Map<string, number>();
    for (const p of CP.series || []) last.set(new Date(p.x).toISOString().slice(0, 7), p.y);
    const keys = last.size ? monthsBetween([...last.keys()][0], [[...last.keys()].pop()!, pg.asOf.slice(0, 7)].sort()[1]) : [];
    let carry = 0;
    const values = keys.map((k) => (carry = last.get(k) ?? carry));
    return qline(f, keys.map((k) => f.monthLabel(k)), values, { label: f.t("points.qline_title"), color: S1, emptyText: f.t("empty.points"),
      tips: keys.map((k, i) => [f.monthLabel(k), "---", f.t("points.q_balance", { n: f.num(values[i]) })].join("\n")) });
  };
  let chart = `<div class="block" data-panel="points"><h3>${esc(f.t("points.qline_title"))} ${info(f.t("points.refresh_note"))}</h3>${monthEnds()}</div>`;
  if (CP.by_week) {
    const move = (name: string, v: number) => `${name} ${v > 0 ? "+" : "−"}${f.num(Math.abs(v))}`;
    // one line of balances: every key from the first to the last (the empty ones at nothing), a tip each
    const series = (rows: any[], label: (k: string) => string, head: (k: string) => string, title = "points.wline_title") => {
      let bal = pg.period === "piscine" ? 0 : (D.profile?.correction_point ?? 0) - rows.reduce((s, r) => s + r.earned - r.spent, 0);
      const balances = rows.map((r) => (bal += r.earned - r.spent));
      const tips = rows.map((r, i) => {
        const rs = Object.entries(r.reasons || {}) as [string, number][];
        return [head(r.k), "---", f.t("points.q_earned", { n: f.num(r.earned) }), ...rs.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n, v]) => move(n, v)),
          f.t("points.q_spent", { n: f.num(r.spent) }), ...rs.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).map(([n, v]) => move(n, v)),
          "---", f.t("points.q_balance", { n: f.num(balances[i]) })].join("\n");
      });
      return qline(f, rows.map((r) => label(r.k)), balances, { label: f.t(title), color: S1, tips, emptyText: f.t("empty.points") });
    };
    const fill = (got: any[], keys: (a: string, b: string) => string[], name: string) => {
      const by = new Map(got.map((r) => [r[name], r]));
      return got.length ? keys(got[0][name], got[got.length - 1][name]).map((k) => ({ k, earned: 0, spent: 0, reasons: {}, ...by.get(k) })) : [];
    };
    // week by week; enlarged, day by day (reports saved before the days were kept stay on their weeks)
    const weeks = fill(CP.by_week, weeksBetween, "w"), days = CP.by_day ? fill(CP.by_day, (a, b) => weeksBetween(a, b, 1), "d") : null;
    const shortDay = (k: string) => `${+k.slice(8, 10)} ${f.months[+k.slice(5, 7) - 1]}`;
    const weekly = series(weeks, shortDay, (k) => f.t("points.w_label", { d: f.day(k) }));
    chart = `<div class="block" data-panel="points"><h3>${days ? `<span class="zoom-hide">${esc(f.t("points.wline_title"))}</span><span class="zoom-only">${esc(f.t("points.dline_title"))}</span>` : esc(f.t("points.wline_title"))} ${info(f.t(days ? "points.wline_note" : "points.refresh_note"))}</h3>`
      + (days ? `<div class="zoom-hide">${weekly}</div><div class="zoom-only">${series(days, shortDay, (k) => f.day(k), "points.dline_title")}</div>` : weekly) + "</div>";
  }
  return { id: "points", nav: f.t("nav.points"), html: section("points", f.t("points.title"), (CP.series.length ? say(f, "ev2.find_points", { earned: f.num(CP.earned), spent: f.num(CP.spent) }) : "") + cols(chart,
    block("table-reasons", `<div class="table-wrap fit">${table(f, [{ k: "reason", t: f.t("col.reason") }, { k: "count", t: f.t("col.times"), num: true }, { k: "sum", t: f.t("col.net"), num: true }],
      Object.entries(CP.reasons || {}).map(([reason, v]: [string, any]) => ({ reason, ...v })), { label: f.t("points.reasons_title"), sort: ["count", -1] })}${fillTable()}</div>`, f.t("points.reasons_title"))),
  { lede: esc(CP.series.length ? f.t("points.lede", { earned: CP.earned, spent: CP.spent, max: CP.max }) : f.t("empty.points")) }) };
}

/** Cancelled evaluations, read from your correction points (42 deletes the evaluation; core's correction_points
 * `cancels`, one kind each): four cards, the evaluations of your projects you cancelled (40%, with a possible project, an
 * estimate), the ones your corrector cancelled, the ones you were to give and cancelled, and the times your corrector
 * didn't come. Each card's tip lists them by date, newest first. When the student you were to evaluate cancels, nothing
 * is written on your side: no card can count it. Reports saved before the dates were kept count what the reasons tell. */
export function cancelledSection(pg: Page): Section | null {
  const f = pg.f, D = pg.D, CP = D.correction_points || {}, why = CP.reasons || {};
  const cs: any[] | undefined = CP.cancels, r = why["Evaluator cancelled a defense"], miss = why["Refund for evaluator missing"];
  if (!cs && !r && !miss) return null;
  const of = (kind: string) => (cs ? cs.filter((c) => (c.kind || (c.booked ? "corrector" : "you")) === kind) : null);
  const count = (kind: string, old: number | null) => { const l = of(kind); return l ? l.length : old; };
  // yours you cancelled, at the time you booked it (the cancel itself leaves no trace): of your projects handed in (the
  // team closed: closed_at; locked_at is when it was formed) and still waiting for their evaluations then (never an exam,
  // nor a work experience part but the peer video), leaving out one with every evaluation it had already booked; the
  // only one left, else the one with a booking that stayed within two hours of it (you booked it again), else none: it
  // can't be told (owner, 2026-11-24)
  const wall = (s: string) => Date.parse(`${s.replace(" ", "T")}:00Z`); // Madrid's clock on both sides: only differences count
  const guess = (c: any): string => {
    const evalsOf = (team: any) => (D.received || []).filter((e: any) => team != null && e.team_id === team);
    const booked = (a: any) => a.status === "finished" && evalsOf(a.team_id).length > 0 && evalsOf(a.team_id).every((e: any) => e.booked && e.booked <= c.at);
    const waiting = new Set<string>((D.projects || []).filter((p: any) => !p.exam && !(workExperience({ project: p.name }) && !/peer video/i.test(p.name)))
      .filter((p: any) => (p.attempts || []).some((a: any) => a.closed && a.closed <= c.at && (a.status !== "finished" || a.end_ms >= c.at_ms) && !booked(a)))
      .map((p: any) => p.name));
    if (waiting.size === 1) return [...waiting][0];
    const gap = (e: any) => Math.abs(wall(e.booked) - wall(c.at));
    const again = (D.received || []).filter((e: any) => waiting.has(e.project) && e.booked && gap(e) <= 2 * 3600e3).sort((a: any, b: any) => gap(a) - gap(b))[0];
    return again ? again.project : "";
  };
  const absentProject = (c: any) => (D.received || []).find((e: any) => e.id === c.st)?.project || "";
  const lines = (kind: string, head: string, more?: (c: any) => string) => {
    const l = of(kind);
    if (!l) return [head, f.t("cancel.refresh")];
    if (!l.length) return [head, f.t("cancel.none")];
    return [head, "---", ...[...l].sort((a, b) => b.at_ms - a.at_ms).map((c) => `${f.day(c.at)} ${String(c.at).slice(11)}${more ? ` · ${more(c) || "–"}` : ""}`)];
  };
  const card = (cls: string, title: string, n: number | null, sub: string, tip: string[]) => `<div class="cancel-card ${cls}" tabindex="0"${tipAttr(tip.join("\n"))}>`
    + `<h3>${esc(title.replace(/\s*\S+$/, ""))} <span class="nw">${esc(title.split(/\s+/).pop() || "")}<span class="info" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/><path d="M8 7.2v4.3M8 4.6v.1"/></svg></span></span></h3>`
    + `<p class="v">${n === null ? "–" : esc(f.num(n))}</p><p class="s">${esc(sub)}</p></div>`;
  const self = count("self", null), corrector = count("corrector", r ? (r.count + r.sum) / 2 : 0) ?? 0;
  const theirs = count("you", r ? (r.count - r.sum) / 2 : 0) ?? 0, absent = count("absent", miss ? miss.count : 0) ?? 0;
  const cards = `<div class="kpis cancel-cards">`
    + card("wide", f.t("cancel.self"), self, f.t("cancel.self_sub"), lines("self", f.t("cancel.self_tip", { n: self ?? "–" }), guess))
    + card("", f.t("cancel.corrector"), corrector, f.t("cancel.corrector_sub"), lines("corrector", f.t("cancel.corrector_tip", { n: corrector })))
    + card("", f.t("cancel.theirs"), theirs, f.t("cancel.theirs_sub"), lines("you", f.t("cancel.theirs_tip", { n: theirs })))
    + card("", f.t("cancel.absent"), absent, f.t("cancel.absent_sub"), lines("absent", f.t("cancel.absent_tip", { n: absent }), absentProject))
    + "</div>";
  const all = (self ?? 0) + corrector + theirs + absent;
  const finding = all ? say(f, "ev2.find_cancel", { n: f.num(all), corrector: f.num(corrector + absent) }) : "";
  // in cols, so that --charts-top sets the title's line → the cards
  return { id: "cancelled", nav: f.t("nav.cancelled"), html: section("cancelled", "", finding + cols(block("cancel-kpis", cards)), { head: `<h2>${esc(f.t("cancel.title"))} ${info(f.t("cancel.how"))}</h2>` }) };
}

/** Who marked whom absent, as [label, tip]. The API's `truant` is the one who reported the absence, the side that was
 * there (checked against the owner's own three cases, 2026-11-09): you, so you marked the other side; the other side,
 * so they marked you; in an evaluation you received with a team, a teammate, so your corrector was marked absent. */
export function absence(f: Fmt, role: string, e: any, me: string): [string, string] | null {
  if (!e.truant) return null;
  const who = (l: string) => (erased(l) ? f.t("who.erased_name") : l);
  const others = role === "received" ? who(e.corrector?.login || "") : (e.correcteds || []).map((c: any) => who(c.login || "")).join(", ");
  if (e.truant === me) return [f.t("no_mark.absent_you"), f.t("log.absent_you_tip", { who: others })];
  if (role === "received" && e.truant !== e.corrector?.login) return [f.t("log.absent_mate"), f.t("log.absent_mate_tip", { who: who(e.truant) })];
  return [f.t("no_mark.absent_them"), f.t("log.absent_them_tip", { who: who(e.truant) })];
}

/** The log's "Seat" filter: who had no session open (false: no such filter, a seat in a link is ignored). */
const SEAT_FILTER = true;

/** The seat filter looks at the evaluated side only: you when you received it, the students you evaluated when you
 * gave it; then your seat by cluster. */
export const seatOptions = (role: string, clusters: string[]) => ["", role === "received" ? "me" : "other", "late", ...clusters];

/** One evaluation against the seat filter ("" any): you received it with no session open (me), a student you evaluated
 * not logged where their seat was looked up (other), the evaluated side logged in after the start (late), or your seat
 * in one cluster (c1…). */
export const seatMatch = (role: string, seat: string, e: any) =>
  /^c\d+$/.test(seat) ? (e.my_host || "").split("r")[0] === seat
  : seat === "me" ? !e.my_host
  : seat === "other" ? !!e.other_host_checked && (e.correcteds || []).some((c: any) => !c.host)
  : seat === "late" ? (role === "received" ? !!e.my_late_min : (e.correcteds || []).some((c: any) => c.late_min))
  : true;

export function logSection(pg: Page): Section {
  const f = pg.f, D = pg.D;
  const role = pg.q("log", "received", ["received", "given"]);
  const flag = pg.q("flag", "", ["", "out", "bad", "ok", "noshow"]);
  const evs: Record<string, any[]> = { received: tookPart(pg, "received"), given: tookPart(pg, "given") }; // a rush corrected as a student is the student's
  const projectsAll = [...new Set([...evs.received, ...evs.given].map((e: any) => e.project as string))].sort();
  const proj = pg.q("project", "", ["", ...projectsAll]);
  const milestones = MILESTONES.filter((m) => evs[role].some((e: any) => milestoneOf(e) === m));
  const milestone = pg.q("milestone", "", ["", ...MILESTONES]);
  const me = D.profile?.login;
  const clusters = Object.keys(pg.v.layout || {}).sort();
  const seat = SEAT_FILTER ? pg.q("seat", "", seatOptions(role, clusters)) : "";
  const q = pg.q("q", "").slice(0, 80).toLowerCase();
  const attemptOf = new Map<unknown, number>(D.projects.flatMap((p: any) => p.attempts.map((a: any) => [a.team_id, a.n] as [unknown, number])));
  const match = (e: any) => {
    if (flag && !(flag === "noshow" ? !!e.truant : flag === "out" ? e.outstanding : flag === "bad" ? e.negative_flag : !e.outstanding && !e.negative_flag)) return false;
    if (proj && e.project !== proj) return false;
    if (milestone && milestoneOf(e) !== milestone) return false;
    if (!seatMatch(role, seat, e)) return false;
    const hay = JSON.stringify([e.corrector?.login, (e.correcteds || []).map((c: any) => c.login), e.comment, e.feedback, e.feedbacks, e.my_host, e.other_host, e.project, e.begin]).toLowerCase();
    return !q || hay.includes(q);
  };
  const rows = evs[role].map(shownLate).filter(match);
  const fbText = (e: any) => {
    if (!e.comment && !e.feedbacks?.length) return "";
    const parts = e.comment ? [`<div class="txt"><b>${esc(f.t("log.corrector_comment"))}</b>\n${esc(e.comment)}</div>`] : [];
    for (const x of e.feedbacks) {
      const kinds = KINDS.filter((k) => x[k] !== null && x[k] !== undefined).map((k) => `${f.t(`criterion.${k}`)} ${x[k]}/4`).join(" · ");
      parts.push(`<div class="txt"><b>${autoFeedback(x) ? esc(f.t("log.feedback_auto", { rating: x.rating ?? "–" })) : byLine(f, "log.feedback_by", x.by, { rating: x.rating ?? "–" })}</b>`
        + (kinds ? ` <span class="note">${esc(kinds)} · ${esc(x.at || "")}</span>` : "") + `\n${esc(x.comment || "")}</div>`);
    }
    const n = e.feedbacks.length;
    const what = e.comment && n ? f.t("log.comment_and_feedback", { count: n, n }) : e.comment ? f.t("log.comment_only") : f.t("log.feedback_only", { count: n, n });
    return `<details><summary>${esc(what)}</summary>${parts.join("")}</details>`;
  };
  const when = { k: "begin_ms", t: f.t("col.when"), cls: "when", f: (e: any) => `<span class="nw">${esc(f.day(e.begin))}</span> <span class="nw">${esc(e.begin.slice(11))}`
    + (e.filled ? ` ${ARROW} ${esc(e.filled.slice(11))}` : "") + "</span>" };
  const flagCol = { k: "flag", t: f.t("col.flag"), nw: true, cls: "ctr", sv: (e: any) => (e.outstanding ? 2 : e.negative_flag ? 0 : 1), f: (e: any) => flagBadge(f, e) };
  // the mark, and who marked whom absent when someone did (its tip names them)
  const markCol = { k: "mark", t: f.t("col.mark"), num: true, cls: "ctr", f: (e: any) => {
    const a = absence(f, role, e, me);
    return esc(e.mark ?? "") + (a ? `<span class="sub"${tipAttr(a[1])}>${badge(a[0], "bad")}</span>` : "");
  } };
  const minCol = { k: "duration_min", t: f.t("col.duration"), s: f.t("abbr.duration"), num: true, nw: true,
    // planned and booked: a line each, never broken inside (dash.css .sub.dur)
    f: (e: any) => esc(f.t("unit.min", { n: f.num(e.duration_min) })) + `<span class="sub dur">${[f.t("log.planned", { n: e.planned_min }),
      e.lead_h !== null && e.lead_h !== undefined && !workExperience(e) ? f.t("log.booked_ahead", { h: f.hmm(e.lead_h) }) : ""].filter(Boolean).map((t) => `<span class="nw">${esc(t)}</span>`).join("")}</span>` };
  // phones hide it, unless a seat filter is on: how late you were is under your seat (owner, 2026-11-24)
  const mySeat = { k: "my_host", t: f.t("col.your_seat"), nw: true, hide: !seat, cls: "ctr",
    f: (e: any) => { const sub = [e.my_campus || "", e.my_late_min ? lateText(f, e.my_late_min) : ""].filter(Boolean).join(" · ");
      return esc(e.my_host || f.t("log.not_logged")) + (sub ? `<span class="sub">${esc(sub)}</span>` : ""); } };
  const columns = role === "received" ? [when,
    { k: "project", t: f.t("col.project"), nw: true, f: (e: any) => `${projectName(e.project)}<span class="sub">${esc(f.t("projects.attempt", { n: attemptOf.get(e.team_id) ?? "?" }))}</span>` },
    { k: "corrector", t: f.t("col.corrector"), s: f.t("abbr.corrector"), nw: true, cls: "ctr", sv: (e: any) => e.corrector.login, f: (e: any) => logPerson(f, e.corrector, e.other_host_checked) },
    mySeat, minCol, markCol, flagCol, { k: "fb_rating", t: f.t("col.your_rating"), num: true, hide: true, cls: "ctr" }]
    : [when, { k: "project", t: f.t("col.project"), nw: true, f: (e: any) => projectName(e.project) },
      { k: "correcteds", t: f.t("col.evaluated"), s: f.t("abbr.evaluated"), nw: true, cls: "ctr", sv: (e: any) => e.correcteds.map((c: any) => c.login || "").join(","),
        f: (e: any) => teamCell(f, e) },
      mySeat, minCol, markCol, flagCol, { k: "fb_rating", t: f.t("col.their_rating"), num: true, hide: true, cls: "ctr" }];
  const form = filters("log",
    radios("log", f.t("log.role_label"), (["received", "given"] as const).map((v) => [v, f.t(`log.${v}`)]), role)
    + select("flag", f.t("log.flag"), [["", f.t("log.flag_all")], ["out", f.t("log.flag_out")], ["bad", f.t("log.flag_bad")], ["ok", f.t("log.flag_ok")], ["noshow", f.t("log.flag_noshow")]], flag)
    + select("milestone", f.t("log.milestone"), [["", f.t("log.milestone_all")], ...milestones.map((m) => [m, m === "other" ? f.t("log.milestone_other") : f.t(`groups.${m}`)] as [string, string])], milestone)
    + select("project", f.t("log.project"), [["", f.t("log.project_all")], ...projectsAll.map((p) => [p, p] as [string, string])], proj)
    + (SEAT_FILTER ? select("seat", f.t("log.seat"), seatOptions(role, clusters).map((v) => [v, v === "" ? f.t("log.seat_all") : v === "me" ? f.t("col.nl_you")
      : v === "other" ? f.t("col.nl_evaluated") : v === "late" ? f.t(role === "received" ? "log.late_you" : "log.late_them") : f.t("log.seat_in", { c: v })] as [string, string]), seat) : "")
    + search("q", pg.q("q", "").slice(0, 80), f.t("common.search"), f.t("log.search_placeholder"))
    + (flag || proj || milestone || seat || q ? `<a class="btn secondary log-clear" href="${esc(pg.url(undefined, { flag: "", project: "", milestone: "", seat: "", q: "" }))}" data-keep>${esc(f.t("log.clear"))}</a>` : ""));
  return { id: "log", nav: f.t("nav.log"), html: section("log", f.t("log.title"), form + `<div id="log-results">`
    + cols(block("table-log", `<div class="table-wrap tall">${table(f, columns as any, rows, { label: f.t("log.title"), sort: ["begin_ms", -1], empty: f.t("empty.search_log"), sticky: true, detail: fbText })}</div>`)) + "</div>",
  // lateness is an estimate: how, and what it can't tell, in the title's ⓘ (owner, 2026-11-24)
  { head: `<h2>${esc(f.t("log.title"))} ${info(f.t("log.late_note"))}<span class="count"><span class="sep"> · </span>${esc(f.plural(rows.length, "count.evaluations"))}</span></h2>` }) };
}
