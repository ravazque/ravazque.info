import { expect, test } from "vitest";
import data from "@data/holygraph.json";
import { cursusGraph, fitLabel, piscineGraph, type HolyData, type Look } from "./holy";

const G = data as unknown as HolyData;
const look = (state: (s: string) => any = () => "open"): Look => ({ state, name: (s) => G.projects[s]?.name || s, label: (s) => s, milestone: () => false });

type Shape = { slug: string; kind: "c" | "r"; x: number; y: number; r: number; w: number; h: number };
function shapes(svg: string): Shape[] {
  const out: Shape[] = [];
  for (const m of svg.matchAll(/<g class="hg-n[^"]*" data-hg="([^"]+)"[^>]*>(?:<circle class="hg-bonus"[^>]*>)?(<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"\/>|<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*\/>)/g)) {
    if (m[3]) out.push({ slug: m[1], kind: "c", x: +m[3], y: +m[4], r: +m[5], w: 0, h: 0 });
    else out.push({ slug: m[1], kind: "r", x: +m[6], y: +m[7], r: 0, w: +m[8], h: +m[9] });
  }
  return out;
}
const hit = (a: Shape, b: Shape) => {
  if (a.kind === "c" && b.kind === "c") return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5;
  if (a.kind === "r" && b.kind === "r") return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const [c, r] = a.kind === "c" ? [a, b] : [b, a];
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(c.x - nx, c.y - ny) < c.r - 0.5;
};
function overlaps(svg: string): string[] {
  const s = shapes(svg), bad: string[] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (hit(s[i], s[j])) bad.push(`${s[i].slug} × ${s[j].slug}`);
  return bad;
}

test("no two projects touch, on either track's graph or on the Piscine's", () => {
  for (const track of ["c", "python"] as const) {
    const svg = cursusGraph(G, track, look(), track);
    expect(shapes(svg).length).toBeGreaterThan(170);
    expect(overlaps(svg)).toEqual([]);
  }
  expect(overlaps(piscineGraph(G, look(), "p"))).toEqual([]);
});

test("every project of the graph is a button with its state and a name a screen reader can say", () => {
  const svg = cursusGraph(G, "c", look((s) => (s === "42cursus-libft" ? "bonus" : "locked")), "C");
  expect(svg).toContain('class="hg-n st-bonus" data-hg="42cursus-libft" tabindex="0" role="button"');
  expect(svg).toContain('<circle class="hg-bonus"');
  expect(svg).toContain(">CPP Module 00–04<"); // a series of modules keeps its name under the cluster
  expect(svg).not.toMatch(/data-hg="python-module-/); // the C track draws no Python project
});

test("a long name breaks in two at a space or a dash rather than shrinking out of sight", () => {
  expect(fitLabel("Libft", 60)).toEqual({ lines: ["Libft"], size: 16 });
  const two = fitLabel("ft_transcendence", 80);
  expect(two.lines).toEqual(["ft_", "transcendence"]);
  expect(two.size).toBeGreaterThanOrEqual(7);
});

test("the editor's nodes: a project moved, resized or reshaped is drawn so, and its links follow it", () => {
  const at = (svg: string, s: string) => shapes(svg).find((x) => x.slug === s)!;
  const before = cursusGraph(G, "c", look(), "C");
  const g = { ...G, nodes: { "42cursus-libft": { dx: 30, dy: -20, r: 55 }, "42cursus-scop": { dx: 50, dy: 0 }, "42cursus-get_next_line": { shape: "square" }, "42cursus-ft_printf": { shape: "diamond" } } } as HolyData;
  const svg = cursusGraph(g, "c", look(), "C");
  const libft0 = at(before, "42cursus-libft"), libft = at(svg, "42cursus-libft");
  expect([libft.x, libft.y, libft.r]).toEqual([libft0.x + 30, libft0.y - 20, 55]);
  expect(svg).toMatch(/data-hg="42cursus-get_next_line"[^>]*><rect /);
  expect(svg).toMatch(/data-hg="42cursus-ft_printf"[^>]*><polygon /);
  const scop0 = at(before, "42cursus-scop"), scop = at(svg, "42cursus-scop");
  expect(scop.x).toBeCloseTo(scop0.x + 50, 0);
  const lines = [...svg.matchAll(/<line [^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  const near = (x: number, y: number) => Math.abs(x - scop.x) < 0.2 && Math.abs(y - scop.y) < 0.2;
  expect(lines.some(([, , x2, y2]) => near(x2, y2))).toBe(true); // its line from the Common Core ends on it
  expect(lines.some(([x1, y1]) => near(x1, y1))).toBe(true); // humangl's starts from it
  expect(svg).toContain('data-to="42cursus-scop"');
});

test("a name that can't fit its node even at the smallest size ends in an ellipsis instead of spilling out", () => {
  const { lines, size } = fitLabel("bgp-at-doors-of-autonomous-systems-is-simple", 50);
  expect(size).toBe(7);
  const cap = Math.floor((50 * 0.9) / (7 * 0.56));
  expect(lines.every((l) => l.length <= cap)).toBe(true);
  expect(lines[lines.length - 1].endsWith("…")).toBe(true);
  expect(fitLabel("Libft", 74).lines).toEqual(["Libft"]); // one that fits stays whole
});

test("a graph only to look at lights no link, a Piscine box's included", () => {
  expect(cursusGraph(G, "c", look(() => "view"), "C")).not.toMatch(/class="hg-e lit/);
});

test("the owner's lines: a structural one taken away, one from a project to the middle of another line, one on that one, one to a point", () => {
  const seg = (svg: string, id: string) => {
    const m = svg.match(new RegExp(`<line [^>]*data-link="${id.replace(/>/g, "&gt;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*x1="([-\\d.]+)" y1="([-\\d.]+)" x2="([-\\d.]+)" y2="([-\\d.]+)"`));
    return m ? m.slice(1).map(Number) : null;
  };
  const base = cursusGraph(G, "c", look(), "C");
  const scop = seg(base, "42cursus-scop>42cursus-humangl")!;
  expect(scop).not.toBeNull();
  const g = { ...G, links: { hide: ["libasm>b"], add: [
    { id: "l1", from: { node: "cc1" }, to: { line: "42cursus-scop>42cursus-humangl", t: 0.5 } },
    { id: "l2", from: { line: "l1", t: 1 }, to: { x: 5, y: 6 } },
    { id: "l3", from: { node: "b" }, to: { line: "libasm>b", t: 0.5 } }, // on a line taken away: not drawn
  ] } } as HolyData;
  const svg = cursusGraph(g, "c", look(), "C");
  expect(seg(svg, "libasm>b")).toBeNull();
  const l1 = seg(svg, "l1")!, l2 = seg(svg, "l2")!;
  expect(l1[2]).toBeCloseTo((scop[0] + scop[2]) / 2, 0);
  expect(l1[3]).toBeCloseTo((scop[1] + scop[3]) / 2, 0);
  expect([l2[0], l2[1]]).toEqual([l1[2], l1[3]]);
  expect([l2[2], l2[3]]).toEqual([5, 6]);
  expect(seg(svg, "l3")).toBeNull();
  expect(svg).toMatch(/data-link="l1"[^>]*|data-from="cc1"[^>]*data-link="l1"/);
});
