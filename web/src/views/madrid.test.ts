import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { Page, type PageKey } from "./page";
import { examsPage, summaryPage } from "./madrid";

// synthetic figures only
const pageOf = (key: PageKey, projects: any[] = []) =>
  new Page(new Fmt("en"), { period: "student", report: { extras: {}, projects }, all_projects: projects } as any, key, {});
const base = { generated_at: "2026-11-23T03:00:00Z", requests: 1800, seconds: 2000, people: { total: 1200, by_state: { active: 400, blackholed: 700, transcender: 60, alumni: 40 } }, cohorts: [] };
const tips = (html: string) => [...html.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));

test("last week in six modules, each tip saying the figures, then how it counts (who is left out, under 5)", () => {
  const week = { from: "2026-11-16", to: "2026-11-22", evaluations: 3120, students: 1300, per_student: 2.4, outstanding: 210, negative_flags: 95,
    passed: 480, failed: 160, exams_passed: 70, exams_failed: null, blackholed: 12 };
  const [w] = summaryPage(pageOf("madrid"), { ...base, week, weeks: [] });
  expect(w.id).toBe("week");
  expect(w.html).toContain("16 Nov – 22 Nov 2026");
  expect((w.html.match(/<div data-tip=/g) || []).length).toBe(6);
  const [evals, , , exams] = tips(w.html);
  expect(evals.split("\n").slice(0, 3)).toEqual(["Evaluations · 16 Nov – 22 Nov 2026", "3,120 evaluations · 2.4 per student (1,300 students)", "---"]);
  expect(evals).toContain("# How it counts");
  expect(evals).toContain("Left out: staff and whoever asked to be left out of the statistics.");
  expect(exams).toContain("failed: < 5"); // under 5: no share made up from it
  expect(exams).toContain("· – passed");
});

test("the twelve weeks as two charts, and who is here; a count from before the weekly figures shows what it has", () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({ from: `2026-09-${String(i + 1).padStart(2, "0")}`, evaluations: 100 + i, passed: 20, failed: 5 }));
  const ids = summaryPage(pageOf("madrid"), { ...base, weeks }).map((s) => s.id);
  expect(ids).toEqual(["trend", "people"]); // no empty week section before the weekly figures
  expect(summaryPage(pageOf("madrid"), null)[0].html).toContain("No campus count yet");
});

const exam = (slug: string, name: string, more: any) => ({ slug, name, track: slug.startsWith("42next") ? "python" : "c", milestone: "rank-02", ...more });

test("each exam: who signed up, passed, how many sittings failed, passed the first time, in which sitting, median days, and you", () => {
  const stats = { ...base, projects: [
    exam("exam-rank-03", "Exam Rank 03", { registered: 848, passed: 769, attempts: 1976, failed_attempts: 1204, first_try: 366, tries: [366, 175, 86, 142], median_days: 11 }),
    exam("exam-rank-02", "Exam Rank 02", { registered: 1222, passed: 1009, attempts: 4121, failed_attempts: 3087, first_try: 320, tries: [320, 206, 152, 331], median_days: 21.5 }),
    exam("42next-exam-rank-06", "Exam Rank 06", { registered: 3, passed: 2, attempts: 7, failed_attempts: 5, first_try: 1, tries: [1, 0, 1, 0], median_days: null }),
    { slug: "42cursus-libft", name: "Libft", track: "c", registered: 2000 }] };
  const mine = [{ slug: "exam-rank-02", exam: true, attempts: [{ validated: false }, { validated: true }] }, { slug: "exam-rank-03", exam: true, attempts: [{ validated: false }] }];
  const [c, py] = examsPage(pageOf("exams", mine), stats);
  expect(c.id).toBe("exams-c");
  const rows = [...c.html.matchAll(/<tr>(.*?)<\/tr>/gs)].slice(1).map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((d) => d[1]));
  expect(rows.map((r) => r[0])).toEqual(["Exam Rank 02", "Exam Rank 03"]);
  expect(rows[0].slice(1, 6)).toEqual(["1,222", "83% · 1,009", "4,121", "75%", "32%"]);
  expect(rows[0][7]).toBe("21.5");
  expect(rows[0][8]).toBe("Passed, sitting 2");
  expect(rows[1][8]).toBe("1 sitting, not passed");
  expect(c.html).toContain("Exam Rank 02 is the exam [[most often failed]]: <b>75%</b> of the times someone sits it end in a fail");
  expect(c.html).toContain("Of every 100 who pass Exam Rank 02, on [[which try]]"); // the hardest exam's waffle
  expect(c.html.match(/class="wf-sq"/g)).toHaveLength(100);
  expect(c.html).toContain("Half pass by try 2"); // each row: the median try, plain
  expect(c.html).not.toContain("tries-bar");
  expect(c.html).toContain("shows &lt; 5 instead of the number"); // under 5, said once per page
  expect(tips(c.html).find((t) => t.startsWith("Exam Rank 02: the try on which students passed it\nTypical sitting: 2"))).toContain("Sitting 4 or later: 331 (33%)");
  expect(py.id).toBe("exams-python"); // 1 to 4 signed up: exact figures (policy v8)
  expect(py.html).toContain("67% · 2");
});

