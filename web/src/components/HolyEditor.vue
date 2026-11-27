<script setup lang="ts">
// make dev only, for the owner (the router holds this page in Vite's dev server alone; its texts live here, as DevLive's):
// the holy graph's structure (both tracks' milestones, the Outer Core's branches), its drawing's numbers, and each project
// by hand in the real drawing beside it (drag to move, the edge's square to size, a shape). Save keeps it on this server (the Holy graph page draws it at once); Download gives the file Server
// stats imports in production; Built-in goes back to tools/holygraph/build.py's.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, fmt, loadSession, state } from "../state";
import { BUILT_IN, outerBranches } from "../views/holygraph";
import { LAYOUT, LAYOUT_RANGE, NODE_RANGE, SHAPES, cursusGraph, installHoly, piscineGraph, type HolyData, type HolyNode, type HolyState, type Item, type LinkEnd } from "../lib/holy";
import AppHeader from "./AppHeader.vue";

const es = computed(() => fmt.value.lang === "es");
const t = (en: string, sp: string) => (es.value ? sp : en);
const router = useRouter();
const draft = ref<HolyData>(structuredClone(BUILT_IN));
const history: string[] = [], future: string[] = []; // Undo, and Redo of what Undo took back
const tab = ref<"c" | "python" | "outer" | "layout" | "piscine">("c");
const note = ref("");
const preview = ref<HTMLElement | null>(null);
const picked = ref<Set<string>>(new Set());

onMounted(async () => {
  if (!state.session?.user) await loadSession().catch(() => null);
  if (!state.session?.dev || !state.session.user?.owner) return router.replace("/app");
  document.title = `${t("Holy graph editor", "Editor del holy graph")} · ravazque.info`;
  const saved = await api<HolyData | null>("/api/holygraph").catch(() => null);
  if (saved) draft.value = saved;
});

