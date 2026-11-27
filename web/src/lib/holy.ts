// The holy graph (page Holy graph): the C Piscine as the intra's rows, the Common Core as rings (Milestone 0 in the middle)
// with the Outer Core's branches around them, laid out so no two nodes touch; every node opens a panel (views/holygraph.ts
// writes them), and the stage zooms and pans. Data: @data/holygraph.json (tools/holygraph/build.py).
import { esc } from "./h";
import { floatAt } from "./behave";

export type HolyState = "done" | "bonus" | "doing" | "failed" | "open" | "locked" | "other" | "view";
export type Item = string | { alt: Item[] } | { chain: string[] };
export type HolyData = {
  piscine: string[][];
  common_core: Record<"c" | "python", Item[][]>;
  outer: { roots: string[]; edges: [string, string][]; boxes: Record<string, { slug: string; modules: string[] }[]>; parts: Record<string, string[]>;
    /** the owner's groups for the page's Outer Core section (the editor); none: by branch */
    groups?: { name: string; slugs: string[] }[] };
  projects: Record<string, { name: string; xp?: number; hours?: number; exam?: boolean }>;
  layout?: Partial<typeof LAYOUT>;
  nodes?: Record<string, HolyNode>;
  /** the drawing's lines by hand (the editor): structural ones not drawn ("parent>child", ">root") and lines of its own */
  links?: { hide?: string[]; add?: HolyLink[] };
};
/** A line's end: a project, a point along another line (t from its start to its end), or a point of the drawing. */
export type LinkEnd = { node: string } | { line: string; t: number } | { x: number; y: number };
export type HolyLink = { id: string; from: LinkEnd; to: LinkEnd };
/** One project as the owner drew it in the editor: moved by dx, dy from where the layout puts it, its size, its shape. */
export type HolyNode = { dx?: number; dy?: number; r?: number; shape?: (typeof SHAPES)[number] };
/** The same ranges and shapes as the server takes (core.HolyNode, core.HolyShapes). */
export const NODE_RANGE = { dx: [-4000, 4000], dy: [-4000, 4000], r: [8, 120] } as const;
export const SHAPES = ["circle", "pill", "square", "diamond"] as const;
/** What the page knows of each project: its state, the name to write in it, what a screen reader says. */
export type Look = { state(slug: string): HolyState; name(slug: string): string; label(slug: string): string; milestone(k: number): boolean };

const GAP = 34, BOX_W = 190, BOX_ROW = 32;
/** The drawing's numbers: the editor's (holygraph.json "layout", core.HolyLayout's ranges) over these defaults. */
export const LAYOUT = { cc_node: 40, cc_module: 21, ring_first: 130, ring_gap: 34, ring_turn: 0.62, ring_spin: 0, outer_node: 31, outer_depth: 96, outer_leaf: 76, piscine_node: 40 };
/** Each number's range, the same as the server checks (core.HolyLayout). */
export const LAYOUT_RANGE: Record<keyof typeof LAYOUT, [number, number]> = {
  cc_node: [20, 80], cc_module: [10, 40], ring_first: [60, 400], ring_gap: [10, 200], ring_turn: [0, 6.3], ring_spin: [-3.2, 3.2],
  outer_node: [16, 60], outer_depth: [40, 240], outer_leaf: [40, 200], piscine_node: [20, 80],
};
let P = { ...LAYOUT }, N: Record<string, HolyNode> = {}, H = new Set<string>(), L: HolyLink[] = [];
const useLayout = (g: HolyData) => { P = { ...LAYOUT, ...(g.layout || {}) }; N = g.nodes || {}; H = new Set(g.links?.hide || []); L = g.links?.add || []; };
/** Where a project is drawn: where the layout puts it, moved as the editor says. */
const moved = (s: string, x: number, y: number): [number, number] => [x + (N[s]?.dx || 0), y + (N[s]?.dy || 0)];
const satisfied = (s: HolyState) => s === "done" || s === "bonus";

/** The name inside a node: one line, or two split at a space, dash or underscore, as large as fits (7 to 16 px); what
 * doesn't fit even at 7 ends in "…" (the whole name stays in its aria-label and panel). */
