// Charts as markup: HTML/CSS bars and timelines, SVG lines. Colours are CSS variables, sizes come from ui.json; every
// mark carries a data-tip and every chart an aria-label summary.
import type { Fmt } from "../fmt";
import { esc, pct, tipAttr } from "./h";

export const S1 = "var(--accent-data)", S2 = "var(--slate)";
export const GOOD = "var(--good)", BAD = "var(--critical)", NEUTRAL = "var(--neutral)";

export type Series = [name: string, values: (number | null)[], colour: string];
export type Point = { x: number; y: number };

/** The next round value at or above v for an axis: 1, 2, 2.5, 5 × 10ⁿ. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/** A scale that ends at the first tick over the value, a quarter of the round number at a time (28k: up to 37.5k, not 50k). */
export function tightAxis(v: number): { top: number; steps: number } {
  const step = niceMax(v) / 4, steps = v > 0 ? Math.ceil(v / step) : 4;
  return { top: step * steps, steps };
}

/** Four even steps of a round size over the value (28k: 8k each, up to 32k; counts in whole steps): charts side by side
 * on it keep their lines at the same heights. */
export function fourSteps(v: number): { top: number; steps: number } {
  const q = v / 4, mag = 10 ** Math.floor(Math.log10(q > 0 ? q : 1));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((x) => x >= q && (mag >= 10 || x % 1 === 0)) || 1;
  return { top: step * 4, steps: 4 };
}