const names = computed(() => Object.entries(draft.value.projects).map(([slug, p]) => ({ slug, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)));
const name = (s: string) => draft.value.projects[s]?.name || s;
const label = (it: Item): string => (typeof it === "string" ? name(it) : "chain" in it ? `${t("Series", "Serie")}: ${it.chain.map(name).join(", ")}` : `${t("One of", "Una de")}: ${it.alt.map(label).join(" | ")}`);

/** Every change goes through here: the state before it is kept for Undo. */
function change(f: (d: HolyData) => void) {
  const was = JSON.stringify(draft.value); // (structuredClone refuses Vue's reactive proxy)
  history.push(was);
  if (history.length > 100) history.shift();
  future.length = 0;
  const d = JSON.parse(was) as HolyData;
  f(d);
  draft.value = d;
  note.value = "";
}
function undo() { const last = history.pop(); if (!last) return; future.push(JSON.stringify(draft.value)); draft.value = JSON.parse(last); }
function redo() { const next = future.pop(); if (!next) return; history.push(JSON.stringify(draft.value)); draft.value = JSON.parse(next); }

const track = computed(() => (tab.value === "python" ? "python" : "c") as "c" | "python");
const rings = computed(() => draft.value.common_core[track.value]);
function move(k: number, i: number, by: number) { change((d) => { const r = d.common_core[track.value][k], j = i + by; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; }); }
function toRing(k: number, i: number, to: number) { change((d) => { const r = d.common_core[track.value]; const [it] = r[k].splice(i, 1); r[to].push(it); }); }
function remove(k: number, i: number) { change((d) => { d.common_core[track.value][k].splice(i, 1); }); }
function split(k: number, i: number) {
  change((d) => { const r = d.common_core[track.value][k], it = r[i]; if (typeof it === "string") return; r.splice(i, 1, ...("chain" in it ? it.chain : it.alt)); });
}
const key = (k: number, i: number) => `${track.value}:${k}:${i}`;
function toggle(k: number, i: number) { const s = new Set(picked.value), id = key(k, i); s.has(id) ? s.delete(id) : s.add(id); picked.value = s; }
function group(k: number, how: "alt" | "chain") {
  const idx = [...picked.value].filter((x) => x.startsWith(`${track.value}:${k}:`)).map((x) => +x.split(":")[2]).sort((a, b) => a - b);
  if (idx.length < 2) { note.value = t("Pick two or more in the same milestone.", "Marca dos o más del mismo milestone."); return; }
  change((d) => {
    const r = d.common_core[track.value][k], items = idx.map((i) => r[i]);
    if (how === "chain" && items.some((x) => typeof x !== "string")) return;
    const grouped: Item = how === "alt" ? { alt: items } : { chain: items as string[] };
    for (const i of [...idx].reverse()) r.splice(i, 1);
    r.splice(idx[0], 0, grouped);
  });
  picked.value = new Set();
}
const adding = ref<Record<string, string>>({});
const slugOf = (typed: string) => (draft.value.projects[typed] ? typed : names.value.find((n) => n.name.toLowerCase() === typed.trim().toLowerCase())?.slug);
function add(k: number) {
  const s = slugOf(adding.value[`${track.value}:${k}`] || "");
  if (!s) { note.value = t("That project is not in the catalog.", "Ese proyecto no está en el catálogo."); return; }
  change((d) => { d.common_core[track.value][k].push(s); });
  adding.value = { ...adding.value, [`${track.value}:${k}`]: "" };
}

// the Outer Core: the branches' order, and its links as "parent > child" lines (slugs)
const edgesText = ref("");
watch(() => draft.value.outer.edges, (e) => { edgesText.value = e.map(([a, b]) => `${a} > ${b}`).join("\n"); }, { immediate: true });
function moveRoot(i: number, by: number) { change((d) => { const r = d.outer.roots, j = i + by; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; }); }
function removeRoot(i: number) { change((d) => { d.outer.roots.splice(i, 1); }); }
const newRoot = ref("");
function addRoot() { const s = slugOf(newRoot.value); if (!s) { note.value = t("That project is not in the catalog.", "Ese proyecto no está en el catálogo."); return; } change((d) => { d.outer.roots.push(s); }); newRoot.value = ""; }
function applyEdges() {
  const pairs: [string, string][] = [], bad: string[] = [];
  for (const line of edgesText.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [a, b] = line.split(">").map((x) => slugOf(x.trim() || "") || "");
    if (!a || !b) bad.push(line); else pairs.push([a, b]);
  }
  if (bad.length) { note.value = `${t("Not in the catalog", "No están en el catálogo")}: ${bad.slice(0, 3).join(" · ")}`; return; }
  change((d) => { d.outer.edges = pairs; });
  note.value = t("Links applied.", "Conexiones aplicadas.");
}

// the drawing's numbers
const layout = computed(() => ({ ...LAYOUT, ...(draft.value.layout || {}) }));
function setLayout(k: keyof typeof LAYOUT, v: number) { change((d) => { d.layout = { ...(d.layout || {}), [k]: v }; }); }
const LABELS: Record<keyof typeof LAYOUT, [string, string]> = {
  cc_node: ["Common Core projects", "Proyectos del Common Core"], cc_module: ["Modules in a series", "Módulos de una serie"], ring_first: ["First ring", "Primer anillo"],
  ring_gap: ["Space between rings", "Espacio entre anillos"], ring_turn: ["Turn from ring to ring", "Giro de anillo a anillo"], ring_spin: ["Turn of the whole", "Giro del conjunto"],
  outer_node: ["Outer Core projects", "Proyectos del Outer Core"], outer_depth: ["Step outwards", "Paso hacia fuera"], outer_leaf: ["Room per project", "Sitio por proyecto"],
  piscine_node: ["Piscine projects", "Proyectos de la Piscina"],
};

// the preview: the real drawing, every project neutral
const look = { state: (): HolyState => "view", name, label: name, milestone: () => false };
const svg = computed(() => (tab.value === "piscine" ? piscineGraph(draft.value, look, "Piscine") : cursusGraph(draft.value, track.value, look, track.value)));
// a new drawing gets a new stage (its zoom wired once): Vue redraws it by its key
// (the same view kept while the same graph redraws: an edit doesn't throw the zoom away)
const ver = ref(0);
let shownTab = tab.value, refocus = "";
watch(svg, async () => {
  const keep = shownTab === tab.value ? preview.value?.querySelector(".hge-svg svg")?.getAttribute("viewBox") : null;
  shownTab = tab.value;
  ver.value++;
  await nextTick();
  if (!preview.value) return;
  if (keep) preview.value.querySelector(".hge-svg svg")?.setAttribute("viewBox", keep);
  installHoly(preview.value);
  decorate();
  if (refocus) preview.value.querySelector<SVGGElement>(`[data-hg="${CSS.escape(refocus)}"]`)?.focus({ preventScroll: true });
  refocus = "";
});
onMounted(async () => { await nextTick(); if (preview.value) installHoly(preview.value); });

// ---- each project by hand. A click picks one; Shift, Ctrl or ⌘ and a click adds one or lets it go; Shift and a drag over the
// ground picks every project inside. Dragged, the picked ones move together (their links with them); the square on the
// corner of what's picked scales it all (sizes and the room between them); the slider sizes them, the buttons shape them,
// the arrow keys nudge them. Kept in draft.nodes as moves from where the layout puts each one, so they still follow their
// milestone or branch when the structure changes. A Piscine box moves whole.
type Drawn = { r: number; shape: HolyNode["shape"]; box: boolean; cx: number; cy: number };
const chosen = ref<string[]>([]), drawn = ref<Record<string, Drawn>>({});
watch(tab, () => { chosen.value = []; });
watch(chosen, () => decorate(), { flush: "post" });
const SHAPE_NAMES: Record<(typeof SHAPES)[number], [string, string]> = { circle: ["Circle", "Círculo"], pill: ["Pill", "Píldora"], square: ["Square", "Cuadrado"], diamond: ["Diamond", "Rombo"] };
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const moves = computed(() => Object.keys(draft.value.nodes || {}).length);
const sized = computed(() => chosen.value.filter((s) => drawn.value[s] && !drawn.value[s].box));
const oneR = computed(() => (chosen.value.length === 1 && sized.value.length === 1 ? Math.round(drawn.value[sized.value[0]].r) : 0));
const sharedShape = computed(() => { const sh = new Set(sized.value.map((s) => drawn.value[s].shape)); return sh.size === 1 ? [...sh][0] : undefined; });
/** One change (one Undo) for every slug: each one's own patch over what it has. */
function setNodes(slugs: string[], patch: (s: string, was: HolyNode) => HolyNode) {
  if (!slugs.length) return;
  change((d) => {
    const nodes = { ...(d.nodes || {}) };
    for (const s of slugs) {
      const n: HolyNode = { ...(nodes[s] || {}), ...patch(s, nodes[s] || {}) };
      for (const k of Object.keys(n) as (keyof HolyNode)[]) if (n[k] === undefined || ((k === "dx" || k === "dy") && !n[k])) delete n[k];
      if (Object.keys(n).length) nodes[s] = n; else delete nodes[s];
    }
    d.nodes = nodes;
  });
}
function resetChosen() { change((d) => { for (const s of chosen.value) if (d.nodes) delete d.nodes[s]; }); }
function resetAll() { change((d) => { delete d.nodes; }); }
const svgRoot = () => preview.value?.querySelector<SVGSVGElement>(".hge-svg svg") || null;
const keyOf = (g: Element) => (g as SVGGElement).dataset.box || (g as SVGGElement).dataset.hg!;
function piecesOf(root: Element, s: string): Element[] {
  const q = CSS.escape(s), rows = [...root.querySelectorAll(`[data-box="${q}"]`)];
  return rows.length ? rows : [...root.querySelectorAll(`[data-hg="${q}"]`)];
}
const shapeOf = (g: Element) => g.querySelector<SVGGraphicsElement>(":scope > circle:not(.hg-bonus), :scope > rect, :scope > polygon");
/** The size and shape a project is drawn with now (its own, or the layout's). */
function drawnOf(g: Element): { r: number; shape: HolyNode["shape"] } {
  const el = shapeOf(g), n = (a: string) => +(el?.getAttribute(a) || 0);
  if (!el) return { r: 40, shape: "circle" };
  if (el.tagName === "circle") return { r: n("r"), shape: "circle" };
  if (el.tagName === "polygon") { const ys = (el.getAttribute("points") || "").split(" ").map((p) => +p.split(",")[1]); return { r: (Math.max(...ys) - Math.min(...ys)) / 2.4, shape: "diamond" }; }
  return n("rx") ? { r: n("height") / 1.1, shape: "pill" } : { r: n("height") / 2, shape: "square" };
}
/** The picked ones outlined, what each is drawn with, and the square on the corner of them all that scales them. */
function decorate() {
  const root = svgRoot();
  if (!root) return;
  root.querySelectorAll(".hge-sel").forEach((x) => x.classList.remove("hge-sel"));
  root.querySelector("[data-hge-handle]")?.remove();
  decorateLine(root);
  const info: Record<string, Drawn> = {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of chosen.value) {
    const ps = piecesOf(root, s);
    if (!ps.length) continue;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of ps) {
      p.classList.add("hge-sel");
      const bb = shapeOf(p)?.getBBox();
      if (bb) { a = Math.min(a, bb.x); b = Math.min(b, bb.y); c = Math.max(c, bb.x + bb.width); d = Math.max(d, bb.y + bb.height); }
    }
    if (!Number.isFinite(a)) continue;
    const box = !!(ps[0] as SVGGElement).dataset.box;
    info[s] = { ...(box ? { r: 0, shape: undefined } : drawnOf(ps[0])), box, cx: (a + c) / 2, cy: (b + d) / 2 };
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  }
  drawn.value = info;
  if (!Number.isFinite(x0)) return;
  const size = 14 / (root.getScreenCTM()?.a || 1), h = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [a, v] of Object.entries({ x: x1 - size / 2, y: y1 - size / 2, width: size, height: size, class: "hge-handle", "data-hge-handle": "", "data-cx": (x0 + x1) / 2, "data-cy": (y0 + y1) / 2 })) h.setAttribute(a, String(v));
  h.innerHTML = `<title>${t("Drag to scale what's picked", "Arrastra para escalar lo elegido")}</title>`;
  root.appendChild(h);
}
const toSvg = (root: SVGSVGElement, x: number, y: number) => new DOMPoint(x, y).matrixTransform(root.getScreenCTM()!.inverse());