export function fitLabel(name: string, width: number): { lines: string[]; size: number } {
  const fit = (lines: string[]) => Math.min(16, (width * 0.9) / (Math.max(...lines.map((l) => l.length)) * 0.56), lines.length > 1 ? width / 2.6 : 99);
  const cap = Math.max(3, Math.floor((width * 0.9) / (7 * 0.56)));
  const done = (lines: string[], size: number) => ({ size: Math.max(7, Math.floor(size)), lines: lines.map((l) => (l.length > cap ? `${l.slice(0, cap - 1).trimEnd()}…` : l)) });
  const one = fit([name]);
  if (one >= 11 || !/[\s_-]/.test(name)) return done([name], one);
  const cuts = [...name.matchAll(/[\s_-]/g)].map((m) => m.index!);
  const at = cuts.reduce((b, c) => (Math.abs(c - name.length / 2) < Math.abs(b - name.length / 2) ? c : b));
  const two = [name.slice(0, at + (name[at] === " " ? 0 : 1)).trim(), name.slice(at + 1).trim()];
  const size = fit(two);
  return size > one ? done(two, size) : done([name], one);
}

const f1 = (v: number) => v.toFixed(1);

function text(name: string, x: number, y: number, width: number): string {
  const { lines, size } = fitLabel(name, width);
  const top = y - ((lines.length - 1) * size * 1.1) / 2 + size * 0.36;
  return `<text x="${f1(x)}" y="${f1(top)}" font-size="${size}" text-anchor="middle">${lines
    .map((l, i) => `<tspan x="${f1(x)}" dy="${i ? f1(size * 1.1) : 0}">${esc(l)}</tspan>`).join("")}</text>`;
}

type Box = { x: number; y: number; w: number; h: number };
class Canvas {
  parts: string[] = [];
  lines: string[] = [];
  /** where each project is drawn, and each line by its id: the owner's lines start and end on them */
  at = new Map<string, [number, number]>();
  segs = new Map<string, [number, number, number, number]>();
  box: Box = { x: 0, y: 0, w: 0, h: 0 };
  private x0 = Infinity; private y0 = Infinity; private x1 = -Infinity; private y1 = -Infinity;
  constructor(private look: Look) {}
  grow(x: number, y: number, rx: number, ry = rx) {
    this.x0 = Math.min(this.x0, x - rx); this.x1 = Math.max(this.x1, x + rx);
    this.y0 = Math.min(this.y0, y - ry); this.y1 = Math.max(this.y1, y + ry);
  }
  node(slug: string, x: number, y: number, r: number, pill = false, shown = "") {
    const st = this.look.state(slug), name = shown || this.look.name(slug), o = N[slug] || {};
    r = o.r ?? r;
    const kind = o.shape ?? (pill ? "pill" : "circle"), w = kind === "pill" ? Math.max(3 * r, name.length * 8.5 + 28) : 2 * r;
    const shape = kind === "pill" ? `<rect x="${f1(x - w / 2)}" y="${f1(y - r * 0.55)}" width="${f1(w)}" height="${f1(r * 1.1)}" rx="${f1(r * 0.55)}"/>`
      : kind === "square" ? `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}"/>`
      : kind === "diamond" ? `<polygon points="${f1(x)},${f1(y - 1.2 * r)} ${f1(x + 1.2 * r)},${f1(y)} ${f1(x)},${f1(y + 1.2 * r)} ${f1(x - 1.2 * r)},${f1(y)}"/>`
      : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}"/>`;
    const ring = st === "bonus" && kind === "circle" ? `<circle class="hg-bonus" cx="${f1(x)}" cy="${f1(y)}" r="${r + 5}"/>` : "";
    const room = kind === "pill" ? w - 14 : kind === "diamond" ? 1.2 * r : 2 * r - 6;
    this.parts.push(`<g class="hg-n st-${st}" data-hg="${esc(slug)}" tabindex="0" role="button" aria-label="${esc(this.look.label(slug))}">${ring}${shape}${text(name, x, y, room)}</g>`);
    this.grow(x, y, kind === "pill" ? w / 2 : kind === "diamond" ? 1.2 * r + 6 : r + 6);
    this.at.set(slug, [x, y]);
    return w;
  }
  /** from, to: the projects a link joins, so the editor can carry its ends while one of them is dragged; id: the line's
   * ("parent>child", ">root", or the owner's l1…), unless the owner took it away. */
  line(x1: number, y1: number, x2: number, y2: number, lit: boolean, extra = "", from = "", to = "", id = "") {
    if (id && H.has(id)) return;
    if (id) this.segs.set(id, [x1, y1, x2, y2]);
    const ends = (from ? ` data-from="${esc(from)}"` : "") + (to ? ` data-to="${esc(to)}"` : "") + (id ? ` data-link="${esc(id)}"` : "");
    this.lines.push(`<line class="hg-e${lit ? " lit" : ""}${extra}"${ends} x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`);
  }
  /** start: the square around the middle the stage opens on (the whole graph when 0). */
  svg(label: string, back: string[] = [], start = 0): string {
    const m = 40, x = this.x0 - m, y = this.y0 - m, w = this.x1 - this.x0 + 2 * m, h = this.y1 - this.y0 + 2 * m;
    this.box = { x, y, w, h };
    const open = start ? `${f1(-start)} ${f1(-start)} ${f1(2 * start)} ${f1(2 * start)}` : `${f1(x)} ${f1(y)} ${f1(w)} ${f1(h)}`;
    return `<svg class="holy-graph" viewBox="${open}" data-whole="${f1(x)} ${f1(y)} ${f1(w)} ${f1(h)}" role="group" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">`
      + back.join("") + this.lines.join("") + this.parts.join("") + "</svg>";
  }
}

