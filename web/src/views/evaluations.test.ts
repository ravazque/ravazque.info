import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { say, absence, autoFeedback, binLabels, longOnes, staffApart, cancelledSection, pointsSection, deletedApart, evaluations, lateText, logSection, milestoneOf, seatMatch, seatOptions, teamCell, shownLate, workExperience } from "./evaluations";
import { Page, shownLogin } from "./page";

test("the log's seat filter: the evaluated side only, you received with no session open, or the students you evaluated not logged where it was looked up", () => {
  const recv = (my_host: string | null) => ({ my_host, other_host_checked: true, other_host: null });
  expect(seatMatch("received", "me", recv(null))).toBe(true);
  expect(seatMatch("received", "me", recv("c1r1s1"))).toBe(false);
  const given = (checked: boolean, hosts: (string | null)[]) => ({ my_host: "c1r1s1", other_host_checked: checked, correcteds: hosts.map((host) => ({ host })) });
  expect(seatMatch("given", "other", given(true, ["c1r1s2", null]))).toBe(true);
  expect(seatMatch("given", "other", given(true, ["c1r1s2"]))).toBe(false);
  expect(seatMatch("given", "other", given(false, [null]))).toBe(false);
  expect(seatMatch("given", "", given(false, [null]))).toBe(true);
});

test("the seat filter by cluster keeps the evaluations you had in that cluster", () => {
  expect(seatMatch("received", "c1", { my_host: "c1r2s3" })).toBe(true);
  expect(seatMatch("given", "c2", { my_host: "c1r2s3" })).toBe(false);
  expect(seatMatch("received", "c1", { my_host: null })).toBe(false);
});

test("a histogram's bins carry their unit beside the numbers", () => {
  expect(binLabels([0, 1, 3], "h")).toEqual(["0–1h", "1–3h", "3+h"]);
  expect(binLabels([0, 15], "m")).toEqual(["0–15m", "15+m"]);
});

test("the long bars of a histogram name their evaluations: project, the other side and the value, longest first, at most eight", () => {
  const f = new Fmt("en"), edges = [0, 15, 30, 45, 60, 75, 90, 120, 180];
  const recv = (project: string, login: string, duration_min: number, status = "done") => ({ project, corrector: { login }, duration_min, status });
  const got = longOnes(f, [recv("webserv", "peer01", 135), recv("cub3d", "peer02", 200), recv("libft", "peer03", 60), recv("minirt", "peer04", 150, "canceled"),
    recv("inception", "peer05", 170)], "received", "duration_min", edges, 120);
  expect(got.slice(0, 7).every((b) => !b.length)).toBe(true); // short ones, none
  expect(got[7]).toEqual(["inception · peer05 · 170m", "webserv · peer01 · 135m"]); // the canceled one is not in the chart either
  expect(got[8]).toEqual(["cub3d · peer02 · 200m"]);
  const team = { project: "ft_transcendence", correcteds: [{ login: "peer06" }, { login: "peer07" }, { login: "peer08" }], lead_h: 30.5 };
  expect(longOnes(f, [team], "given", "lead_h", [0, 1, 3, 6, 12, 24, 48, 96], 12)[5]).toEqual(["ft_transcendence · peer06 +2 · 30:30h"]);
  const many = Array.from({ length: 10 }, (_, i) => recv("webserv", `peer${10 + i}`, 121 + i));
  const capped = longOnes(f, many, "received", "duration_min", edges, 120)[7];
  expect(capped.length).toBe(9);
  expect(capped[0]).toBe("webserv · peer19 · 130m");
  expect(capped[8]).toBe(f.t("common.plus_more", { n: 2 }));
});

test("deleted accounts get their own row by milestone, and no evaluation is lost on the way", () => {
  const stats = { "rank-01": { received: 2, received_out: 0, given: 1, given_out: 0 }, "no-cursus": { received: 3, received_out: 1, given: 5, given_out: 2 } };
  const received = [{ corrector: { login: "3b3-1" }, outstanding: true }, { corrector: { login: "3b3-2" }, outstanding: false }, { corrector: { login: "peer01" } }];
  const given = [{ correcteds: [{ login: "3b3-1" }, { login: "me" }], outstanding: true }, { correcteds: [{ login: "peer02" }], outstanding: false }];
  const got = deletedApart(stats, received, given, "me");
  expect(got.deleted).toEqual({ received: 2, received_out: 1, given: 1, given_out: 1 });
  expect(got["no-cursus"]).toEqual({ received: 1, received_out: 0, given: 4, given_out: 1 });
  expect(got["rank-01"]).toEqual(stats["rank-01"]);
  const sum = (k: string) => Object.values(got).reduce((n: number, r: any) => n + r[k], 0);
  expect([sum("received"), sum("given")]).toEqual([5, 6]);
  expect(deletedApart(stats, [{ corrector: { login: "peer01" } }], [], "me")).toEqual(stats);
});