export const legend = (items: [string, string][]) =>
  `<div class="legend">${items.map(([l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;

export const empty = (text: string) => `<p class="note chart-empty">${esc(text)}</p>`;

/** An axis tick: thousands as "k" from 10,000 up, so six-digit scales fit a phone's axis. */
const tick = (f: Fmt, v: number, d: number) => (Math.abs(v) >= 10000 ? `${f.num(v / 1000, 1)}k` : f.num(v, d));

function yaxis(f: Fmt, top: number, steps = 4) {
  const q = top / steps;
  const d = q % 1 === 0 ? 0 : (q * 10) % 1 === 0 ? 1 : 2; // quarter ticks keep their decimals
  return `<div class="ch-y" aria-hidden="true">${Array.from({ length: steps + 1 }, (_, k) => `<span style="bottom:${pct(q * k, top)}">${esc(tick(f, q * k, d))}</span>`).join("")}</div>`;
}

type VOpts = {
  label: string; stacked?: boolean; tight?: boolean; xtitle?: string; peak?: string;
  four?: boolean; // four even steps (fourSteps): two charts side by side keep their lines at the same heights
  barTips?: string[][]; // each bar its own series' tip ([series][label]) on its full-height lane, the column none
  lanes?: boolean; // barTips made from the values: "label", then "series: value"
  colTips?: boolean; // the whole column's strip opens the tip (a stacked month told whole), the others dim
  fmt?: (v: number) => string; every?: number; tips?: string[]; emptyText?: string;
  mark?: [index: number, text: string]; // one column marked by a dashed line and its name over the plot (Your promo: you)
};

/** Vertical bars per label, side by side or stacked; line draws over the bars on its own right-hand scale. */
export function vbars(f: Fmt, labels: string[], series: Series[], o: VOpts): string {
  if (!labels.length || !series.some(([, vals]) => vals.some((v) => v))) return empty(o.emptyText || "");
  const fmt = o.fmt || ((v: number) => f.num(v, 1));
  const totals = labels.map((_, i) =>
    o.stacked ? series.reduce((s, [, v]) => s + (v[i] || 0), 0) : Math.max(...series.map(([, v]) => v[i] || 0)));
  const { top, steps } = o.four ? fourSteps(Math.max(...totals)) : o.tight ? tightAxis(Math.max(...totals)) : { top: niceMax(Math.max(...totals)), steps: 4 };
  const every = o.every || Math.max(1, Math.ceil(labels.length / 12));
  const best = totals.indexOf(Math.max(...totals));
  const barTips = o.barTips || (o.lanes ? series.map(([n, v]) => labels.map((lab, i) => `${lab}\n${n}: ${fmt(v[i] || 0)}`)) : undefined);
  const colTip = (series.length === 1 && !o.stacked && !barTips) || !!o.colTips; // one series: the whole column opens the tip
  const cols = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i] : [lab, ...series.map(([n, v]) => `${n} ${fmt(v[i] || 0)}`)].join(" · ");
    let k = 0; // a stack grows from the bottom up, each part in its turn (--k: its place among the parts it has)
    const bars = series.map(([, v, c], si) => {
      const bar = `<i style="height:${pct(v[i] || 0, top)};background:${c}${o.stacked && v[i] ? `;--k:${k++}` : ""}"${v[i] && !colTip && !barTips ? tipAttr(tip) : ""}></i>`;
      return barTips ? `<span class="lane"${tipAttr(barTips[si][i])}>${bar}</span>` : bar; // the bar's whole height opens its tip, like a column
    }).join("");
    const cap = o.mark?.[0] === i ? `<b class="peak you">${esc(o.mark[1])}</b>` : o.peak && i === best
      ? `<b class="peak">${esc(o.peak.replace("{v}", fmt(totals[i])).replace("{label}", lab))}</b>` : "";
    return `<div class="ch-col${o.stacked ? " stack" : ""}${o.mark?.[0] === i ? " you" : ""}"${colTip ? tipAttr(tip) : ""}>${cap}${bars}</div>`;
  });
  // counted back from the last label, so the last month (or level) always shows, on a phone's every-other too
  const back = (i: number) => labels.length - 1 - i;
  const xs = labels.map((lab, i) => (back(i) % every === 0 ? `<span${(back(i) / every) % 2 ? ' class="alt"' : ""}>${esc(lab)}</span>` : "<span></span>")).join("");
  const summary = `${o.label}: ` + labels.flatMap((lab, i) => (totals[i] ? [`${lab} ${fmt(totals[i])}`] : [])).join(", ");
  return `<figure class="vchart${o.colTips ? " col-tips" : ""}" role="img" aria-label="${esc(summary)}">`
    + `<div class="ch-plot" style="--steps:${steps}">${yaxis(f, top, steps)}<div class="ch-cols" style="--n:${labels.length}">${cols.join("")}</div></div>`
    + `<div class="ch-x${labels.length > 8 ? " edge" : ""}" style="--n:${labels.length}" aria-hidden="true">${xs}</div>`
    + (o.xtitle ? `<figcaption class="ch-title">${esc(o.xtitle)}</figcaption>` : "") + "</figure>";
}

/** A running total at the end of each label, as dots joined by a line (the plain line charts' look), each column's
 * whole strip opening its tip. */
/** A dot's place from the left, 0 to 1: the dots draw in in that order (dash.css). */
const dotAt = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0).toFixed(3);

export function qline(f: Fmt, labels: string[], values: number[], o: { label: string; color: string; tips: string[]; emptyText?: string }): string {
  if (!labels.length) return empty(o.emptyText || "");
  // one even step from the lowest to the highest (0 always in): four of them over the span, rounded up
  // whole points: the smallest round step that covers the span in at most five (12.5 was no balance anyone has)
  const lo = Math.min(0, ...values), hi = Math.max(1, ...values);
  let step = 1;
  for (let mag = 1; ; mag *= 10) {
    const m = [1, 2, 5].find((k) => Math.ceil(hi / (k * mag)) - Math.floor(lo / (k * mag)) <= 5);
    if (m) { step = m * mag; break; }
  }
  const bot = -Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step, span = top + bot;
  const at = (v: number) => (100 * (v + bot)) / span; // % from the bottom
  const steps = Array.from({ length: Math.round(span / step) + 1 }, (_, k) => -bot + k * step);
  const ticks = steps.map((v) => `<span style="bottom:${at(v).toFixed(2)}%">${esc(tick(f, v, v % 1 ? 1 : 0))}</span>`).join("");
  const n = labels.length;
  const cols = labels.map((_, i) => `<div class="ch-col ql"${tipAttr(o.tips[i])}></div>`).join("");
  const pts = values.map((v, i) => `${(((i + 0.5) * 1000) / n).toFixed(1)},${(300 - 3 * at(v)).toFixed(1)}`).join(" ");
  const line = `<svg class="ch-line" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" pathLength="1" style="stroke:${o.color}"/></svg>`
    + (n > 100 ? "" : values.map((v, i) => `<i class="ch-dot" style="--d:${dotAt(i, n)};left:${(((i + 0.5) * 100) / n).toFixed(2)}%;bottom:${at(v).toFixed(2)}%;background:${o.color}"></i>`).join("")); // day by day over a year: the line alone
  const every = Math.max(1, Math.ceil(n / 8));
  // counted back from the last label, so the last month (or week) always shows
  const xs = labels.map((lab, i) => ((n - 1 - i) % every === 0 ? `<span${((n - 1 - i) / every) % 2 ? ' class="alt"' : ""}>${esc(lab)}</span>` : "<span></span>")).join(""); // alt: narrow charts show every other one
  return `<figure class="vchart qline col-tips" role="img" aria-label="${esc(o.label)}">`
    + `<div class="ch-plot" style="--steps:${steps.length - 1}"><div class="ch-y" aria-hidden="true">${ticks}</div>${bot ? `<i class="ch-zero" style="top:${((100 * top) / span).toFixed(2)}%"></i>` : ""}`
    + `<div class="ch-cols" style="--n:${n}">${cols}</div>${line}</div>`
    + `<div class="ch-x${n > 8 ? " edge" : ""}" style="--n:${n}" aria-hidden="true">${xs}</div></figure>`;
}

