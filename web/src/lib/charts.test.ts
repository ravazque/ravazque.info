import { expect, test } from "vitest";
import { BAD, S1, fourSteps, hbars, lines, packRows, qline, seatbars, tightAxis, vbars } from "./charts";
import { Fmt } from "../fmt";

test("a negative value still draws its bar, as long as its size and in red", () => {
  const html = hbars(new Fmt("en"), ["Evaluations", "Other"], [["Points", [100, -300], S1]], { label: "Points" });
  const bars = [...html.matchAll(/<i style="width:([\d.]+)%;background:([^;"]+)/g)].map((m) => ({ width: Number(m[1]), color: m[2] }));
  expect(bars).toHaveLength(2);
  expect(bars[1].color).toBe(BAD);
  expect(bars[1].width).toBeCloseTo(3 * bars[0].width, 1);
});
test("a tight axis ends at the first tick over the highest value", () => {
  expect(tightAxis(28000)).toEqual({ top: 37500, steps: 3 });
  expect(tightAxis(17500)).toEqual({ top: 20000, steps: 4 });
  expect(tightAxis(20000)).toEqual({ top: 20000, steps: 4 });
  expect(tightAxis(0)).toEqual({ top: 1, steps: 4 });
});

test("Points per month's scale: up to 37.5k for a best month of 28k, not 50k", () => {
  const f = new Fmt("en"), series: [string, number[], string][] = [["Points", [12000, 28000], "red"]];
  const tight = vbars(f, ["Jan", "Feb"], series, { label: "x", stacked: true, tight: true });
  expect(tight).toContain("37.5k");
  expect(tight).not.toContain("50k");
  expect(vbars(f, ["Jan", "Feb"], series, { label: "x", stacked: true })).toContain("50k");
});

test("the last label of many columns (months) spills left, not off the chart; a few wide columns keep it under their bars", () => {
  const f = new Fmt("en"), months = Array.from({ length: 12 }, (_, i) => `M${i}`);
  expect(vbars(f, months, [["a", months.map(() => 1), "red"]], { label: "x" })).toContain('class="ch-x edge"');
  expect(vbars(f, ["c1", "c2", "not logged"], [["a", [1, 2, 3], "red"]], { label: "x" })).toContain('class="ch-x"');
});