test("how late someone logged in reads as an estimate, in minutes, then hours and minutes", () => {
  const en = new Fmt("en"), es = new Fmt("es");
  expect(lateText(en, 12)).toBe("first login 12m late (est.)");
  expect(lateText(en, 75)).toBe("first login 1h 15m late (est.)");
  expect(lateText(es, 12)).toBe("primera conexión 12m tarde (est.)");
});

test("the log's late filter: evaluations you logged into late, or where a student you evaluated did", () => {
  expect(seatMatch("received", "late", { my_late_min: 12 })).toBe(true);
  expect(seatMatch("received", "late", { my_late_min: null })).toBe(false);
  expect(seatMatch("given", "late", { correcteds: [{ late_min: null }, { late_min: 3 }] })).toBe(true);
  expect(seatMatch("given", "late", { correcteds: [{ late_min: null }] })).toBe(false);
});

test("the log's seat options leave out the corrector's side: yours when you gave it, the corrector's when you received it", () => {
  expect(seatOptions("received", ["c1"])).toEqual(["", "me", "late", "c1"]);
  expect(seatOptions("given", ["c1"])).toEqual(["", "other", "late", "c1"]);
});

test("work experience evaluations (company mid and final, peer video) are told apart by slug or name", () => {
  expect(workExperience({ slug: "work-experience-ii-work-experience-ii-company-mid-evaluation" })).toBe(true);
  expect(workExperience({ slug: "42cursus-work-experience-i" })).toBe(true);
  expect(workExperience({ slug: null, project: "Work Experience I - Peer Video" })).toBe(true);
  expect(workExperience({ slug: "libft", project: "Libft" })).toBe(false);
});

test("a team you evaluated shows its leader, the rest in a list that opens", () => {
  const f = new Fmt("en");
  const team = { other_host_checked: true, team: "Team 01", correcteds: [{ login: "peer01", host: "c1r1s1" }, { login: "peer02", host: null, leader: true, late_min: 5 }] };
  const html = teamCell(f, team);
  const summary = html.slice(html.indexOf("<summary>"), html.indexOf("</summary>"));
  expect(html.startsWith("<details")).toBe(true); // one line: the leader and +N open the team
  expect(summary).toContain("peer02");
  expect(summary).toContain('<span class="more">+1 more</span>'); // text, as in Everyone you met's details (kept on one line)
  expect(summary).not.toContain("peer01");
  const panel = html.slice(html.indexOf("</summary>"));
  expect(panel).toContain("peer01");
  expect(panel).toContain("leader · no session open · first login 5m late (est.)");
  expect(html.slice(html.lastIndexOf("</details>"))).toContain('class="sub">no session open · first login 5m late (est.)'); // the leader's seat under the line
  expect(teamCell(f, { other_host_checked: false, correcteds: [{ login: "peer03" }] })).not.toContain("<details");
});

test("a report saved before work experience lost its lateness, or before 3 minutes stopped counting, shows none there", () => {
  const we = { slug: "work-experience-i-work-experience-i-company-mid-evaluation", my_late_min: 4685, correcteds: [{ late_min: 30 }] };
  expect(shownLate(we)).toMatchObject({ my_late_min: null, correcteds: [{ late_min: null }] });
  const peer = { slug: "libft", my_late_min: 12, correcteds: [{ late_min: 4 }] };
  expect(shownLate(peer)).toEqual(peer);
  expect(shownLate({ slug: "libft", my_late_min: 3, correcteds: [{ late_min: 1 }, { late_min: 9 }] })).toMatchObject({ my_late_min: null, correcteds: [{ late_min: null }, { late_min: 9 }] });
});

test("the log's title explains in its ⓘ that lateness is an estimate", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const html = logSection(new Page(f, { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {})).html;
  expect(html).toMatch(/<h2>Evaluation log <span class="info"[^>]*data-tip="Lateness is an estimate/);
  expect(html).toMatch(/<span class="count"><span class="sep"> · <\/span>\d+ evaluations<\/span><\/h2>/); // the count stays
});

test("a project's milestone comes from the Common Core list; the rest of the 42cursus is OuterCore, anything else other", () => {
  expect(milestoneOf({ slug: "42cursus-libft", cursus: ["42cursus"] })).toBe("rank-00");
  expect(milestoneOf({ slug: "exam-rank-02", cursus: ["42cursus"] })).toBe("rank-02");
  expect(milestoneOf({ slug: "42cursus-inception-of-things", cursus: ["42cursus"] })).toBe("outer-core");
  expect(milestoneOf({ slug: "c-piscine-c-00", cursus: ["C Piscine"] })).toBe("other");
});

const ev = (o: any) => ({ id: o.id, begin: "2026-10-01 10:00", begin_ms: o.id, project: o.project, slug: o.slug, cursus: ["42cursus"], mark: o.mark ?? null,
  truant: o.truant ?? null, flag: "Ok", correcteds: [{ login: "peer02" }], corrector: { login: "peer01" }, duration_min: 15, planned_min: 15, team_id: o.id });
const logPage = (q: Record<string, string>) => new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
  given: [ev({ id: 1, project: "Libft", slug: "42cursus-libft", mark: 100 }), ev({ id: 2, project: "minishell", slug: "42cursus-minishell", truant: "peer02" }),
    ev({ id: 3, project: "Inception of Things", slug: "42cursus-inception-of-things", mark: 0, truant: "peer02" })] }, all_projects: [] } as any, "evaluations", { log: "given", ...q });
