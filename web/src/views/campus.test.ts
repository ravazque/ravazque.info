import { expect, test } from "vitest";
import { lateByCluster } from "./campus";

test("late logins by cluster: yours where you sat when received, each student's seat when given", () => {
  const received = [{ my_host: "c1r2s3", my_late_min: 12 }, { my_host: "c1r4s1", my_late_min: null }, { my_host: "c2r1s1", my_late_min: 3 }, { my_host: null }];
  expect(lateByCluster("received", received)).toEqual({ c1: 1, c2: 1 });
  const given = [{ other_host_checked: true, correcteds: [{ host: "c3r1s1", late_min: 7 }, { host: "c3r1s2", late_min: 2 }] },
    { other_host_checked: false, correcteds: [{ host: "c1r1s1", late_min: 9 }] }];
  expect(lateByCluster("given", given)).toEqual({ c3: 2 });
});

test("sessions and evaluations on another campus are named, and said to be off the plan and off where", async () => {
  const { readFileSync } = await import("node:fs");
  const { Fmt } = await import("../fmt");
  const { Page } = await import("./page");
  const { campus } = await import("./campus");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8"));
  const all = doc.periods.all;
  all.logtime.log[0] = { ...all.logtime.log[0], host: "c4r9s9", campus: "Urduliz" };
  all.logtime.away = { Urduliz: 3 };
  all.place.received_away = 2;
  const view = { period: "all", report: all, derive: {}, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus, seat_days: 60 } as any;
  const html = campus(new Page(new Fmt("en"), view, "campus", {})).map((s) => s.html).join("");
  expect(html).toContain("Sessions on other campuses, not on the plan: Urduliz: 3 sessions");
  expect(html).toContain("c4r9s9 <span class=\"note\">· Urduliz</span>");
  expect(html).toContain("2 evaluations held on other campuses are left out.");
});

test("Where · evaluations draws received and given apart, side by side (no switch), each column opening its tip", async () => {
  const { readFileSync } = await import("node:fs");
  const { Fmt } = await import("../fmt");
  const { Page } = await import("./page");
  const { campus } = await import("./campus");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8"));
  const all = doc.periods.all, f = new Fmt("en");
  const view = { period: "all", report: all, derive: {}, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus, seat_days: 60 } as any;
  const html = campus(new Page(f, view, "campus", {})).find((s) => s.id === "where")!.html;
  expect(html.match(/data-panel="where-clusters"/g)?.length).toBe(2);
  expect(html.indexOf(f.t("pe2.where_received"))).toBeGreaterThan(0);
  expect(html.indexOf(f.t("pe2.where_given"))).toBeGreaterThan(html.indexOf(f.t("pe2.where_received")));
  expect(html).not.toContain('class="seg"');
  expect(html).not.toContain("col-tips");
  expect(html).toContain(f.t("s3c.cover", { me: all.place.me_located_given, n: all.summary.given }));
  // each bar its own side, on its full-height lane: yours says your count, the corrector's theirs, never both in one tip
  const tips = [...html.matchAll(/<span class="lane"[^>]*data-tip="([^"]+)"/g)].map((m) => m[1]);
  expect(tips.length).toBeGreaterThan(0);
  expect(tips.some((t) => t.includes("You:") && t.includes("Your corrector:"))).toBe(false);
  expect(tips.some((t) => t.includes("Your corrector:"))).toBe(true);
  expect(html.match(/<div class="legend">/g)?.length).toBe(2);
});

test("Where · evaluations with none yet: the empty note alone, no key and no seat counts", async () => {
  const { readFileSync } = await import("node:fs");
  const { Fmt } = await import("../fmt");
  const { Page } = await import("./page");
  const { campus } = await import("./campus");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8"));
  const all = { ...doc.periods.all, received: [], given: [], summary: { ...doc.periods.all.summary, received: 0, given: 0 },
    place: { ...doc.periods.all.place, received_my_cluster: {}, given_my_cluster: {} } }, f = new Fmt("en");
  const view = { period: "all", report: all, derive: {}, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus, seat_days: 60 } as any;
  const html = campus(new Page(f, view, "campus", {})).find((s) => s.id === "where")!.html;
  expect(html).not.toContain('class="legend"');
  expect(html).not.toContain("Seat known");
  expect(html.match(new RegExp(f.t("empty.period"), "g"))?.length).toBe(2);
});

test("campus opens its sections with a finding in plain words: the busiest weekday and hour, the part of the day", async () => {
  const { readFileSync } = await import("node:fs");
  const { Fmt } = await import("../fmt");
  const { Page } = await import("./page");
  const { campus } = await import("./campus");
  const doc = JSON.parse(readFileSync("../server/core/testdata/golden/mid.report.json", "utf8"));
  const all = { ...doc.periods.all, logtime: { ...doc.periods.all.logtime, heat: Array.from({ length: 7 }, (_, w) => Array.from({ length: 24 }, (_, h) => (w === 1 && h === 14 ? 5 : 0))) } };
  const view = { period: "all", report: all, derive: {}, layout: doc.layout, all_projects: all.projects, all_cursus: all.extras.cursus, seat_days: 60 } as any;
  const html = campus(new Page(new Fmt("en"), view, "campus", {})).find((s) => s.id === "days")!.html;
  expect(html).toContain('<p class="finding">You are at campus most on <b>Tuesday</b>, and your [[busiest hour]] is <b>14–15h</b>.</p>');
});