// ---- the Common Core

/** How much arc an item needs on its ring (the chain's cluster radius too). */
function itemWidth(it: Item, look: Look): number {
  if (typeof it === "string") return /exam/.test(it) ? Math.max(120, look.name(it).length * 8.5 + 28) : 2 * P.cc_node;
  if ("chain" in it) return 2 * (clusterR(it.chain.length) + P.cc_module);
  return it.alt.reduce((s, m) => s + itemWidth(m, look), 0) + 12 * (it.alt.length - 1);
}
const clusterR = (n: number) => (n < 2 ? 0 : n === 2 ? P.cc_module + 3 : (P.cc_module + 3) / Math.sin(Math.PI / n));

function drawItem(c: Canvas, it: Item, R: number, theta: number, look: Look, back: string[], cap = 1) {
  const at = (t: number) => [R * Math.cos(t), R * Math.sin(t)] as const;
  if (typeof it === "string") {
    const [x, y] = moved(it, ...at(theta));
    c.node(it, x, y, P.cc_node, /exam/.test(it));
  } else if ("chain" in it) {
    const [cx, cy] = at(theta), cr = clusterR(it.chain.length);
    const done = it.chain.filter((s) => satisfied(look.state(s))).length, n = it.chain.length;
    const ar = cr + P.cc_module + 7, len = 2 * Math.PI * ar;
    back.push(`<circle class="hg-cluster" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(ar)}"/>`
      + (done ? `<circle class="hg-cluster lit" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(ar)}" stroke-dasharray="${f1((len * done) / n)} ${f1(len)}" transform="rotate(-90 ${f1(cx)} ${f1(cy)})"/>` : ""));
    // inside each module its number alone ("00", "05 bis"), the series' name under the cluster ("CPP Module 00–04")
    const names = it.chain.map((s) => look.name(s)), cut = commonPrefix(names);
    it.chain.forEach((s, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      c.node(s, ...moved(s, cx + cr * Math.cos(a), cy + cr * Math.sin(a)), P.cc_module, false, names[i].slice(cut) || names[i]);
    });
    if (cut) back.push(`<text class="hg-cap" x="${f1(cx)}" y="${f1(cap > 0 ? cy + ar + 16 : cy - ar - 8)}" text-anchor="middle">${esc(`${names[0].slice(0, cut).trim()} ${names[0].slice(cut)}–${names[n - 1].slice(cut)}`)}</text>`);
  } else {
    const ws = it.alt.map((m) => itemWidth(m, look)), total = ws.reduce((a, b) => a + b, 0) + 12 * (ws.length - 1);
    const a0 = theta - total / 2 / R, a1 = theta + total / 2 / R;
    back.push(`<path class="hg-alt" d="M${f1((R + P.cc_node + 9) * Math.cos(a0))} ${f1((R + P.cc_node + 9) * Math.sin(a0))} A${f1(R + P.cc_node + 9)} ${f1(R + P.cc_node + 9)} 0 0 1 ${f1((R + P.cc_node + 9) * Math.cos(a1))} ${f1((R + P.cc_node + 9) * Math.sin(a1))}"/>`);
    let off = -total / 2;
    it.alt.forEach((m, i) => { drawItem(c, m, R, theta + (off + ws[i] / 2) / R, look, back, i % 2 ? -1 : 1); off += ws[i] + 12; }); // two clusters side by side: one caption under, one over
  }
}