const logOf = (q: Record<string, string>) => logSection(logPage(q)).html;

test("the log goes by when you took part: a rush corrected as a student is in the student's log, not in the Piscine's", () => {
  const rush = { ...ev({ id: 9, project: "C Piscine Rush 00", slug: "c-piscine-rush-00", mark: 84 }), begin: "2025-11-02 10:00", cursus: ["C Piscine"] };
  const cursus = [{ name: "42cursus", begin: "2025-08-29 09:42" }];
  const page = (period: string, given: any[], moved?: any) => new Page(new Fmt("en"), { period, layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [], given },
    all_projects: [], all_cursus: cursus, piscine_as_student: moved } as any, "evaluations", { log: "given" });
  expect(logSection(page("student", [], { received: [], given: [rush] })).html).toContain("C Piscine Rush 00");
  expect(logSection(page("piscine", [rush])).html).not.toContain("C Piscine Rush 00");
  expect(logSection(page("piscine", [{ ...rush, begin: "2025-08-10 10:00" }])).html).toContain("C Piscine Rush 00");
});

test("who marked whom absent: the API names the one who reported it, the side that was there", () => {
  const f = new Fmt("en"), e = (truant: string) => ({ truant, corrector: { login: "peer01" }, correcteds: [{ login: "me" }, { login: "peer03" }] });
  expect(absence(f, "received", e("me"), "me")).toEqual([f.t("no_mark.absent_you"), f.t("log.absent_you_tip", { who: "peer01" })]); // you marked your corrector
  expect(absence(f, "received", e("peer01"), "me")).toEqual([f.t("no_mark.absent_them"), f.t("log.absent_them_tip", { who: "peer01" })]); // your corrector marked you
  expect(absence(f, "received", e("peer03"), "me")![0]).toBe(f.t("log.absent_mate")); // a teammate marked your corrector
  const g = (truant: string) => ({ truant, corrector: { login: "me" }, correcteds: [{ login: "peer02" }] });
  expect(absence(f, "given", g("me"), "me")).toEqual([f.t("no_mark.absent_you"), f.t("log.absent_you_tip", { who: "peer02" })]); // you marked them
  expect(absence(f, "given", g("peer02"), "me")).toEqual([f.t("no_mark.absent_them"), f.t("log.absent_them_tip", { who: "peer02" })]); // they marked you
  expect(absence(f, "given", { correcteds: [] }, "me")).toBeNull();
});

test("an absence reads in the log beside the mark when there is one, and the flag filter keeps those", () => {
  const f = new Fmt("en");
  expect(logOf({}).split(`>${f.t("no_mark.absent_them")}</span>`).length - 1).toBe(2);
  expect(logOf({ flag: "noshow" })).toContain(f.plural(2, "count.evaluations"));
  expect(logOf({})).toContain(`value="noshow"`);
});

test("the log filters by the project's milestone", () => {
  const f = new Fmt("en");
  expect(logOf({ milestone: "rank-00" })).toContain(f.plural(1, "count.evaluations"));
  expect(logOf({ milestone: "outer-core" })).toContain(f.plural(1, "count.evaluations"));
  expect(logOf({})).toContain(`name="milestone"`);
});

test("a login opens its page on acerezo.top in a new tab; deleted and hidden ones have no link", () => {
  const f = new Fmt("en");
  expect(shownLogin(f, "peer01")).toBe('<a class="login-link" href="https://acerezo.top/user/peer01" target="_blank" rel="noopener noreferrer">peer01</a>');
  expect(shownLogin(f, "3b3-12345")).not.toContain("<a");
  expect(shownLogin(f, "Hidden 2")).toBe("Hidden 2");
  expect(shownLogin(f, "peer01", true, false)).toBe("peer01");
});

const cancelPage = (cp: any) => new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "me" }, correction_points: cp,
  // handed in (closed) before the booking and not finished then: the only ones a defense can be booked for
  projects: [{ name: "Inception", exam: false, attempts: [{ locked: "2026-01-20 12:00", closed: "2026-02-15 10:00", status: "finished", end_ms: Date.parse("2026-03-01T10:00:00Z") }] },
    { name: "CPP Module 05", exam: false, attempts: [{ locked: "2026-02-10 12:00", closed: "2026-02-20 10:00", status: "finished", end_ms: Date.parse("2026-02-21T10:00:00Z") }] }, // still being written
    { name: "Work Experience I - Company Final Evaluation", exam: false, attempts: [{ locked: "2026-01-01 10:00", closed: "2026-02-01 10:00", status: "waiting_for_correction" }] }, // the company fills it in
    { name: "Exam Rank 05", exam: true, attempts: [{ locked: "2026-02-17 09:00", closed: "2026-02-17 10:00", status: "waiting_for_correction" }] },
    { name: "Libft", exam: false, attempts: [{ locked: "2025-01-01 10:00", closed: "2025-01-02 10:00", status: "finished", end_ms: Date.parse("2025-01-03T10:00:00Z") }] }],
  received: [{ id: 501, project: "Inception", begin_ms: Date.parse("2026-03-01T09:30:00Z") }, { id: 502, project: "Inception", begin_ms: Date.parse("2026-02-20T09:00:00Z") }],
  given: [{ project: "CPP Module 09", begin_ms: Date.parse("2026-04-21T10:00:00Z") }, { project: "CPP Module 09", begin_ms: Date.parse("2026-04-19T10:00:00Z") },
    { project: "Libft", begin_ms: Date.parse("2026-04-01T10:00:00Z") }] }, all_projects: [] } as any, "evaluations", {});