type HOpts = {
  label: string; end?: (i: number, v: number) => string; extra?: (i: number) => string | null | undefined;
  tips?: string[]; emptyText?: string; big?: boolean; min?: number; // min: the scale never ends below it (a few small values stay short)
};

/** Horizontal stacked bars, one row per label, the total at the bar's end. */
export function hbars(f: Fmt, labels: string[], series: Series[], o: HOpts): string {
  if (!labels.length) return empty(o.emptyText || "");
  const totals = labels.map((_, i) => series.reduce((s, [, v]) => s + (v[i] || 0), 0));
  const top = Math.max((Math.max(...totals.map(Math.abs)) || 1) * 1.3, o.min || 0); // the longest bar leaves room for its end label
  const end = o.end || ((_: number, v: number) => f.num(v, Number.isInteger(v) ? 0 : 2));
  const rows = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i] : [lab, ...series.flatMap(([n, v]) => (v[i] ? [`${n} ${f.num(v[i], 2)}`] : []))].join(" · ");
    // a negative value (points taken away) draws as long as it is, in red
    const segs = series.filter(([, v]) => v[i]).map(([, v, c], k) => `<i style="width:${pct(Math.abs(v[i] || 0), top)};background:${(v[i] || 0) < 0 ? BAD : c};--k:${k}"${tipAttr(tip)}></i>`).join("");
    const x = o.extra?.(i);
    return `<div class="hb-row"><span class="hb-label">${esc(lab)}</span><span class="hb-track">${segs}<b>${esc(end(i, totals[i]))}`
      + `${x ? `<span class=hb-extra> · ${esc(x)}</span>` : ""}</b></span></div>`;
  });
  const summary = `${o.label}: ` + labels.map((lab, i) => `${lab} ${end(i, totals[i])}`).join(", ");
  return `<figure class="hchart${o.big ? " big" : ""}" role="img" aria-label="${esc(summary)}">${rows.join("")}</figure>`;
}

export type SeatRow = { label: string; n: number; end: string; tip: string };

/** Rows read by name as a line of squares, one lit per unit out of `of` (ravazque.github.io's skill bars): the longest
 * list sets `of`, so a square is the same thing on every row. */
export function seatbars(rows: SeatRow[], o: { label: string; of: number; emptyText?: string }): string {
  if (!rows.length) return empty(o.emptyText || "");
  // the tip opens on the name, the squares or the figures, beside the one under the pointer; the empty rest of the row is quiet
  const body = rows.map((r) => `<li><span class="sb-label"${tipAttr(r.tip)}>${esc(r.label)}</span><span class="seats"${tipAttr(r.tip)}>`
    + `${'<i class="on"></i>'.repeat(r.n)}${"<i></i>".repeat(Math.max(0, o.of - r.n))}</span><b${tipAttr(r.tip)}>${esc(r.end)}</b></li>`).join("");
  return `<figure class="seatbars" style="--of:${o.of}" role="img" aria-label="${esc(`${o.label}: ${rows.map((r) => `${r.label} ${r.end}`).join(", ")}`)}"><ul>${body}</ul></figure>`;
}

