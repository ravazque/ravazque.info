// The campus figures of the Holy graph page, drawn in the graph's own vocabulary: rings that fill to the share who got
// that far, a donut per project, and bars split at one axis for why attempts failed and where each start year stands. Every mark has
// a data-tip and every figure an aria-label; colours are ui.json tokens.
import { esc, tipAttr } from "./h";

const f1 = (v: number) => v.toFixed(1);

/** An arc of the circle of radius r around (cx, cy), from share a to share b of a full turn, starting at the top. */
function arc(cx: number, cy: number, r: number, a: number, b: number): string {
  if (b - a >= 0.9999) return `M${f1(cx)} ${f1(cy - r)} A${f1(r)} ${f1(r)} 0 1 1 ${f1(cx - 0.01)} ${f1(cy - r)}`;
  const p = (t: number) => [cx + r * Math.sin(2 * Math.PI * t), cy - r * Math.cos(2 * Math.PI * t)];
  const [x0, y0] = p(a), [x1, y1] = p(b);
  return `M${f1(x0)} ${f1(y0)} A${f1(r)} ${f1(r)} 0 ${b - a > 0.5 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`;
}

export type Ring = { label: string; reached: number | null; lost: number | null; tip: string };

/** Rings, Milestone 0 inside, each filled to the share that reached it (data blue) and, after it, the share the black
 * hole caught while on it (slate); the label of each at the left, the people counted in the middle. */
export function ringFunnel(rings: Ring[], middle: string, label: string): string {
  const step = 26, inner = 54, R = inner + step * (rings.length - 1), size = 2 * (R + 16);
  const marks = rings.map((g, i) => {
    const r = inner + step * i, reached = Math.max(0, Math.min(1, g.reached ?? 0)), lost = Math.max(0, Math.min(1 - reached, g.lost ?? 0));
    return `<g class="rf-ring"${tipAttr(g.tip)}><path class="rf-track" d="${arc(0, 0, r, 0, 1)}"/>`
      + (reached ? `<path class="rf-reached" d="${arc(0, 0, r, 0, reached)}"/>` : "")
      + (lost ? `<path class="rf-lost" d="${arc(0, 0, r, reached, reached + lost)}"/>` : "")
      + `<text class="rf-label" x="-6" y="${f1(-r + 4)}" text-anchor="end">${esc(g.label)}</text></g>`;
  }).join("");
  return `<svg class="ring-funnel" viewBox="${f1(-size / 2)} ${f1(-size / 2)} ${f1(size)} ${f1(size)}" role="img" aria-label="${esc(label)}">`
    + `${marks}<text class="rf-middle" x="0" y="6" text-anchor="middle">${esc(middle)}</text></svg>`;
}

export type Slice = { cls: string; value: number; label: string };

/** A donut: its slices in order round from the top, the share in the middle, a name and a line under it. */
export function donut(slices: Slice[], middle: string, name: string, under: string, tip: string): string {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0), r = 30;
  let at = 0;
  const parts = total ? slices.filter((s) => s.value > 0).map((s) => {
    const a = at, b = at + s.value / total;
    at = b;
    return `<path class="dn-${s.cls}" d="${arc(0, 0, r, a + 0.004, Math.max(a + 0.004, b - 0.004))}"/>`;
  }).join("") : "";
  // nothing to show: the ring's outline alone
  const ring = parts ? `<path class="dn-track" d="${arc(0, 0, r, 0, 1)}"/>${parts}` : `<circle class="dn-edge" r="${r + 5}"/><circle class="dn-edge" r="${r - 5}"/>`;
  return `<li class="donut${parts ? "" : " empty"}"${tipAttr(tip)}><svg viewBox="-40 -40 80 80" role="img" aria-label="${esc(tip)}">${ring}`
    + `<text x="0" y="6" text-anchor="middle">${esc(middle)}</text></svg><b>${esc(name)}</b><span>${esc(under)}</span></li>`;
}

export type Bar = { label: string; count: string; parts: { key: string; value: number }[]; tip: (key: string, value: number, share: number) => string };
export type Side = { label: string; keys: { key: string; label: string }[] };

/** Bars split at one axis: the left side's parts grow left from it and the right side's right, each row as shares of its
 * own total and every row at one scale, so either side's share compares across rows straight off the axis. The parts in
 * reading order (the left side's first part furthest from the axis), a total row on top, the left side's share before each
 * bar, and a key per side with each part's total and share. */
export function splitBars(sum: Bar, rows: Bar[], left: Side, right: Side, heads: { lead: string; count: string }, label: string, num: (v: number) => string): string {
  const value = (b: Bar, key: string) => Math.max(0, b.parts.find((p) => p.key === key)?.value || 0);
  const total = (b: Bar, keys: Side["keys"]) => keys.reduce((a, k) => a + value(b, k.key), 0);
  const all = [sum, ...rows].map((b) => ({ b, t: total(b, left.keys) + total(b, right.keys), l: total(b, left.keys) })).filter((r) => r.t)
    .map((r) => ({ ...r, l: r.l / r.t }));
  const maxL = Math.max(0, ...all.map((r) => r.l)), maxR = Math.max(0, ...all.map((r) => 1 - r.l));
  const cell = (r: (typeof all)[number], s: Side, max: number) => s.keys.map((k) => {
    const v = value(r.b, k.key);
    return v ? `<i class="sb-${k.key}" style="width:${f1((100 * v) / r.t / max)}%"${tipAttr(r.b.tip(k.key, v, v / r.t))}></i>` : "";
  }).join("");
  const li = (r: (typeof all)[number], cls: string) => `<li${cls}><span class="sb-label">${esc(r.b.label)}</span><span class="spl-lead">${Math.round(100 * r.l)}%</span>`
    + `<span class="spl-bar"><span class="spl-l">${cell(r, left, maxL)}</span><span class="spl-r">${cell(r, right, maxR)}</span></span><span class="sb-count">${esc(r.b.count)}</span></li>`;
  const head = `<li class="spl-head"><span></span><span class="spl-lead">${esc(heads.lead)}</span><span class="spl-bar"><span class="spl-l">${esc(left.label)}</span>`
    + `<span class="spl-r">${esc(right.label)}</span></span><span class="sb-count">${esc(heads.count)}</span></li>`;
  const sumT = total(sum, left.keys) + total(sum, right.keys);
  const key = (s: Side) => `<div><p class="spl-side">${esc(s.label)}</p><ul>${s.keys.map((k) => `<li><i class="sb-${k.key}"></i><span>${esc(k.label)}</span>`
    + `<b>${esc(num(value(sum, k.key)))}</b><em>${sumT ? Math.round((100 * value(sum, k.key)) / sumT) : 0}%</em></li>`).join("")}</ul></div>`;
  const body = all.map((r) => li(r, r.b === sum ? ' class="spl-sum"' : "")).join("");
  return `<div class="split-bars" role="group" aria-label="${esc(label)}"><ol style="--l:${f1((100 * maxL) / (maxL + maxR || 1))}%">${head}${body}</ol>`
    + `<div class="spl-key">${key(left)}${key(right)}</div></div>`;
}