const unesc = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const cardTips = (html: string) => [...html.matchAll(/class="cancel-card[^"]*"[^>]*data-tip="([^"]*)"/g)].map((m) => unesc(m[1]));
const cardFigures = (html: string) => [...html.matchAll(/<p class="v">([^<]*)<\/p>/g)].map((m) => m[1]);

test("cancelled evaluations: four cards, each with its dates in its tip; only yours cancelled by you carries a project estimate", () => {
  const f = new Fmt("en");
  const html = cancelledSection(cancelPage({ cancels: [
    { kind: "self", at: "2026-02-17 16:16", at_ms: Date.parse("2026-02-17T15:16:00Z") },
    { kind: "corrector", at: "2026-02-17 16:18", at_ms: Date.parse("2026-02-17T15:18:00Z") },
    { kind: "you", at: "2026-04-20 15:43", at_ms: Date.parse("2026-04-20T13:43:00Z") },
    { kind: "you", at: "2026-04-21 15:43", at_ms: Date.parse("2026-04-21T13:43:00Z") },
    { kind: "absent", at: "2026-03-01 10:00", at_ms: Date.parse("2026-03-01T09:00:00Z"), st: 501 }] }))!.html;
  expect(unesc(html)).toContain(f.t("cancel.how")); // in the title's ⓘ
  expect(html).not.toContain("<table");
  expect(cardFigures(html)).toEqual(["1", "1", "2", "1"]);
  const [self, corrector, theirs, absent] = cardTips(html);
  expect(self.split("\n")).toContain("---"); // what it says, a rule, then the dates
  expect(self).toContain("17 Feb 2026 16:16 · Inception"); // handed in and waiting for its evaluations, evaluated soonest after the booking
  expect(self).not.toContain("Exam Rank 05"); // exams are never booked
  expect(corrector).toContain("17 Feb 2026 16:18");
  expect(corrector).not.toContain("Inception"); // no estimate there
  expect(theirs).toContain("21 Apr 2026 15:43");
  expect(theirs).not.toContain("CPP Module 09");
  expect(absent).toContain("1 Mar 2026 10:00 · Inception"); // the evaluation stays: its project is known
});

test("a report saved before the dates were kept counts what the reasons tell and asks for a refresh", () => {
  const f = new Fmt("en");
  const html = cancelledSection(cancelPage({ reasons: { "Evaluator cancelled a defense": { count: 20, sum: -8 }, "Refund for evaluator missing": { count: 1, sum: 1 } } }))!.html;
  expect(cardFigures(html)).toEqual(["–", "6", "14", "1"]);
  expect(html).toContain(f.t("cancel.refresh"));
  expect(cancelledSection(cancelPage({ reasons: {} }))).toBeNull();
});

test("the page goes: what you give back, by milestone, the log, what was cancelled, correction points, feedback, over time and when", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const derive = JSON.parse(readFileSync("../server/core/testdata/golden/mid.derive.json", "utf8")).all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, derive, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  expect(evaluations(pg).map((s) => s.id).filter((id) => id !== "cancelled")).toEqual(["community", "by-group", "log", "points", "feedback", "over-time", "when"]);
});