/** Month labels under a time axis: one per real month, under its middle (the 15th), every k-th counted back from the
 * month the data ends in, which always shows, right-aligned so it ends at its place (at the edge when its 15th is past). */
function monthTicks(f: Fmt, lo: number, hi: number, end: number) {
  const span = hi - lo, mid = (t: number, k: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 15, 12); };
  const months: number[] = [], last = mid(end, 0);
  // up to the month the data ends in (named at the edge when it ends before its 15th), never the margin after it
  for (let k = 0, t = mid(lo, 0); t <= last; t = mid(lo, ++k)) if (t >= lo) months.push(t);
  if (months.at(-1) !== last) months.push(last);
  const every = Math.max(1, Math.round(months.length / 8));
  return months.filter((_, i) => (months.length - 1 - i) % every === 0).map((t, i, xs) =>
    `<span${i === xs.length - 1 ? ' class="end"' : ""} style="left:${((100 * (Math.min(t, hi) - lo)) / span).toFixed(2)}%">${esc(f.monthOf(t))}</span>`).join("");
}

/** Time series as SVG lines over an HTML axis. */
export function lines(f: Fmt, series: [string, Point[], string][], o: { label: string; step?: boolean; emptyText?: string; to?: number }): string {
  const step = o.step ?? true;
  const pts = series.flatMap(([, ps]) => ps);
  if (!pts.length) return empty(o.emptyText || "");
  let lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x), o.to ?? 0); // to: the lines carry on flat up to that day
  const end = hi, pad = Math.max((hi - lo) * 0.02, 864e5);
  lo -= pad; hi += pad;
  const top = niceMax(Math.max(...pts.map((p) => p.y)));
  const X = (x: number) => (1000 * (x - lo)) / (hi - lo), Y = (y: number) => 300 - (300 * y) / top;
  const paths = series.filter(([, ps]) => ps.length).map(([, ps, c]) => {
    const d: string[] = [];
    let prev: number | null = null;
    for (const p of [...ps].sort((a, b) => a.x - b.x)) {
      if (prev !== null && step) d.push(`L${X(p.x).toFixed(1)},${Y(prev).toFixed(1)}`);
      d.push(`${d.length ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
      prev = p.y;
    }
    d.push(`L${X(hi).toFixed(1)},${Y(prev!).toFixed(1)}`);
    return `<path d="${d.join(" ")}" pathLength="1" style="stroke:${c}"/>`;
  });
  const n = 40, slices: string[] = [];
  for (let k = 0; k < n; k++) { // the value of every series at the end of each slice
    const at = lo + ((hi - lo) * (k + 1)) / n;
    const vals = series.map(([name, ps]) => {
      const before = ps.filter((p) => p.x <= at);
      return `${name} ${f.num(before.length ? before[before.length - 1].y : 0, 1)}`;
    });
    slices.push(`<i${tipAttr(f.stamp(at).split(",")[0] + " · " + vals.join(" · "))}></i>`);
  }
  const last = series.filter(([, ps]) => ps.length).map(([name, ps]) => `${name} ${f.num(ps[ps.length - 1].y, 1)}`).join(", ");
  return `<figure class="lchart" role="img" aria-label="${esc(`${o.label}: ${last}`)}">`
    + `<div class="ch-plot">${yaxis(f, top)}<svg class="ch-lines" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">`
    + `${paths.join("")}</svg><div class="ch-hover" style="--n:${n}">${slices.join("")}</div></div>`
    + `<div class="ch-months" aria-hidden="true">${monthTicks(f, lo, hi, end)}</div></figure>`;
}

export type GanttItem = { name: string; tip: string; spans: [start: number, end: number, colour: string, tip: string][] };

/** Projects on as few rows as their names allow: each keeps every attempt on one row with its name beside it (after its
 * last attempt; before its first when that would pass the end; in the gap after its first when neither end has room and
 * the gap has, a project handed in again years later; else after its last, past the end: the chart widens its axis),
 * and shares the row with any other that doesn't touch it, name included. perChar and gap are in the axis' units (a
 * name's room is its length × perChar); at is where the name starts or ends, to where its room ends. */
export function packRows<T extends { name: string; spans: [number, number, ...unknown[]][] }>(items: T[], lo: number, hi: number, perChar: number, gap: number) {
  const placed = items.map((item) => {
    const a = Math.min(...item.spans.map((x) => x[0])), b = Math.max(...item.spans.map((x) => Math.max(x[0], x[1])));
    const room = item.name.length * perChar + gap;
    const first = Math.max(item.spans[0][0], item.spans[0][1]), next = item.spans[1]?.[0] ?? Infinity;
    const side: "after" | "before" | "between" = b + room <= hi ? "after" : a - room >= lo ? "before" : next - first >= room && next < Infinity ? "between" : "after";
    const at = side === "after" ? b : side === "before" ? a : first;
    return { item, side, at, from: side === "before" ? a - room : a, to: side === "after" ? b + room : side === "between" ? Math.max(b, first + room) : b };
  }).sort((x, y) => x.from - y.from);
  const rows: { end: number; items: typeof placed }[] = [];
  for (const p of placed) {
    const row = rows.find((r) => r.end <= p.from) || rows[rows.push({ end: -Infinity, items: [] }) - 1];
    row.items.push(p);
    row.end = p.to;
  }
  return rows.map((r) => r.items);
}

/** The attempts line: groups of rows on one time axis, each project's attempts on one row with its name beside them
 * (packRows), so the whole history fits a laptop's screen; narrower than its track (860px unless given) plus the groups'
 * column it scrolls sideways like the calendar (cal-scroll: its fades, opening on the latest months), that column staying put. */
export function gantt(f: Fmt, groups: [string, GanttItem[]][], o: { label: string; emptyText?: string; track?: number }): string {
  const spans = groups.flatMap(([, items]) => items.flatMap((x) => x.spans));
  if (!spans.length) return empty(o.emptyText || "");
  const pad = 7 * 864e5;
  const lo = Math.min(...spans.map((s) => s[0])) - pad, end = Math.max(...spans.map((s) => Math.max(s[0], s[1])));
  let hi = end + pad, span = hi - lo;
  const at = (t: number) => ((100 * (t - lo)) / span).toFixed(2);
  // a name's room measured on the narrowest track it gets: wider screens only add air
  const track = o.track || 860;
  // a name with no room on either side widens the axis to the end of its room (once: its room shrinks a little with it)
  hi = Math.max(hi, ...groups.flatMap(([, items]) => packRows(items, lo, hi, (span * 6.4) / track, (span * 10) / track).flat().map((x) => x.to)));
  span = hi - lo;
  const perChar = (span * 6.4) / track, gap = (span * 10) / track;
  let rows = 0;
  const body = groups.filter(([, items]) => items.length).map(([label, items]) => packRows(items, lo, hi, perChar, gap).map((row, r, all) => (rows += r ? 0 : all.length,
    `<div class="gt-row${r ? "" : " first"}"><span class="gt-group">${r ? "" : esc(label)}</span><span class="gt-track">${row.map(({ item, side, at: t }) => {
      const bars = item.spans.map(([s, e, c, tip]) => `<i style="left:${at(s)}%;width:max(4px,${((100 * (Math.max(s, e) - s)) / span).toFixed(2)}%);background:${c}"${tipAttr(tip)}></i>`).join("");
      const where = side === "before" ? `right:calc(${(100 - +at(t)).toFixed(2)}% + 6px)` : `left:calc(${at(t)}% + 6px)`;
      return bars + `<span class="gt-name" style="${where}"${tipAttr(item.tip)}>${esc(item.name)}</span>`;
    }).join("")}</span></div>`)).join("")).join("");
  // --rows: the rows share the screen's height (v2.css), 14 to 20px each
  return `<div class="gantt-scroll cal-scroll"><figure class="gantt" role="img" aria-label="${esc(o.label)}" style="--rows:${rows};--gt-min:${track + 140}px">${body}`
    + `<div class="gt-axis" aria-hidden="true"><span></span><span class="ch-months">${monthTicks(f, lo, hi, end)}</span></div></figure></div>`;
}