/** Where several names stop sharing their start, cut at a space ("CPP Module 00", "CPP Module 01" → 11). */
function commonPrefix(names: string[]): number {
  let n = 0;
  while (names.every((x) => x[n] && x[n] === names[0][n])) n++;
  const sp = names[0].lastIndexOf(" ", n);
  return names.length > 1 && sp > 0 ? sp + 1 : 0;
}

function itemDone(it: Item, look: Look): boolean {
  if (typeof it === "string") return satisfied(look.state(it));
  if ("chain" in it) return it.chain.every((s) => satisfied(look.state(s)));
  return it.alt.some((m) => itemDone(m, look));
}

/** The rings: their radii (each as large as its items need) and the circle that closes the Common Core. */
function commonCore(c: Canvas, rings: Item[][], look: Look, back: string[]): number {
  let R = 0;
  rings.forEach((items, k) => {
    if (k === 0) { items.forEach((it) => drawItem(c, it, 0, 0, look, back)); return; }
    const widths = items.map((it) => itemWidth(it, look) + GAP), need = widths.reduce((a, b) => a + b, 0) / (2 * Math.PI);
    R = Math.max(k === 1 ? P.ring_first : R + 2 * P.cc_node + P.ring_gap, need);
    const full = look.milestone(k) && items.every((it) => itemDone(it, look));
    back.push(`<circle class="hg-ring${full ? " full" : ""}" cx="0" cy="0" r="${f1(R)}"/>`, `<text class="hg-ml" x="${f1(-R)}" y="-6" text-anchor="middle">${k}</text>`);
    // the items share the whole ring: the room their widths leave goes evenly between them; each ring starts a little
    // further round than the one inside, so neighbours on two rings don't line up
    let cum = 0;
    const spare = (2 * Math.PI * R - widths.reduce((x, y) => x + y, 0)) / items.length, start = -Math.PI / 2 + P.ring_spin + k * P.ring_turn;
    items.forEach((it, i) => { drawItem(c, it, R, start + (cum + (widths[i] + spare) / 2) / R, look, back); cum += widths[i] + spare; });
  });
  return R + P.cc_node + 40;
}

// ---- the Outer Core

type Tree = { kids: Map<string, string[]>; extra: [string, string][] };
function tree(edges: [string, string][]): Tree {
  const kids = new Map<string, string[]>(), parent = new Set<string>(), extra: [string, string][] = [];
  for (const [a, b] of edges) {
    if (parent.has(b)) { extra.push([a, b]); continue; }
    parent.add(b);
    kids.set(a, [...(kids.get(a) || []), b]);
  }
  return { kids, extra };
}