test("By milestone always lists every group, in order, the ones with nothing greyed, as Points by source does", async () => {
  const { readFileSync } = await import("node:fs");
  const { GROUPS } = await import("../lib/graphs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const pg = new Page(f, { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "by-group")!.html;
  const table = html.slice(html.indexOf('data-panel="by-group"'), html.indexOf('data-panel="depth-projects"'));
  const names = [...table.matchAll(/<tr( class="zero")?><td class="nowrap" data-v="\d+">(?:<i class="gdot [^"]*" aria-hidden="true"><\/i>)?([^<]+)<\/td>/g)]; // after its colour dot
  // staff and deleted accounts only when there is something to show (owner, 2026-11-12)
  const shown = GROUPS.filter((g) => !["staff", "deleted", "no-cursus"].includes(g) || all.stats.by_group[g]);
  expect(names.map((m) => m[2])).toEqual(shown.map((g) => f.t(`groups.${g}`)));
  expect(names.filter((m) => m[1]).length).toBeGreaterThan(0); // groups with nothing, greyed
  expect(names.filter((m) => !m[1]).length).toBe(Object.keys(all.stats.by_group).length);
});

test("Projects you corrected takes the height of the table by milestone beside it: more rows scroll, fewer leave templates", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "by-group")!.html;
  const corrected = html.slice(html.indexOf('data-panel="depth-projects"'));
  expect(corrected).toMatch(/<div class="table-wrap fit"><table[^]*<\/table><div class="fill-rows" aria-hidden="true">/);
  expect(corrected).not.toContain("blank-rows");
});

test("Correction points: the balance at the end of each week, day by day when enlarged; each tip with what came in and went out by reason and the balance it ended with", () => {
  const f = new Fmt("en");
  const cp = { earned: 9, spent: 6, max: 5, series: [], reasons: {},
    by_month: [{ m: "2026-01", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { m: "2026-03", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }],
    by_week: [{ w: "2026-01-05", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { w: "2026-01-19", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }],
    by_day: [{ d: "2026-01-06", earned: 4, spent: 6, reasons: { "Earning after defense": 4, "Defense plannification": -6 } }, { d: "2026-01-20", earned: 5, spent: 0, reasons: { "Earning after defense": 5 } }] };
  const pg = new Page(f, { period: "piscine", report: { profile: { login: "me", correction_point: 3 }, correction_points: cp, received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {});
  const html = pointsSection(pg).html;
  const unesc = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const tipsIn = (part: string) => [...part.matchAll(/class="ch-col ql"[^>]*data-tip="([^"]*)"/g)].map((m) => unesc(m[1]));
  const [weekly, daily] = html.split('<div class="zoom-only">');
  expect(tipsIn(weekly).length).toBe(3); // the weeks of January 5, 12 and 19
  expect(tipsIn(weekly)[0]).toContain(f.t("points.w_label", { d: f.day("2026-01-05") }));
  expect(tipsIn(weekly)[0]).toContain("Defense plannification −6");
  expect(tipsIn(weekly)[0]).toContain(f.t("points.q_balance", { n: f.num(-2) })); // the Piscine starts at 0
  expect(tipsIn(weekly)[2]).toContain(f.t("points.q_balance", { n: "3" }));
  expect(tipsIn(daily).length).toBe(15); // every day from January 6 to 20
  expect(tipsIn(daily)[0]).toContain(f.day("2026-01-06"));
  expect(tipsIn(daily)[14]).toContain(f.t("points.q_balance", { n: "3" }));
  expect(html).not.toContain(f.t("points.qline_title")); // months only for reports saved before
  // a report with weeks and no days (saved 9 to 12 Nov 2026) keeps its weeks when enlarged
  const old = pointsSection(new Page(f, { period: "piscine", report: { profile: { login: "me", correction_point: 3 }, correction_points: { ...cp, by_day: undefined }, received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {})).html;
  expect(old).not.toContain("zoom-only");
  expect(tipsIn(old).length).toBe(3);
  expect(unesc(html)).toContain(f.t("points.wline_note")); // in the title's ⓘ
  // the reasons beside the chart take its height: more rows scroll, fewer leave templates down to its base
  expect(html).toMatch(/<div class="table-wrap fit"><table[^]*<\/table><div class="fill-rows" aria-hidden="true">(<i><\/i>)+<\/div><\/div>/);
});

test("Correction points from a report saved before the months were kept: the balance at the end of each month from its own line, the last month labelled", () => {
  const f = new Fmt("en");
  const series = [{ x: Date.parse("2026-01-10T10:00:00Z"), y: 3 }, { x: Date.parse("2026-01-20T10:00:00Z"), y: 5 }, { x: Date.parse("2026-03-02T10:00:00Z"), y: 4 }];
  const pg = new Page(f, { period: "student", report: { generated: "2026-04-15 10:00", profile: { login: "me" }, correction_points: { earned: 2, spent: 1, max: 5, series, reasons: {} },
    received: [], given: [], projects: [] }, all_projects: [] } as any, "evaluations", {});
  const html = pointsSection(pg).html;
  expect(html.match(/class="ch-col ql"/g)?.length).toBe(4); // January to April, the report's month
  const labels = [...html.matchAll(/<div class="ch-x[^"]*"[^>]*>(.*?)<\/div>/g)][0][1];
  expect(labels).toContain(f.monthLabel("2026-04"));
  expect(html).toContain(f.t("points.refresh_note").replace(/'/g, "&#39;"));
});

test("the log keeps a long project name to 28 characters; opened, the whole name", () => {
  const long = "Bgp At Doors of Autonomous Systems is Simple";
  const pg = new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
    given: [ev({ id: 1, project: long, slug: "x", mark: 100 })] }, all_projects: [] } as any, "evaluations", { log: "given" });
  const html = logSection(pg).html;
  expect(html).toContain("<summary>Bgp At Doors of Autonomous...</summary>");
  expect(html).toContain(`<div class="pop-panel"><b>${long}</b>`);
  expect(html).toContain(`<option value="${long}">`); // the filter keeps whole names
});

test("the feedback 42 fills in when the student did not is named as that, never as someone unknown; real ones link their author", () => {
  const auto = { by: null, rating: 4, comment: "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time)." };
  expect(autoFeedback(auto)).toBe(true);
  expect(autoFeedback({ by: "peer02", rating: 4, comment: auto.comment })).toBe(false);
  expect(autoFeedback({ by: null, rating: 3, comment: "fine" })).toBe(false);
  const f = new Fmt("en");
  const pg = new Page(f, { period: "student", layout: {}, report: { profile: { login: "peer01" }, received: [], projects: [],
    given: [{ ...ev({ id: 1, project: "Libft", slug: "42cursus-libft", mark: 100 }), feedbacks: [auto, { by: "peer02", rating: 5, comment: "ok" }] }] }, all_projects: [] } as any, "evaluations", { log: "given" });
  const html = logSection(pg).html;
  expect(html).toContain(f.t("log.feedback_auto", { rating: 4 }));
  expect(html).not.toContain("Feedback by ?");
  expect(html).toContain('Feedback by <a class="login-link" href="https://acerezo.top/user/peer02"');
});

test("42's automatic feedback is left out of Feedback's averages and its list, and named apart in a list that opens", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const feedbackOf = (report: any) => evaluations(new Page(f, { period: "all", report, layout: doc.layout, all_projects: report.projects, all_cursus: report.extras.cursus } as any, "evaluations", {})).find((s) => s.id === "feedback")!.html;
  const before = feedbackOf(all);
  expect(before).not.toContain("auto-apart");
  const auto = { by: null, rating: 4, comment: "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time).", auto: true };
  const given = all.given.map((e: any, i: number) => (i === 0 ? { ...e, feedbacks: [...e.feedbacks, auto] } : e));
  const after = feedbackOf({ ...all, given });
  const head = (html: string) => html.slice(0, html.indexOf("<details"));
  expect(after.slice(0, after.indexOf('<details class="apart auto-apart"'))).toBe(before.slice(0, after.indexOf('<details class="apart auto-apart"'))); // not one figure moved
  expect(after).toContain(f.plural(1, "feedback.auto_apart"));
  expect(after).toContain(given[0].project);
  expect(head(after)).not.toContain("by ?");
});

test("Feedback goes by when you corrected: a rush corrected as a student is the student's, one corrected as a pisciner the Piscine's", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), P = doc.periods, all = P.all;
  const f = new Fmt("en");
  const feedbackOf = (period: string, report: any, extra: any = {}) => evaluations(new Page(f, { period, report, layout: doc.layout, all_projects: all.projects,
    all_cursus: all.extras.cursus, ...extra } as any, "evaluations", {})).find((s) => s.id === "feedback")!.html;
  const head = (html: string) => html.slice(0, html.indexOf("<details") < 0 ? undefined : html.indexOf("<details"));
  const rush = (id: number, begin: string, comment: string) => ({ ...P.student.given[0], id, project: "C Piscine Rush 00", slug: "c-piscine-rush-00", cursus: ["C Piscine"], begin,
    feedbacks: [{ by: "peer41", rating: 3, comment }] }); // the kickoff is 2025-08-29 09:42
  const asStudent = rush(900201, "2025-11-02 10:00", "Rush as a student."), asPisciner = rush(900202, "2025-08-10 10:00", "Rush as a pisciner.");
  // the student view gets the Piscine period's evaluations from the kickoff on beside its own (piscine_as_student)
  const student = feedbackOf("student", P.student, { piscine_as_student: { received: [], given: [asStudent] } });
  expect(head(student)).toContain("Rush as a student.");
  expect(student).not.toContain(f.plural(1, "feedback.apart"));
  // the report files both under the Piscine: there only the one from before the kickoff stays
  const piscine = feedbackOf("piscine", { ...P.piscine, given: [asStudent, asPisciner] });
  expect(piscine).toContain("Rush as a pisciner.");
  expect(piscine).not.toContain("Rush as a student.");
  expect(feedbackOf("all", { ...all, given: [...all.given, asStudent, asPisciner] })).toContain("Rush as a student.");
});

test("your rating as evaluator counts what Feedback counts: a rush corrected as a student is in the student's average", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), P = doc.periods;
  const f = new Fmt("en");
  const rush = { ...P.student.given[0], id: 900211, project: "C Piscine Rush 00", slug: "c-piscine-rush-00", cursus: ["C Piscine"], begin: "2025-11-02 10:00",
    feedbacks: [{ by: "peer41", rating: 0 }] };
  const secs = evaluations(new Page(f, { period: "student", report: P.student, layout: doc.layout, all_projects: P.all.projects, all_cursus: P.all.extras.cursus,
    piscine_as_student: { received: [], given: [rush] } } as any, "evaluations", { role: "given" }));
  const ratings = [...P.student.given, rush].flatMap((e: any) => e.feedbacks.filter((x: any) => !autoFeedback(x) && typeof x.rating === "number").map((x: any) => x.rating));
  const mean = ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length;
  const html = (id: string) => secs.find((s) => s.id === id)!.html;
  expect(html("community")).toContain(`>${f.num(mean, 2)}<`);
  expect(html("community")).toContain(f.t("community.s_rating", { n: f.num(ratings.length) }));
  expect(html("over-time")).toContain(f.num(mean, 2));
});

test("in the lists that open (Discovery piscines, 42's automatic feedback) a rating under the maximum shows its squares; at the maximum a plain line", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), P = doc.periods;
  const f = new Fmt("en");
  const disco = (id: number, rating: number, comment: string) => ({ ...P.student.given[0], id, project: "Discovery Piscine - Web 00", slug: "discovery-piscine-web-00",
    cursus: ["Discovery Piscine - Web"], begin: "2025-10-01 10:00", feedbacks: [{ by: "peer42", rating, comment }] });
  const auto = { by: null, rating: 4, comment: "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time).", auto: true };
  const given = [...P.student.given, disco(900301, 2, "Low discovery."), disco(900302, 5, "Top discovery."), { ...P.student.given[1], feedbacks: [auto] }];
  const html = evaluations(new Page(f, { period: "student", report: { ...P.student, given }, layout: doc.layout, all_projects: P.all.projects, all_cursus: P.all.extras.cursus } as any,
    "evaluations", {})).find((s) => s.id === "feedback")!.html;
  const apart = html.slice(html.indexOf('<details class="apart">'), html.indexOf('<details class="apart auto-apart">'));
  expect(apart).toMatch(/<li class="fb-item">(?:(?!<\/li>).)*Low discovery\./s);
  expect(apart).not.toMatch(/<li class="fb-item">(?:(?!<\/li>).)*Top discovery\./s);
  expect(apart).toContain("Discovery Piscine - Web 00");
  const autos = html.slice(html.indexOf('<details class="apart auto-apart">'));
  expect(autos).toContain('class="fb-item"');
  expect(autos).not.toContain("by ?");
});