// ---- the drawing's lines by hand (the "Lines" switch): a drag from a project or a line to a project, a point along a line or
// anywhere draws one; a click on a line picks it, its round ends drag elsewhere, Delete takes it away. The drawing's
// alone: the layout and the page's branches keep to the Outer tab's links. A structural line taken away is kept in
// links.hide (Bring back returns them); one moved becomes a line of the owner's, and the lines on it follow it.
const lineMode = ref(false), pickedLine = ref("");
watch(tab, () => { pickedLine.value = ""; });
watch(lineMode, () => { chosen.value = []; pickedLine.value = ""; });
watch(pickedLine, () => decorate(), { flush: "post" });
const hiddenLines = computed(() => draft.value.links?.hide?.length || 0);
const own = (id: string) => /^l\d+$/.test(id);
function lineName(id: string): string {
  if (!own(id)) { const [a, b] = id.split(">"); return `${a ? name(a) : "Common Core"} → ${name(b)}`; }
  const l = draft.value.links?.add?.find((x) => x.id === id), side = (e?: LinkEnd) => (!e ? "?" : "node" in e ? name(e.node) : "line" in e ? t("a line", "una línea") : t("a point", "un punto"));
  return `${side(l?.from)} → ${side(l?.to)}`;
}
const lineEl = (root: Element, id: string) => root.querySelector<SVGLineElement>(`line[data-link="${CSS.escape(id)}"]`);
const coords = (l: SVGLineElement) => ["x1", "y1", "x2", "y2"].map((a) => +l.getAttribute(a)!);
/** The picked line outlined, a round handle on each end. */
function decorateLine(root: SVGSVGElement) {
  root.querySelectorAll(".hge-line-sel").forEach((x) => x.classList.remove("hge-line-sel"));
  root.querySelectorAll("[data-hge-end]").forEach((x) => x.remove());
  const l = pickedLine.value && lineEl(root, pickedLine.value);
  if (!l) return;
  l.classList.add("hge-line-sel");
  const [x1, y1, x2, y2] = coords(l), r = 7 / (root.getScreenCTM()?.a || 1);
  [[x1, y1], [x2, y2]].forEach(([x, y], i) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [a, v] of Object.entries({ cx: x, cy: y, r, class: "hge-end", "data-hge-end": i + 1 })) c.setAttribute(a, String(v));
    root.appendChild(c);
  });
}
/** What lies under a point of the screen: a project, else the nearest line within 8 px (and how far along it). */
function anchorAt(root: SVGSVGElement, cx: number, cy: number, skip = ""): { end: LinkEnd; x: number; y: number } | null {
  const g = document.elementFromPoint(cx, cy)?.closest?.<SVGGElement>("[data-hg]");
  if (g && root.contains(g)) { const bb = shapeOf(g)!.getBBox(); return { end: { node: g.dataset.hg! }, x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; }
  const p = toSvg(root, cx, cy), lim = 8 / (root.getScreenCTM()?.a || 1);
  let best: { d: number; end: LinkEnd; x: number; y: number } | null = null;
  for (const l of root.querySelectorAll<SVGLineElement>("line[data-link]")) {
    if (l.dataset.link === skip) continue;
    const [x1, y1, x2, y2] = coords(l), dx = x2 - x1, dy = y2 - y1, tt = clamp(((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy || 1), [0, 1]);
    const qx = x1 + tt * dx, qy = y1 + tt * dy, d = Math.hypot(p.x - qx, p.y - qy);
    if (d < lim && (!best || d < best.d)) best = { d, end: { line: l.dataset.link!, t: Math.round(tt * 1000) / 1000 }, x: qx, y: qy };
  }
  return best;
}
const sameEnd = (a: LinkEnd, b: LinkEnd) => JSON.stringify(a) === JSON.stringify(b);
function addLine(from: LinkEnd, to: LinkEnd) {
  if (sameEnd(from, to)) return;
  let id = "";
  change((d) => {
    const links = (d.links ||= {}), add = (links.add ||= []);
    let n = 1;
    while (add.some((l) => l.id === `l${n}`)) n++;
    id = `l${n}`;
    add.push({ id, from, to });
  });
  pickedLine.value = id;
}
function moveEnd(id: string, which: 1 | 2, end: LinkEnd) {
  const root = svgRoot(), l = root && lineEl(root, id);
  if (!l) return;
  const [x1, y1] = coords(l);
  let picked = id;
  change((d) => {
    const links = (d.links ||= {}), add = (links.add ||= []);
    if (own(id)) { const x = add.find((y) => y.id === id); if (x) x[which === 1 ? "from" : "to"] = end; return; }
    // a structural line moved: taken away, and the owner's in its place; the lines on it follow it
    const [a, b] = id.split(">");
    let n = 1;
    while (add.some((y) => y.id === `l${n}`)) n++;
    picked = `l${n}`;
    const from: LinkEnd = a ? { node: a } : { x: Math.round(x1), y: Math.round(y1) }, to: LinkEnd = { node: b };
    add.push({ id: picked, from: which === 1 ? end : from, to: which === 2 ? end : to });
    links.hide = [...new Set([...(links.hide || []), id])];
    for (const y of add) for (const k of ["from", "to"] as const) { const e = y[k]; if ("line" in e && e.line === id) y[k] = { line: picked, t: e.t }; }
  });
  pickedLine.value = picked;
}
function removeLine(id: string) {
  change((d) => {
    const links = (d.links ||= {}), gone = new Set([id]);
    if (!own(id)) links.hide = [...new Set([...(links.hide || []), id])];
    // and every line resting on it, and on those
    for (let grew = true; grew;) {
      grew = false;
      for (const y of links.add || []) if (!gone.has(y.id) && [y.from, y.to].some((e) => "line" in e && gone.has(e.line))) { gone.add(y.id); grew = true; }
    }
    links.add = (links.add || []).filter((y) => !gone.has(y.id));
    if (!links.add.length) delete links.add;
    if (!links.hide?.length) delete links.hide;
    if (!Object.keys(links).length) delete d.links;
  });
  pickedLine.value = "";
}
function restoreLines() { change((d) => { if (d.links) { delete d.links.hide; if (!Object.keys(d.links).length) delete d.links; } }); }
function onLineDown(e: PointerEvent, root: SVGSVGElement) {
  const endEl = (e.target as Element).closest<SVGCircleElement>("[data-hge-end]"), start = endEl ? null : anchorAt(root, e.clientX, e.clientY), x0 = e.clientX, y0 = e.clientY;
  if (!endEl && !start) { // the ground: a click lets go of the picked line, a drag pans
    const up = (ev: PointerEvent) => { window.removeEventListener("pointerup", up); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) pickedLine.value = ""; };
    window.addEventListener("pointerup", up);
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  const which = (endEl ? +endEl.dataset.hgeEnd! : 2) as 1 | 2, l = endEl ? lineEl(root, pickedLine.value) : null;
  const [ox, oy] = l ? (which === 1 ? coords(l).slice(2) : coords(l).slice(0, 2)) : [start!.x, start!.y];
  const ghost = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const [a, v] of Object.entries({ x1: ox, y1: oy, x2: ox, y2: oy, class: "hge-draft" })) ghost.setAttribute(a, String(v));
  root.appendChild(ghost);
  if (endEl) endEl.style.pointerEvents = "none";
  if (l) l.style.opacity = "0.25";
  let live = false;
  const onMove = (ev: PointerEvent) => {
    if (!live && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    live = true;
    const a = anchorAt(root, ev.clientX, ev.clientY, l ? pickedLine.value : ""), p = a || toSvg(root, ev.clientX, ev.clientY);
    ghost.setAttribute("x2", String(p.x));
    ghost.setAttribute("y2", String(p.y));
    ghost.classList.toggle("snap", !!a);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    ghost.remove();
    if (l) l.style.opacity = "";
    if (endEl) endEl.style.pointerEvents = "";
    if (!live) { if (start) pickedLine.value = "line" in start.end ? start.end.line : ""; return; }
    const at = anchorAt(root, ev.clientX, ev.clientY, l ? pickedLine.value : ""), p = toSvg(root, ev.clientX, ev.clientY);
    const end: LinkEnd = at ? at.end : { x: Math.round(p.x), y: Math.round(p.y) }; // nothing there: a point of the drawing
    if (l) moveEnd(pickedLine.value, which, end);
    else addLine(start!.end, end);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function onDown(e: PointerEvent) {
  const t = e.target as Element, root = t.closest?.<SVGSVGElement>(".hge-svg svg");
  if (e.button || !root) return;
  if (lineMode.value) return onLineDown(e, root);
  const handle = t.closest("[data-hge-handle]"), g = handle ? null : t.closest<SVGGElement>("[data-hg]"), x0 = e.clientX, y0 = e.clientY;
  if (!handle && !g) {
    if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); marquee(root, e); return; }
    const up = (ev: PointerEvent) => { window.removeEventListener("pointerup", up); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) chosen.value = []; }; // a click on the ground lets go
    window.addEventListener("pointerup", up);
    return; // and a drag pans
  }
  e.stopPropagation(); // the stage pans only from the ground
  e.preventDefault();
  const k = 1 / (root.getScreenCTM()?.a || 1), s = g ? keyOf(g) : "", add = e.shiftKey || e.ctrlKey || e.metaKey;
  const group = handle || chosen.value.includes(s) ? [...chosen.value] : [s]; // a picked one carries the others; another goes alone
  const pieces = group.flatMap((x) => piecesOf(root, x));
  const ends = handle ? [] : group.flatMap((x) => [...root.querySelectorAll<SVGLineElement>(`line[data-to="${CSS.escape(x)}"], line[data-from="${CSS.escape(x)}"]`)].map((l) => {
    const i = l.dataset.to === x ? 2 : 1;
    return { l, i, x: +l.getAttribute(`x${i}`)!, y: +l.getAttribute(`y${i}`)! };
  }));
  const cx = +(handle?.getAttribute("data-cx") || 0), cy = +(handle?.getAttribute("data-cy") || 0);
  const hx = handle ? +handle.getAttribute("x")! + +handle.getAttribute("width")! / 2 : 0, hy = handle ? +handle.getAttribute("y")! + +handle.getAttribute("height")! / 2 : 0;
  const start = { ...drawn.value };
  let dx = 0, dy = 0, live = false;
  const factor = () => clamp(Math.hypot(hx + dx - cx, hy + dy - cy) / (Math.hypot(hx - cx, hy - cy) || 1), [0.2, 5]);
  const onMove = (ev: PointerEvent) => {
    if (!live && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    live = true;
    dx = (ev.clientX - x0) * k;
    dy = (ev.clientY - y0) * k;
    if (handle) {
      const f = factor();
      pieces.forEach((p) => p.setAttribute("transform", `translate(${cx} ${cy}) scale(${f}) translate(${-cx} ${-cy})`));
      handle.setAttribute("transform", `translate(${dx} ${dy})`);
    } else {
      pieces.forEach((p) => p.setAttribute("transform", `translate(${dx} ${dy})`));
      ends.forEach((o) => { o.l.setAttribute(`x${o.i}`, String(o.x + dx)); o.l.setAttribute(`y${o.i}`, String(o.y + dy)); });
    }
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!live) {
      if (!g) return;
      chosen.value = add ? (chosen.value.includes(s) ? chosen.value.filter((x) => x !== s) : [...chosen.value, s]) : [s];
      g.focus({ preventScroll: true });
      return;
    }
    if (handle) {
      const f = factor();
      setNodes(group, (x, was) => {
        const o = start[x];
        if (!o) return {};
        return { r: o.box ? was.r : clamp(Math.round(o.r * f), NODE_RANGE.r), dx: clamp(Math.round((was.dx || 0) + (o.cx - cx) * (f - 1)), NODE_RANGE.dx), dy: clamp(Math.round((was.dy || 0) + (o.cy - cy) * (f - 1)), NODE_RANGE.dy) };
      });
    } else setNodes(group, (_, was) => ({ dx: clamp(Math.round((was.dx || 0) + dx), NODE_RANGE.dx), dy: clamp(Math.round((was.dy || 0) + dy), NODE_RANGE.dy) }));
    chosen.value = group;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
/** Shift and a drag over the ground: a rectangle, and every project whose middle it holds joins what's picked. */
function marquee(root: SVGSVGElement, e: PointerEvent) {
  const a = toSvg(root, e.clientX, e.clientY), r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  r.setAttribute("class", "hge-marquee");
  root.appendChild(r);
  let b = a;
  const onMove = (ev: PointerEvent) => {
    b = toSvg(root, ev.clientX, ev.clientY);
    for (const [k, v] of Object.entries({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })) r.setAttribute(k, String(v));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    r.remove();
    const [lx, hx2, ly, hy2] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)], inside = new Set(chosen.value);
    for (const g of root.querySelectorAll("[data-hg]")) {
      const bb = shapeOf(g)?.getBBox();
      if (bb && bb.x + bb.width / 2 >= lx && bb.x + bb.width / 2 <= hx2 && bb.y + bb.height / 2 >= ly && bb.y + bb.height / 2 <= hy2) inside.add(keyOf(g));
    }
    chosen.value = [...inside];
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function onKey(e: KeyboardEvent) {
  const g = (e.target as Element).closest?.<SVGGElement>("[data-hg]"), d = ARROWS[e.key];
  if (!g || !d) return;
  e.preventDefault();
  const s = keyOf(g), step = e.shiftKey ? 25 : 5, group = chosen.value.includes(s) ? [...chosen.value] : [s];
  chosen.value = group;
  refocus = g.dataset.hg!;
  setNodes(group, (_, was) => ({ dx: clamp((was.dx || 0) + d[0] * step, NODE_RANGE.dx), dy: clamp((was.dy || 0) + d[1] * step, NODE_RANGE.dy) }));
}
function onFocus(e: FocusEvent) { const g = (e.target as Element).closest?.<SVGGElement>("[data-hg]"); if (g && !chosen.value.includes(keyOf(g))) chosen.value = [keyOf(g)]; }
/** The slider: one picked, its size; several, a share of each one's own (it goes back to 100% after). */
function sizeTo(v: number) {
  if (oneR.value) setNodes(sized.value, () => ({ r: clamp(v, NODE_RANGE.r) }));
  else setNodes(sized.value, (x) => ({ r: clamp(Math.round((drawn.value[x].r * v) / 100), NODE_RANGE.r) }));
}
function shapeTo(sh: HolyNode["shape"]) { setNodes(sized.value, () => ({ shape: sh })); }

// ---- the page's Outer Core groups (outer.groups): named, in order; from what's picked in the drawing, or the branches
const groups = computed(() => draft.value.outer.groups || []);
const groupName = ref("");
const outerSlugs = computed(() => { const g = draft.value.outer; return new Set([...g.roots, ...g.edges.flat(), ...Object.values(g.boxes).flat().map((b) => b.slug)]); });
/** What's picked as the page lists it: a Piscine box as its piscines, Common Core projects left out. */
const pickedOuter = computed(() => chosen.value.flatMap((s) => (draft.value.outer.boxes[s] ? draft.value.outer.boxes[s].map((b) => b.slug) : [s])).filter((s) => outerSlugs.value.has(s)));
function groupPicked() {
  const nm = groupName.value.trim().slice(0, 60), slugs = pickedOuter.value;
  if (!nm || !slugs.length) { note.value = t("Name the group and pick Outer Core projects in the drawing.", "Pon nombre al grupo y elige proyectos del Outer Core en el dibujo."); return; }
  change((d) => { d.outer.groups = [...(d.outer.groups || []).map((g) => ({ ...g, slugs: g.slugs.filter((s) => !slugs.includes(s)) })).filter((g) => g.slugs.length), { name: nm, slugs }]; });
  groupName.value = "";
  note.value = t(`Group made: ${nm}.`, `Grupo creado: ${nm}.`);
}
function editGroups(f: (gs: { name: string; slugs: string[] }[]) => void) { change((d) => { const gs = d.outer.groups || []; f(gs); d.outer.groups = gs.filter((g) => g.name.trim()); if (!d.outer.groups.length) delete d.outer.groups; }); }
function moveGroup(i: number, by: number) { editGroups((gs) => { const j = i + by; if (j >= 0 && j < gs.length) [gs[i], gs[j]] = [gs[j], gs[i]]; }); }
const groupAdding = ref<Record<number, string>>({});
function addToGroup(i: number) {
  const s = slugOf(groupAdding.value[i] || "");
  if (!s) { note.value = t("That project is not in the catalog.", "Ese proyecto no está en el catálogo."); return; }
  editGroups((gs) => { gs.forEach((g) => { g.slugs = g.slugs.filter((x) => x !== s); }); gs[i].slugs.push(s); });
  groupAdding.value = { ...groupAdding.value, [i]: "" };
}
function groupsFromBranches() {
  const bs = outerBranches(draft.value), single = bs.filter((b) => b.slugs.length < 2).flatMap((b) => b.slugs), seen = new Set<string>();
  const once = (slugs: string[]) => slugs.filter((s) => !seen.has(s) && seen.add(s)); // a project two branches lead to: in the first
  editGroups((gs) => { gs.splice(0, gs.length, ...bs.filter((b) => b.slugs.length >= 2).map((b) => ({ name: name(b.root), slugs: once(b.slugs) })), ...(single.length ? [{ name: t("Single projects", "Proyectos sueltos"), slugs: once(single) }] : [])); });
}

// ---- full screen (the drawing alone), and Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) anywhere but in a text field
const full = ref(false);
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else preview.value?.requestFullscreen?.().catch(() => { note.value = t("This browser won't go full screen here.", "Este navegador no deja poner pantalla completa aquí."); }); }
const onFull = () => { full.value = document.fullscreenElement === preview.value; nextTick(decorate); };
function onUndoKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  if (el.closest?.("input, textarea, select, [contenteditable]")) return; // a text field's own undo and keys
  if (!(e.ctrlKey || e.metaKey) || e.altKey) {
    if (pickedLine.value && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); removeLine(pickedLine.value); }
    return;
  }
  const key = e.key.toLowerCase();
  if (key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (key === "y") { e.preventDefault(); redo(); }
}
onMounted(() => { addEventListener("keydown", onUndoKey); document.addEventListener("fullscreenchange", onFull); });
onBeforeUnmount(() => { removeEventListener("keydown", onUndoKey); document.removeEventListener("fullscreenchange", onFull); });
const ranges = Object.entries(LAYOUT_RANGE) as [keyof typeof LAYOUT, [number, number]][];

const busy = ref(false);
async function save() {
  busy.value = true;
  try { await api("/api/holygraph", { method: "PUT", body: JSON.stringify(draft.value), headers: { "Content-Type": "application/json" } }); note.value = t("Saved: the Holy graph page draws it now (this server). Download it to take it to production.", "Guardado: la página Holy graph ya lo dibuja (este servidor). Descárgalo para llevarlo a producción."); }
  catch (e: any) { note.value = `${t("Refused", "Rechazado")}: ${e?.body?.why || e?.body?.error || ""}`; }
  busy.value = false;
}
function download() {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(draft.value, null, 1)], { type: "application/json" })), download: "holygraph.json" });
  a.click();
}
async function builtIn() {
  await api("/api/holygraph", { method: "DELETE" }).catch(() => {});
  change((d) => { for (const k of Object.keys(d)) delete (d as any)[k]; Object.assign(d, structuredClone(BUILT_IN)); }); // its layout and moves go too
  note.value = t("Back to the built-in holy graph.", "De vuelta al holy graph de fábrica.");
}
</script>