function outer(c: Canvas, g: HolyData, look: Look, Rcc: number, back: string[]) {
  const { kids, extra } = tree(g.outer.edges), boxes = g.outer.boxes, roots = g.outer.roots;
  // a long run of single projects (kfs-1 … kfs-x, the ft_ssl ones) zigzags outward as on the intra instead of one long ray
  const run = (s: string): number => { const k = kids.get(s) || []; return k.length === 1 ? 1 + run(k[0]) : 0; };
  const zig = new Set<string>();
  const mark = (s: string, inRun: boolean) => {
    const k = kids.get(s) || [], long = inRun || (k.length === 1 && run(s) >= 3);
    if (long && k.length <= 1 && !boxes[s]) zig.add(s); // a box keeps its place
    k.forEach((x) => mark(x, long && k.length === 1));
  };
  roots.forEach((r) => mark(r, false));
  const step = (s: string) => (boxes[s] ? P.outer_depth + BOX_W / 2 : zig.has(s) ? P.outer_depth * 0.62 : P.outer_depth);
  const width = (s: string) => (boxes[s] ? BOX_W + 14 : zig.has(s) ? P.outer_leaf * 1.75 : P.outer_leaf);
  const need = (s: string, r: number): number => {
    const ks = kids.get(s) || [];
    return Math.max(width(s) / r, ks.reduce((a, k) => a + need(k, r + step(s)), 0));
  };
  let R1 = Rcc + 96, spans = roots.map((r) => need(r, R1));
  while (spans.reduce((a, b) => a + b, 0) > 2 * Math.PI * 0.98) { R1 *= 1.06; spans = roots.map((r) => need(r, R1)); }
  const spare = (2 * Math.PI - spans.reduce((a, b) => a + b, 0)) / roots.length; // the room left, shared evenly between branches
  back.push(`<circle class="hg-ring cc" cx="0" cy="0" r="${f1(Rcc)}"/>`);
  // first every position (a run's projects alternate either side of their branch's line), then what moves, then the drawing
  const pos = new Map<string, [number, number]>(), from = new Map<string, [number, number]>(), parentOf = new Map<string, string>();
  const place = (s: string, a0: number, a1: number, r: number, origin: [number, number], side: number) => {
    const t = (a0 + a1) / 2, lat = zig.has(s) ? side * P.outer_leaf * 0.5 : 0;
    pos.set(s, [r * Math.cos(t) - lat * Math.sin(t), r * Math.sin(t) + lat * Math.cos(t)]);
    from.set(s, origin);
    const ks = kids.get(s) || [], r2 = r + step(s), needs = ks.map((k) => need(k, r2)), total = needs.reduce((x, y) => x + y, 0);
    let a = t - Math.min(a1 - a0, total) / 2;
    const scale = total > a1 - a0 ? (a1 - a0) / total : 1;
    ks.forEach((k, i) => { const span = needs[i] * scale; parentOf.set(k, s); place(k, a, a + span, r2, pos.get(s)!, zig.has(k) ? -side || 1 : 1); a += span; });
  };
  let a = -Math.PI / 2 + 0.04;
  roots.forEach((r, i) => {
    const span = spans[i] + spare, t = a + span / 2;
    place(r, a + spare / 2, a + span - spare / 2, R1, [Rcc * Math.cos(t), Rcc * Math.sin(t)], 1);
    a += span;
  });
  // a project two branches lead to (cc1, filesystem, Very_Real_Engine) sits between them, a step further out: the intra's diamonds
  for (const k of new Set(extra.map(([, x]) => x))) {
    const ps = [parentOf.get(k), ...extra.filter(([, x]) => x === k).map(([p2]) => p2)].map((p2) => pos.get(p2 || "")).filter((v): v is [number, number] => !!v);
    if (ps.length < 2 || (kids.get(k) || []).length) continue;
    const mx = ps.reduce((q, p2) => q + p2[0], 0) / ps.length, my = ps.reduce((q, p2) => q + p2[1], 0) / ps.length, d = Math.hypot(mx, my) || 1;
    pos.set(k, [mx + (mx / d) * P.outer_depth * 0.7, my + (my / d) * P.outer_depth * 0.7]);
    from.set(k, pos.get(parentOf.get(k)!)!);
  }
  // the editor's moves last, so every link meets its projects where they are drawn (a root's starts on the Common Core)
  for (const [s, [x, y]] of pos) pos.set(s, moved(s, x, y));
  for (const [s, [x, y]] of pos) {
    const p = parentOf.get(s), [ox, oy] = (p && pos.get(p)) || from.get(s)!;
    c.line(ox, oy, x, y, satisfied(look.state(s)) || (!!boxes[s] && boxes[s].some((b) => !["locked", "open", "view"].includes(look.state(b.slug)))), "", p || "", s, `${p || ""}>${s}`);
    if (boxes[s]) {
      const rows = boxes[s], h = rows.length * BOX_ROW;
      rows.forEach((b, i) => {
        const y0 = y - h / 2 + i * BOX_ROW;
        c.parts.push(`<g class="hg-n hg-box st-${look.state(b.slug)}" data-hg="${esc(b.slug)}" data-box="${esc(s)}" tabindex="0" role="button" aria-label="${esc(look.label(b.slug))}">`
          + `<rect x="${f1(x - BOX_W / 2)}" y="${f1(y0)}" width="${BOX_W}" height="${BOX_ROW}"/>${text(look.name(b.slug), x, y0 + BOX_ROW / 2, BOX_W - 16)}</g>`);
      });
      c.grow(x, y, BOX_W / 2, h / 2);
      c.at.set(s, [x, y]);
      rows.forEach((b, i) => c.at.set(b.slug, [x, y - h / 2 + (i + 0.5) * BOX_ROW]));
    } else c.node(s, x, y, P.outer_node);
  }
  for (const [p2, k] of extra) {
    const [x1, y1] = pos.get(p2)!, [x2, y2] = pos.get(k)!;
    c.line(x1, y1, x2, y2, satisfied(look.state(k)), " second", p2, k, `${p2}>${k}`);
  }
}