test("staff get their own row by milestone, taken from the group the report counted each one in; nothing is lost", () => {
  const stats = { "outer-core": { received: 4, received_out: 1, given: 2, given_out: 0 }, "no-cursus": { received: 3, received_out: 0, given: 1, given_out: 0 } };
  const received = [{ corrector: { login: "boss", staff: true }, outstanding: true }, { corrector: { login: "boss", staff: true } }, { corrector: { login: "tutor", staff: true } }, { corrector: { login: "peer01" } }];
  const given = [{ correcteds: [{ login: "tutor", staff: true }, { login: "me" }] }];
  const got = staffApart(stats, received, given, "me", new Map([["boss", "outer-core"]]));
  expect(got.staff).toEqual({ received: 3, received_out: 1, given: 1, given_out: 0 });
  expect(got["outer-core"]).toEqual({ received: 2, received_out: 0, given: 2, given_out: 0 });
  expect(got["no-cursus"]).toEqual({ received: 2, received_out: 0, given: 0, given_out: 0 });
  expect(staffApart(stats, [{ corrector: { login: "peer01" } }], [], "me", new Map())).toEqual(stats);
});

test("Over time: Received | Given by the title on larger screens, under the title's line on phones, over the description", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const derive = JSON.parse(readFileSync("../server/core/testdata/golden/mid.derive.json", "utf8")).all;
  const pg = new Page(new Fmt("en"), { period: "all", report: all, derive, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "over-time")!.html;
  expect(html).toMatch(/<\/h2><div class="seg wide-only"[^>]*>/); // by the title
  expect(html).toMatch(/<\/div><\/div><div class="seg under-title"[^>]*>.*?<\/div><p class="lede">/); // phones: under the title's line, then the description
});