test("42 Madrid is one link of the band, its tabs have addresses of their own and none repeats a page of yours", async () => {
  const { PAGES, PATHS, CAMPUS_TABS } = await import("./page");
  expect(PAGES.at(-1)).toBe("madrid");
  expect(PAGES).not.toContain("exams");
  expect(CAMPUS_TABS.map((k) => PATHS[k])).toEqual(["/app/madrid", "/app/madrid/exams", "/app/madrid/42cursus", "/app/madrid/piscine"]);
});

test("your exams beside 42 Madrid's: the share passing the first time and the median days, your own track's when both share a name", async () => {
  const { examMadrid } = await import("./projects");
  const mine = [
    { slug: "exam-rank-04", name: "Exam Rank 04", exam: true, attempts: [{ start: "2025-03-01 10:00" }, { start: "2025-04-01 10:00" }] },
    { slug: "42next-exam-rank-04", name: "Exam Rank 04", exam: true, attempts: [{ start: "2025-09-01 10:00" }] }];
  const stats = { projects: [exam("exam-rank-04", "Exam Rank 04", { registered: 686, passed: 647, first_try: 357, median_days: 12.7 }),
    exam("42next-exam-rank-04", "Exam Rank 04", { registered: 59, passed: 50, first_try: null, median_days: 5.7 })] };
  const pg = pageOf("projects", mine);
  const c = examMadrid(pg, { name: "Exam Rank 04", attempts: 2, tries: [{ date: "2025-03-01" }, { date: "2025-04-01" }] }, stats)!;
  expect(c.text).toBe("55% first time · 12.7 days");
  expect(c.tip.split("\n")).toContain("# How it counts");
  expect(examMadrid(pg, { name: "Exam Rank 04", attempts: 1, tries: [{ date: "2025-09-01" }] }, stats)!.text).toBe("< 5 first time · 5.7 days");
  expect(examMadrid(pg, { name: "Exam Rank 04", attempts: 1, tries: [{ date: "2025-09-01" }] }, null)).toBeNull(); // no count yet
  const piscine = pageOf("projects", [{ slug: "c-piscine-exam-00", name: "C Piscine Exam 00", exam: true, attempts: [{ start: "2024-07-05 10:00" }] }]);
  expect(examMadrid(piscine, { name: "C Piscine Exam 00", attempts: 1, tries: [{ date: "2024-07-05" }] },
    { projects: [], piscine: { projects: [{ slug: "c-piscine-exam-00", registered: 3958, passed: 810, median_mark: 48 }] } })!.text).toBe("20% passed · mark 48");
});