/** The owner's own lines, once every project and structural line has its place: each end a project, a point along a
 * line drawn (one of the owner's included: they chain) or a point; one whose line isn't drawn isn't either. Lit when
 * every project it joins is done. */
function ownLinks(c: Canvas, look: Look) {
  const byId = new Map(L.map((l) => [l.id, l])), busy = new Set<string>();
  const seg = (id: string): [number, number, number, number] | undefined => {
    if (c.segs.has(id)) return c.segs.get(id);
    const l = byId.get(id);
    if (!l || busy.has(id)) return undefined; // a ring of lines on lines ends here
    busy.add(id);
    const a = end(l.from), b = end(l.to);
    busy.delete(id);
    return a && b ? [a[0], a[1], b[0], b[1]] : undefined;
  };
  const end = (e: LinkEnd): [number, number] | undefined => {
    if ("node" in e) return c.at.get(e.node);
    if ("x" in e) return [e.x, e.y];
    const s = seg(e.line);
    return s && [s[0] + (s[2] - s[0]) * e.t, s[1] + (s[3] - s[1]) * e.t];
  };
  for (const l of L) {
    const s = seg(l.id);
    if (!s) continue;
    const ns = [l.from, l.to].flatMap((e) => ("node" in e ? [e.node] : []));
    c.line(...s, ns.length > 0 && ns.every((n) => satisfied(look.state(n))), " own", "node" in l.from ? l.from.node : "", "node" in l.to ? l.to.node : "", l.id);
    c.grow(s[0], s[1], 4);
    c.grow(s[2], s[3], 4);
  }
}

/** The Common Core of a track with the Outer Core around it. */
export function cursusGraph(g: HolyData, track: "c" | "python", look: Look, label: string): string {
  useLayout(g);
  const c = new Canvas(look), back: string[] = [];
  const Rcc = commonCore(c, g.common_core[track], look, back);
  outer(c, g, look, Rcc, back);
  ownLinks(c, look);
  return c.svg(label, back, Rcc + 24); // opens on the Common Core
}

/** The C Piscine in the intra's four rows. */
export function piscineGraph(g: HolyData, look: Look, label: string): string {
  useLayout(g);
  const c = new Canvas(look);
  const xs = [(i: number) => i * 150, (i: number) => 75 + i * 150, (i: number) => 330 + i * 275, (i: number) => 395 + i * 275];
  g.piscine.forEach((row, r) => row.forEach((s, i) => c.node(s, ...moved(s, xs[r](i), [0, 150, 320, 450][r]), P.piscine_node)));
  ownLinks(c, look);
  return c.svg(label);
}

// ---- in the browser: zoom, pan and the panels

const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
let panel: HTMLElement | null = null, pinned: Element | null = null, wired = false;

function show(el: Element) {
  const tpl = el.closest(".hg-wrap")?.querySelector<HTMLTemplateElement>(`template[data-hg-panel="${CSS.escape(el.getAttribute("data-hg") || "")}"]`);
  if (!tpl) return;
  panel ??= document.body.appendChild(Object.assign(document.createElement("div"), { id: "hg-panel", className: "float-panel hg-panel" }));
  panel.replaceChildren(tpl.content.cloneNode(true));
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", el.getAttribute("aria-label") || "");
  panel.hidden = false;
  const r = el.getBoundingClientRect(), { left, top } = floatAt(r, panel.offsetWidth, panel.offsetHeight);
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
}
function hide(force = false) {
  if (pinned && !force) return;
  if (force) { pinned?.classList.remove("pinned"); pinned = null; }
  if (panel) panel.hidden = true;
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("pointerover", (e) => { const n = (e.target as Element).closest?.("[data-hg]"); if (n && !pinned && e.pointerType === "mouse") show(n); });
  document.addEventListener("pointerout", (e) => { const n = (e.target as Element).closest?.("[data-hg]"); if (n && !n.contains(e.relatedTarget as Node)) hide(); });
  document.addEventListener("focusin", (e) => { const n = (e.target as Element).closest?.("[data-hg]"); if (n && !pinned) show(n); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide(true);
    const n = (e.target as Element).closest?.("[data-hg]");
    if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); (n as HTMLElement).click(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Element, n = t.closest?.("[data-hg]");
    if (n && n.closest(".hg-stage")?.getAttribute("data-dragged") !== "1") {
      if (pinned === n) return hide(true);
      hide(true); pinned = n; n.classList.add("pinned"); show(n);
    } else if (!t.closest?.("#hg-panel")) hide(true);
  });
}