test("Over time's description names negative flags only when there are some, and ends without a full stop when it doesn't", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const derive = JSON.parse(readFileSync("../server/core/testdata/golden/mid.derive.json", "utf8")).all;
  const lede = (summary: any, q = {}) => evaluations(new Page(new Fmt("en"), { period: "all", report: { ...all, summary: { ...all.summary, ...summary } }, derive, layout: doc.layout,
    all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", q)).find((s) => s.id === "over-time")!.html.match(/<p class="lede">([^<]*)<\/p>/)![1];
  expect(lede({ received_negative: 0 })).toMatch(/^Average mark [\d.]+ · [\d.]+% Outstanding$/);
  expect(lede({ received_negative: 2 })).toMatch(/ Outstanding · 2 red flags\.$/);
  expect(lede({ received_negative: 1 })).toMatch(/ · 1 red flag\.$/);
  expect(lede({ given_negative: 0 }, { role: "given" })).toMatch(/^Average mark [\d.]+$/);
});

test("yours you cancelled: the only project handed in and waiting then, even before any evaluation of it, never a company's work experience part", () => {
  const html = cancelledSection(cancelPage({ cancels: [{ kind: "self", at: "2026-02-16 16:16", at_ms: Date.parse("2026-02-16T15:16:00Z") }] }))!.html;
  expect(cardTips(html)[0]).toContain("16 Feb 2026 16:16 · Inception"); // CPP Module 05 was not handed in yet
});

test("yours you cancelled with several projects waiting: not one with every evaluation already booked; the one booked again within two hours; else none", () => {
  const at = (s: string) => Date.parse(s.replace(" ", "T") + ":00Z");
  const done = (team: number, closed: string, end: string) => [{ team_id: team, closed, status: "finished", end_ms: at(end) }];
  const ev = (team: number, project: string, booked: string, begin: string) => ({ team_id: team, project, booked, begin, begin_ms: at(begin) });
  const pg = (received: any[]) => new Page(new Fmt("en"), { period: "student", layout: {}, report: { profile: { login: "me" },
    correction_points: { cancels: [{ kind: "self", at: "2026-02-26 17:18", at_ms: at("2026-02-26 17:18") }] },
    projects: [{ name: "CPP Module 06", exam: false, attempts: done(6, "2026-02-26 15:49", "2026-02-26 18:30") },
      { name: "CPP Module 08", exam: false, attempts: done(8, "2026-02-26 17:18", "2026-02-26 20:00") },
      { name: "Work Experience I - Duration", exam: false, attempts: [{ team_id: 9, closed: "2026-01-01 10:00", status: "waiting_for_correction" }] }],
    received, given: [] }, all_projects: [] } as any, "evaluations", {});
  const tip = (received: any[]) => cardTips(cancelledSection(pg(received))!.html)[0];
  const six = [ev(6, "CPP Module 06", "2026-02-26 15:49", "2026-02-26 17:30"), ev(6, "CPP Module 06", "2026-02-26 15:49", "2026-02-26 18:00")];
  // CPP Module 06 had both its evaluations booked already, though it was evaluated first
  expect(tip([...six, ev(8, "CPP Module 08", "2026-02-27 10:00", "2026-02-27 19:00"), ev(8, "CPP Module 08", "2026-02-27 10:01", "2026-02-27 19:30")])).toContain("26 Feb 2026 17:18 · CPP Module 08");
  // neither booked through: CPP Module 08 booked again a minute later
  const sixOpen = [ev(6, "CPP Module 06", "2026-02-26 15:49", "2026-02-26 17:30"), ev(6, "CPP Module 06", "2026-02-27 09:00", "2026-02-27 18:00")];
  expect(tip([...sixOpen, ev(8, "CPP Module 08", "2026-02-26 17:19", "2026-02-26 19:00")])).toContain("26 Feb 2026 17:18 · CPP Module 08");
  // neither booked through and nothing booked near it: it can't be told
  const sixFar = [ev(6, "CPP Module 06", "2026-02-25 10:00", "2026-02-26 17:30"), ev(6, "CPP Module 06", "2026-02-27 09:00", "2026-02-27 18:00")];
  expect(tip([...sixFar, ev(8, "CPP Module 08", "2026-02-27 12:00", "2026-02-27 19:00")])).toContain("26 Feb 2026 17:18 · –");
});

test("the log's seat column shows on phones too while a seat filter is on (how late you were is under your seat)", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const html = (q = {}) => logSection(new Page(new Fmt("en"), { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", q)).html;
  const seatTh = (h: string) => h.match(/<th[^>]*>(?:(?!<\/th>).)*?>Seat<(?:(?!<\/th>).)*<\/th>/)![0];
  expect(seatTh(html())).toContain("narrow-hide");
  expect(seatTh(html({ seat: "late" }))).not.toContain("narrow-hide");
  expect(seatTh(html({ seat: "me" }))).not.toContain("narrow-hide");
});

test("a mark is red with a negative flag, a 0 or anything under 80; green from 80 (owner, 2026-11-25)", async () => {
  const { redMark } = await import("./page");
  expect([redMark({ mark: 0 }), redMark({ mark: 79 }), redMark({ mark: 80 }), redMark({ mark: 125, negative_flag: true }), redMark({ mark: 100, negative: true }), redMark({ mark: null })])
    .toEqual([true, true, false, true, true, false]);
});

test("a flag's badge: OK in green, Outstanding in deep green, a negative one in red", async () => {
  const { flagBadge } = await import("./page");
  const f = new Fmt("en");
  expect(flagBadge(f, { flag: "Ok" })).toBe('<span class="badge ok">Ok</span>');
  expect(flagBadge(f, { flag: "Outstanding project", outstanding: true })).toContain('class="badge out"');
  expect(flagBadge(f, { flag: "Norme", negative_flag: true })).toBe('<span class="badge bad">Norme</span>');
});

test("fail rates are waffles with a finding said first; reciprocity too; no thin bars", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8")), all = doc.periods.all;
  const f = new Fmt("en");
  const pg = new Page(f, { period: "all", report: all, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus } as any, "evaluations", {});
  const html = evaluations(pg).find((s) => s.id === "community")!.html;
  expect(html).not.toContain("rate-bar");
  expect(html.match(/class="waffle"/g)!.length).toBe(4);
  expect(html).toContain('<p class="finding">');
  expect(say(f, "ev2.find_points", { earned: "5", spent: "<i>" })).toBe('<p class="finding">In this period you earned <b>5</b> [[correction points]] and spent <b>&lt;i&gt;</b>.</p>');
});