<template>
  <AppHeader nav />
  <main id="main" class="hge">
    <div class="page-head"><h1>{{ t("Holy graph editor", "Editor del holy graph") }}</h1></div>
    <div class="hge-bar">
      <div class="seg" role="group">
        <button v-for="[k, l] in [['c', 'C'], ['python', 'Python'], ['outer', 'Outer'], ['piscine', t('Piscine', 'Piscina')], ['layout', t('Sizes', 'Medidas')]]" :key="k" type="button" :aria-pressed="tab === k" @click="tab = k as any">{{ l }}</button>
      </div>
      <div class="hge-actions">
        <button class="btn secondary" type="button" @click="undo">{{ t("Undo", "Deshacer") }}</button>
        <button class="btn secondary" type="button" @click="redo">{{ t("Redo", "Rehacer") }}</button>
        <button class="btn secondary" type="button" @click="builtIn">{{ t("Built-in", "De fábrica") }}</button>
        <button class="btn secondary" type="button" @click="download">{{ t("Download", "Descargar") }}</button>
        <button class="btn primary" type="button" :disabled="busy" @click="save">{{ t("Save", "Guardar") }}</button>
      </div>
    </div>
    <p v-if="note" class="hge-note" role="status">{{ note }}</p>
    <div class="hge-cols">
      <div class="hge-edit">
        <template v-if="tab === 'c' || tab === 'python'">
          <section v-for="(ring, k) in rings" :key="k" class="hge-ring">
            <h3>Milestone {{ k }}<span class="count"> · {{ ring.length }}</span></h3>
            <ul>
              <li v-for="(it, i) in ring" :key="i">
                <label class="hge-pick"><input type="checkbox" :checked="picked.has(key(k, i))" @change="toggle(k, i)"><span>{{ label(it) }}</span></label>
                <span class="hge-tools">
                  <button type="button" :aria-label="t('Earlier', 'Antes')" @click="move(k, i, -1)">↑</button>
                  <button type="button" :aria-label="t('Later', 'Después')" @click="move(k, i, 1)">↓</button>
                  <select :aria-label="t('Milestone', 'Milestone')" :value="k" @change="toRing(k, i, +($event.target as HTMLSelectElement).value)">
                    <option v-for="m in 7" :key="m" :value="m - 1">M{{ m - 1 }}</option>
                  </select>
                  <button v-if="typeof it !== 'string'" type="button" @click="split(k, i)">{{ t("Split", "Separar") }}</button>
                  <button type="button" :aria-label="t('Remove', 'Quitar')" @click="remove(k, i)">×</button>
                </span>
              </li>
            </ul>
            <div class="hge-add">
              <input :list="'hge-names'" :placeholder="t('Add a project…', 'Añadir un proyecto…')" :value="adding[`${track}:${k}`] || ''" @input="adding = { ...adding, [`${track}:${k}`]: ($event.target as HTMLInputElement).value }" @keydown.enter="add(k)">
              <button class="btn secondary" type="button" @click="add(k)">{{ t("Add", "Añadir") }}</button>
              <button class="btn secondary" type="button" @click="group(k, 'alt')">{{ t("One of them", "Alternativa") }}</button>
              <button class="btn secondary" type="button" @click="group(k, 'chain')">{{ t("Series", "Serie") }}</button>
            </div>
          </section>
        </template>
        <template v-else-if="tab === 'outer'">
          <section class="hge-ring">
            <h3>{{ t("Branches, clockwise from the top", "Ramas, en el sentido del reloj desde arriba") }}<span class="count"> · {{ draft.outer.roots.length }}</span></h3>
            <ul>
              <li v-for="(r, i) in draft.outer.roots" :key="r"><span>{{ name(r) }}</span>
                <span class="hge-tools"><button type="button" @click="moveRoot(i, -1)">↑</button><button type="button" @click="moveRoot(i, 1)">↓</button><button type="button" @click="removeRoot(i)">×</button></span></li>
            </ul>
            <div class="hge-add"><input list="hge-names" v-model="newRoot" :placeholder="t('Add a branch…', 'Añadir una rama…')" @keydown.enter="addRoot"><button class="btn secondary" type="button" @click="addRoot">{{ t("Add", "Añadir") }}</button></div>
          </section>
          <section class="hge-ring">
            <h3>{{ t("Groups on the Holy graph page", "Grupos en la página Holy graph") }}<span class="count"> · {{ groups.length }}</span></h3>
            <p v-if="!groups.length" class="note">{{ t("None: the page groups by branch. Pick projects in the drawing and \"Group them\", or start from the branches.", "Ninguno: la página agrupa por rama. Elige proyectos en el dibujo y «Agruparlos», o parte de las ramas.") }}</p>
            <div v-for="(g, i) in groups" :key="i" class="hge-group">
              <div class="hge-add"><input :value="g.name" :aria-label="t('Group name', 'Nombre del grupo')" @change="editGroups((gs) => { gs[i].name = ($event.target as HTMLInputElement).value.slice(0, 60); })">
                <span class="hge-tools"><button type="button" @click="moveGroup(i, -1)">↑</button><button type="button" @click="moveGroup(i, 1)">↓</button><button type="button" @click="editGroups((gs) => gs.splice(i, 1))">×</button></span></div>
              <ul><li v-for="x in g.slugs" :key="x"><span>{{ name(x) }}</span><span class="hge-tools"><button type="button" @click="editGroups((gs) => { gs[i].slugs = gs[i].slugs.filter((y) => y !== x); })">×</button></span></li></ul>
              <div class="hge-add"><input list="hge-names" :placeholder="t('Add a project…', 'Añadir un proyecto…')" :value="groupAdding[i] || ''" @input="groupAdding = { ...groupAdding, [i]: ($event.target as HTMLInputElement).value }" @keydown.enter="addToGroup(i)"><button class="btn secondary" type="button" @click="addToGroup(i)">{{ t("Add", "Añadir") }}</button></div>
            </div>
            <div class="hge-add"><button class="btn secondary" type="button" @click="groupsFromBranches">{{ t("From the branches", "Desde las ramas") }}</button>
              <button v-if="groups.length" class="btn secondary" type="button" @click="editGroups((gs) => gs.splice(0))">{{ t("No groups (by branch)", "Sin grupos (por rama)") }}</button></div>
          </section>
          <section class="hge-ring">
            <h3>{{ t("Links: parent > child, one per line", "Conexiones: padre > hijo, una por línea") }}</h3>
            <textarea v-model="edgesText" rows="16" spellcheck="false"></textarea>
            <div class="hge-add"><button class="btn secondary" type="button" @click="applyEdges">{{ t("Apply the links", "Aplicar las conexiones") }}</button></div>
          </section>
        </template>
        <template v-else-if="tab === 'piscine'">
          <p class="note">{{ t("The Piscine starts from the intra's four rows: move, size and shape its projects in the drawing; all of them at once in Sizes.", "La Piscina parte de las cuatro filas de la intra: mueve, cambia de tamaño y de forma sus proyectos en el dibujo; todos a la vez en Medidas.") }}</p>
        </template>
        <template v-else>
          <section class="hge-ring">
            <div v-for="[k, range] in ranges" :key="k" class="hge-slider">
              <label :for="`hge-${k}`">{{ LABELS[k][es ? 1 : 0] }}<b>{{ layout[k].toFixed(k.startsWith("ring_t") || k.startsWith("ring_s") ? 2 : 0) }}</b></label>
              <input :id="`hge-${k}`" type="range" :min="range[0]" :max="range[1]" :step="k.startsWith('ring_t') || k.startsWith('ring_s') ? 0.02 : 1" :value="layout[k]"
                @change="setLayout(k, +($event.target as HTMLInputElement).value)">
            </div>
          </section>
        </template>
      </div>
      <div ref="preview" class="hge-preview hg-wrap" :class="{ 'hge-lines': lineMode }" @pointerdown.capture="onDown" @keydown="onKey" @focusin="onFocus">
        <div v-if="tab !== 'layout'" class="hge-node">
          <template v-if="full">
            <div class="seg" role="group"><button v-for="[k, l] in [['c', 'C'], ['python', 'Python'], ['piscine', t('Piscine', 'Piscina')]]" :key="k" type="button" :aria-pressed="tab === k" @click="tab = k as any">{{ l }}</button></div>
            <button class="btn secondary" type="button" @click="undo">{{ t("Undo", "Deshacer") }}</button><button class="btn secondary" type="button" @click="redo">{{ t("Redo", "Rehacer") }}</button>
            <button class="btn primary" type="button" :disabled="busy" @click="save">{{ t("Save", "Guardar") }}</button>
          </template>
          <button class="btn secondary" type="button" @click="toggleFull">{{ full ? t("Leave full screen", "Salir de pantalla completa") : t("Full screen", "Pantalla completa") }}</button>
          <button class="btn secondary" type="button" :aria-pressed="lineMode" @click="lineMode = !lineMode">{{ t("Lines", "Líneas") }}</button>
          <template v-if="lineMode">
            <template v-if="pickedLine"><b>{{ lineName(pickedLine) }}</b><button class="btn secondary" type="button" @click="removeLine(pickedLine)">{{ t("Take the line away", "Quitar la línea") }}</button></template>
            <p v-else class="note">{{ t("Drag from a project or a line to a project, a point of a line or anywhere to draw a line. Click a line to pick it: drag its round ends to move it, Delete takes it away.", "Arrastra desde un proyecto o una línea hasta un proyecto, un punto de una línea o donde quieras para trazar una línea. Pulsa una línea para elegirla: arrastra sus extremos redondos para moverla y Supr la quita.") }}</p>
            <button v-if="hiddenLines" class="btn secondary" type="button" @click="restoreLines">{{ t(`Bring back the ${hiddenLines} taken away`, `Devolver las ${hiddenLines} quitadas`) }}</button>
          </template>
          <template v-else-if="chosen.length">
            <b>{{ chosen.length === 1 ? name(chosen[0]) : t(`${chosen.length} picked`, `${chosen.length} elegidos`) }}</b>
            <template v-if="sized.length">
              <label class="hge-size">{{ oneR ? t("Size", "Tamaño") : t("Size %", "Tamaño %") }}<input type="range" :min="oneR ? NODE_RANGE.r[0] : 25" :max="oneR ? NODE_RANGE.r[1] : 300" :value="oneR || 100" @change="sizeTo(+($event.target as HTMLInputElement).value)"></label>
              <div class="seg" role="group" :aria-label="t('Shape', 'Forma')">
                <button v-for="sh in SHAPES" :key="sh" type="button" :aria-pressed="sharedShape === sh" @click="shapeTo(sh)">{{ SHAPE_NAMES[sh][es ? 1 : 0] }}</button>
              </div>
            </template>
            <button class="btn secondary" type="button" @click="resetChosen">{{ t("As laid out", "Como estaba") }}</button>
            <span v-if="pickedOuter.length" class="hge-add"><input v-model="groupName" :placeholder="t('Group name…', 'Nombre del grupo…')" @keydown.enter="groupPicked"><button class="btn secondary" type="button" @click="groupPicked">{{ t("Group them", "Agruparlos") }}</button></span>
          </template>
          <p v-else class="note">{{ t("Drag a project to move it; Shift, Ctrl or ⌘ and a click picks more, Shift and a drag over the ground picks a whole area. The square on the corner scales what's picked; Ctrl+Z undoes.", "Arrastra un proyecto para moverlo; Mayús, Ctrl o ⌘ y un clic eligen más, Mayús y arrastrar sobre el fondo elige una zona. El cuadrito de la esquina escala lo elegido; Ctrl+Z deshace.") }}</p>
          <button v-if="moves" class="btn secondary" type="button" @click="resetAll">{{ t(`All ${moves} as laid out`, `Los ${moves} como estaban`) }}</button>
        </div>
        <div :key="ver" class="hg-stage" tabindex="-1">
          <div class="hg-zoom"><button type="button" class="btn secondary" data-hg-zoom="in">+</button><button type="button" class="btn secondary" data-hg-zoom="out">−</button><button type="button" class="btn secondary" data-hg-zoom="fit">{{ t("Whole", "Todo") }}</button></div>
          <div class="hge-svg" v-html="svg"></div>
        </div>
      </div>
    </div>
    <datalist id="hge-names"><option v-for="n in names" :key="n.slug" :value="n.name">{{ n.slug }}</option></datalist>
  </main>
</template>