test("a running-total line: a dot per label joined by a line, each label's strip with its tip", () => {
  const f = new Fmt("en");
  const html = qline(f, ["Q1 26", "Q2 26", "Q3 26"], [4, 2, 7], { label: "Balance", color: "black", tips: ["a", "b", "c"] });
  expect(html.match(/class="ch-col ql"/g)?.length).toBe(3);
  // the dots apart from the line, as in XP per month: they fade in once it is drawn
  expect(html.match(/class="ch-dot"/g)?.length).toBe(3);
  expect(html).not.toContain("ch-dots");
  expect([...html.matchAll(/class="ch-dot" style="--d:([\d.]+)/g)].map((m) => m[1])).toEqual(["0.000", "0.500", "1.000"]); // left to right
  expect(html).toContain('data-tip="b"');
  expect(html).not.toContain("ch-zero"); // nothing under 0: no zero line of its own
});

test("a stack's parts grow one after the other: each one present gets its turn, from the bottom up", () => {
  const html = vbars(new Fmt("en"), ["Jan"], [["a", [3], "red"], ["b", [0], "blue"], ["c", [2], "green"], ["d", [1], "grey"]], { label: "x", stacked: true });
  expect([...html.matchAll(/--k:(\d)/g)].map((m) => m[1])).toEqual(["0", "1", "2"]); // the empty one takes no turn
});

test("a line chart's month labels are real months, counted back from the last, which always shows at the edge", () => {
  const f = new Fmt("en"), at = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const labels = (html: string) => [...html.matchAll(/<span( class="end")? style="left:[\d.]+%">([^<]+)<\/span>/g)].map((m) => (m[1] ? `${m[2]}|end` : m[2]));
  const html = lines(f, [["a", [{ x: at("2025-10-03"), y: 1 }, { x: at("2026-09-20"), y: 9 }], "red"]], { label: "x", to: at("2026-11-10") });
  const xs = labels(html);
  expect(xs.at(-1)).toBe("Nov 26|end"); // the line reaches the report's day, and so does the axis
  expect(new Set(xs).size).toBe(xs.length); // no month twice
  expect(xs).toEqual(["Nov 25", "Jan 26", "Mar 26", "May 26", "Jul 26", "Sep 26", "Nov 26|end"]); // every other month, from the end
  const plain = labels(lines(f, [["a", [{ x: at("2026-01-10"), y: 1 }, { x: at("2026-04-20"), y: 3 }], "red"]], { label: "x" }));
  expect(plain).toEqual(["Jan 26", "Feb 26", "Mar 26", "Apr 26|end"]);
});

test("a balance's axis counts in whole points: no 12.5 between two balances", () => {
  for (const values of [[3, -7, -22, -24, -2], [0, 1, 2], [4, -1], [0, 37, 180]]) {
    const html = qline(new Fmt("en"), values.map((_, i) => `w${i}`), values, { label: "x", color: "red", tips: values.map(() => "") });
    const ticks = [...html.matchAll(/<span style="bottom:[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThan(8);
    expect(ticks.filter((t) => /[.,]\d/.test(t))).toEqual([]);
    expect(ticks).toContain("0");
  }
});

test("a long line chart names months evenly, counted back from the month the data ends in: no label of the margin after it", () => {
  const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
  const html = lines(new Fmt("en"), [["a", [{ x: day("2022-03-10"), y: 1 }, { x: day("2026-04-20"), y: 9 }], "#000"]], { label: "x", to: day("2026-11-12") });
  const months = html.slice(html.indexOf('class="ch-months"'));
  const at = [...months.matchAll(/left:([\d.]+)%">([^<]+)</g)].map((m) => [+m[1], m[2]] as [number, string]);
  expect(at.at(-1)![1]).toBe("Nov 26");
  const gaps = at.slice(1).map(([x], i) => x - at[i][0]);
  expect(Math.min(...gaps)).toBeGreaterThan(0.8 * Math.max(...gaps)); // the last two were 7 months apart among gaps of 9
  expect(new Set(at.map(([, n]) => n)).size).toBe(at.length);
});

test("lanes: bars side by side each get their whole lane and a tip of their own series, built from the values", () => {
  const html = vbars(new Fmt("en"), ["0–1h", "1+h"], [["Received", [3, 0], "blue"], ["Given", [1, 2], "grey"]], { label: "x", lanes: true, fmt: String });
  expect([...html.matchAll(/<span class="lane"[^>]*data-tip="([^"]+)"/g)].map((m) => m[1])).toEqual(["0–1h\nReceived: 3", "0–1h\nGiven: 1", "1+h\nReceived: 0", "1+h\nGiven: 2"]);
  expect(html).not.toMatch(/class="ch-col"[^>]*data-tip/);
});

test("bar tips: each bar's whole lane, above it too, opens its own series' tip; the column none", () => {
  const html = vbars(new Fmt("en"), ["c1", "c2"], [["You", [3, 0], "blue"], ["Them", [1, 2], "grey"]],
    { label: "x", barTips: [["c1 you", "c2 you"], ["c1 them", "c2 them"]] });
  expect([...html.matchAll(/<span class="lane"[^>]*data-tip="([^"]+)"[^>]*><i /g)].map((m) => m[1])).toEqual(["c1 you", "c1 them", "c2 you", "c2 them"]);
  expect(html).not.toMatch(/<i [^>]*data-tip/);
  expect(html).not.toMatch(/class="ch-col"[^>]*data-tip/);
});

test("projects pack onto as few rows as their names allow: every attempt on its own row with its name, others beside it when they don't touch", () => {
  const item = (name: string, a: number, b: number) => ({ name, spans: [[a, b, "c", "tip"]] as [number, number, string, string][] });
  // one character takes 1 unit of time: "a" (1) after its attempt needs [0, 10 + 1 + gap 1]
  const rows = packRows([item("a", 0, 10), item("b", 12, 20), item("c", 5, 15), item("dd", 90, 99)], 0, 100, 1, 1);
  expect(rows.map((r) => r.map((x) => x.item.name))).toEqual([["a", "b", "dd"], ["c"]]);
  expect(rows[0][0].side).toBe("after");
  // near the right end the name goes before the first attempt, and that room counts
  expect(rows[0][2].side).toBe("before");
  expect(packRows([item("a", 0, 10), item("dd", 13, 99)], 0, 100, 1, 1).length).toBe(2); // "dd" before 13 starts at 10, inside "a"'s room
  expect(packRows([item("a", 0, 10), item("b", 11, 20)], 0, 100, 1, 1).length).toBe(2); // "a" after its bar reaches 12: b can't start at 11
  // every attempt of a project stays on its row, even when they are far apart
  const two = { name: "p", spans: [[0, 5, "c", "t"], [50, 60, "c", "t"]] as [number, number, string, string][] };
  expect(packRows([two, item("q", 20, 30)], 0, 100, 1, 1).map((r) => r.map((x) => x.item.name))).toEqual([["p"], ["q"]]);
  // from one end to the other (handed in again years later): the name goes in the gap after its first attempt
  const wide = { name: "abc", spans: [[1, 3, "c", "t"], [80, 99, "c", "t"]] as [number, number, string, string][] };
  expect(packRows([wide], 0, 100, 1, 1)[0][0]).toMatchObject({ side: "between", at: 3 });
  // no room in that gap either: after the last attempt, past the end (the chart widens its axis to show it)
  const tight = { name: "abcdef", spans: [[1, 3, "c", "t"], [5, 99, "c", "t"]] as [number, number, string, string][] };
  expect(packRows([tight], 0, 100, 1, 1)[0][0]).toMatchObject({ side: "after", at: 99, to: 106 });
});

test("a chart's lines follow its numbers: as many steps between lines as between numbers", () => {
  const f = new Fmt("en");
  const html = vbars(f, ["a", "b"], [["XP", [10, 28000], S1]], { label: "x", tight: true }); // three quarters of 50k: 37.5k
  const numbers = html.match(/<div class="ch-y"[^>]*>(.*?)<\/div>/)![1].match(/<span/g)!.length;
  expect(html).toContain('class="ch-plot" style="--steps:3"');
  expect(numbers).toBe(3 + 1); // 0 and one at each line
  expect(qline(f, ["a", "b"], [0, 7], { label: "x", color: S1, tips: ["", ""] })).toContain('style="--steps:4"'); // 0, 2, 4, 6, 8
});

test("four even steps of a round size, whole ones for counts: two charts side by side share their lines", () => {
  expect(fourSteps(28000)).toEqual({ top: 32000, steps: 4 });
  expect(fourSteps(41000)).toEqual({ top: 60000, steps: 4 });
  expect(fourSteps(9)).toEqual({ top: 12, steps: 4 }); // not 2.5 students a step
  expect(fourSteps(1)).toEqual({ top: 4, steps: 4 });
});

test("seat bars: a lit square per unit out of the longest list's, the same count on every row", () => {
  const html = seatbars([{ label: "C", n: 3, end: "3", tip: "C" }, { label: "Unix", n: 1, end: "1", tip: "Unix" }], { label: "x", of: 5 });
  const rows = [...html.matchAll(/<span class="seats"[^>]*>(.*?)<\/span>/g)].map((m) => [m[1].match(/class="on"/g)?.length || 0, m[1].match(/<i/g)!.length]);
  expect(rows).toEqual([[3, 5], [1, 5]]);
  expect(html).toContain("<li><span class=\"sb-label\" data-tip="); // the tip on the name, the squares and the figures, not the row
  expect(html.match(/data-tip="C"/g)?.length).toBe(3);
  expect(seatbars([], { label: "x", of: 5, emptyText: "none" })).toContain("none");
  expect(seatbars([{ label: "C", n: 3, end: "3", tip: "C", note: "Level 9" }], { label: "x", of: 5 })).toContain('aria-label="x: C Level 9 3"'); // what the squares stand for, read out
});

test("a bar chart's labels are counted back from the last, which always shows, narrow charts too (never .alt)", () => {
  const f = new Fmt("en");
  for (const n of [19, 31]) {
    const labels = Array.from({ length: n }, (_, i) => `L${i}`);
    const xs = vbars(f, labels, [["x", labels.map(() => 1), S1]], { label: "x" }).match(/<div class="ch-x[^"]*"[^>]*>(.*?)<\/div>/)![1];
    const spans = [...xs.matchAll(/<span( class="alt")?>([^<]*)<\/span>/g)];
    expect(spans.at(-1)![2]).toBe(`L${n - 1}`);
    expect(spans.at(-1)![1]).toBeUndefined();
  }
});

test("a colour means one thing everywhere: green is OK or passed (deep green Outstanding), so in progress is a grey", async () => {
  const { GOOD, NEUTRAL, OUTSTANDING } = await import("./charts");
  expect([GOOD, OUTSTANDING]).toEqual(["var(--ok)", "var(--ok-deep)"]);
  expect(NEUTRAL).not.toMatch(/--ok/);
});

test("a waffle draws shares of a whole as 100 squares that add up, a key naming each part with its count", async () => {
  const { waffle } = await import("./charts");
  const html = waffle([{ label: "first time", value: 320, color: "var(--ok)" }, { label: "second", value: 206, color: "red" }, { label: "later", value: 483, color: "blue" }], { label: "Of every 100 who pass" });
  expect((html.match(/<i class="wf-sq"/g) || []).length).toBe(100);
  expect((html.match(/class="wf-sq" style="background:var\(--ok\)"/g) || []).length).toBe(32); // 320 of 1,009
  expect(html).toContain("first time</span><b>32</b>");
  expect(html).toContain('aria-label="Of every 100 who pass: first time 32, second 20, later 48"');
  expect(waffle([], { label: "x" })).toBe("");
});

test("a meter fills up to its value with each mark named under it", async () => {
  const { meter } = await import("./charts");
  const html = meter(14.8, 24, { label: "Hours this week", marks: [{ at: 15, label: "bonus" }], ends: ["0 h", "24 h"] });
  expect(html).toContain('style="width:61.67%"');
  expect(html).toContain('<u style="left:62.50%"');
  expect(html).toContain(">bonus</span>");
});

test("standing puts you on the line among everyone, the share behind you said in words", async () => {
  const { standing } = await import("./charts");
  const html = standing([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8, { label: "Level in your promo", meLabel: "You · 8", low: "lowest", high: "highest" });
  expect((html.match(/class="st-dot"/g) || []).length).toBe(10);
  expect(html).toContain('class="st-me" style="left:77.78%"');
  expect(html).toContain("You · 8");
});