/** Every stage under root: buttons to zoom in, out and back to the whole graph, drag to pan, two fingers or Ctrl and
 * the wheel to zoom (the wheel alone keeps scrolling the page). */
export function installHoly(root: ParentNode) {
  wire();
  hide(true);
  $$(".hg-stage", root).forEach((stage) => {
    const svg = stage.querySelector("svg");
    if (!svg || stage.dataset.on) return;
    stage.dataset.on = "1";
    const [fx, fy, fw, fh] = (svg.dataset.whole || svg.getAttribute("viewBox") || "0 0 1 1").split(" ").map(Number);
    const [sx, sy, sw, sh] = (svg.getAttribute("viewBox") || "0 0 1 1").split(" ").map(Number);
    let vb = { x: sx, y: sy, w: sw, h: sh };
    const apply = () => svg.setAttribute("viewBox", `${f1(vb.x)} ${f1(vb.y)} ${f1(vb.w)} ${f1(vb.h)}`);
    const toSvg = (cx: number, cy: number) => {
      const r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
      return [vb.x + (cx - r.left - (r.width - vb.w / s) / 2) * s, vb.y + (cy - r.top - (r.height - vb.h / s) / 2) * s];
    };
    const zoom = (k: number, px = vb.x + vb.w / 2, py = vb.y + vb.h / 2) => {
      const w = Math.min(fw * 1.1, Math.max(fw / 14, vb.w * k)), f = w / vb.w;
      vb = { x: px - (px - vb.x) * f, y: py - (py - vb.y) * f, w, h: vb.h * f };
      apply();
    };
    stage.querySelectorAll<HTMLButtonElement>("[data-hg-zoom]").forEach((b) => b.addEventListener("click", () => {
      const z = b.dataset.hgZoom;
      if (z === "fit") { vb = { x: fx, y: fy, w: fw, h: fh }; apply(); } else zoom(z === "in" ? 0.7 : 1 / 0.7);
    }));
    svg.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const [px, py] = toSvg(e.clientX, e.clientY); zoom(Math.exp(e.deltaY * 0.0025), px, py); }, { passive: false });
    svg.addEventListener("dblclick", (e) => { const [px, py] = toSvg(e.clientX, e.clientY); zoom(0.6, px, py); });
    const ptrs = new Map<number, [number, number]>();
    let moved = 0, pinch = 0;
    svg.addEventListener("pointerdown", (e) => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; stage.dataset.dragged = "0"; if (ptrs.size === 2) pinch = Math.hypot(...([...ptrs.values()][0].map((v, i) => v - [...ptrs.values()][1][i])) as [number, number]); });
    svg.addEventListener("pointermove", (e) => {
      const was = ptrs.get(e.pointerId);
      if (!was) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) { const [px, py] = toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); zoom(pinch / d, px, py); }
        pinch = d;
        stage.dataset.dragged = "1";
        return;
      }
      const r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
      const dx = e.clientX - was[0], dy = e.clientY - was[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) { stage.dataset.dragged = "1"; svg.setPointerCapture?.(e.pointerId); vb.x -= dx * s; vb.y -= dy * s; apply(); }
    });
    const up = (e: PointerEvent) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; setTimeout(() => { if (!ptrs.size) stage.dataset.dragged = "0"; }, 0); };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    stage.addEventListener("keydown", (e) => {
      if ((e.target as Element).closest("[data-hg]") && !["+", "-", "=", "0"].includes(e.key)) return;
      if (e.key === "+" || e.key === "=") zoom(0.7);
      else if (e.key === "-") zoom(1 / 0.7);
      else if (e.key === "0") { vb = { x: fx, y: fy, w: fw, h: fh }; apply(); }
    });
  });
}
