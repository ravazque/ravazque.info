<script setup lang="ts">
// The six app pages. Asks for the status first (consent, a report, an extraction running), then the period's view,
// builds the sections as markup and lets the browser behaviours take it from there.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { HttpError, api, fmt, hasPin, loadPins, loadSession, moveWidget, pins, relabelStars, setWidget, settings, state, togglePin, untilQuarter, type Status } from "../state";
import { VIEW_TTL, viewCache } from "../viewcache";
import { closePops, dragScroll, hideTip, settle } from "../lib/behave";
import { esc, initials } from "../lib/h";
import { parseCsv } from "../lib/table";
import { CAMPUS_TABS, PATHS, Page, keptParams, onCampus, pagePeriod, type PageKey, type Section, type View } from "../views/page";
import { WIDGETS, profile as profileSections } from "../views/profile";
import { portfolioCsv, projects, projectsCsv } from "../views/projects";
import { evaluations } from "../views/evaluations";
import { people } from "../views/people";
import { campus } from "../views/campus";
import { campusPiscinePage, campusProjectsPage, holyPage } from "../views/holygraph";
import { examsPage, summaryPage } from "../views/madrid";
import { installHoly } from "../lib/holy";
import { coalition, coalitionMode } from "../views/coalition";
import AppHeader from "./AppHeader.vue";
import SiteCredit from "./SiteCredit.vue";

const route = useRoute(), router = useRouter();
const f = computed(() => fmt.value);
const SUBS: Record<string, PageKey> = { exams: "exams", "42cursus": "cc", piscine: "piscine" };
const key = computed<PageKey>(() => (route.path.startsWith("/app/madrid") ? SUBS[route.params.sub as string] || "madrid" : ((route.params.page as string) || "home") as PageKey));
const view = shallowRef<View | null>(null);
const screen = ref<"loading" | "consent" | "boot" | "page">("loading");
const consentOk = ref(false);
const main = ref<HTMLElement | null>(null);
let poll = 0;

// the address, over the period and views this browser kept (keptParams)
const params = computed(() => keptParams(Object.fromEntries(Object.entries(route.query).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v ?? "")])), settings));
const pg = computed(() => (view.value ? new Page(f.value, view.value, key.value, params.value, !!state.session?.dev) : null));

// the weekly campus count, asked for once a Campus page or the Holy graph is opened
const campusStats = shallowRef<any>(null);
// and the holy graph the owner drew in the editor, if any (none: the one built into the app)
const holyDrawn = shallowRef<any>(null);
// your exams beside 42 Madrid's: on Projects, and on Profile while its exams widget is there
const examsPinned = computed(() => pins.widgets.some((w) => w.page === "projects" && w.id === "exams"));
watch([key, examsPinned], ([k, pinned]) => {
  const graph = onCampus(k) || k === "holygraph";
  if (!graph && k !== "projects" && !(k === "home" && pinned)) return;
  if (!campusStats.value) api<{ stats: any }>("/api/campus-stats").then((r) => { campusStats.value = r.stats; }).catch(() => {});
  if (graph) api<any>("/api/holygraph").then((g) => { holyDrawn.value = g || null; }).catch(() => {});
}, { immediate: true });
const sections = computed<Section[]>(() => {
  if (!pg.value) return [];
  const pv = pg.value;
  if (key.value === "home") return profileSections(pv, pins.widgets, campusStats.value);
  return key.value === "projects" ? projects(pv, campusStats.value) : key.value === "evaluations" ? evaluations(pv)
    : key.value === "people" ? people(pv) : key.value === "campus" ? campus(pv) : key.value === "coalition" ? coalition(pv)
    : key.value === "holygraph" ? holyPage(pv, campusStats.value, holyDrawn.value) : key.value === "madrid" ? summaryPage(pv, campusStats.value)
    : key.value === "exams" ? examsPage(pv, campusStats.value) : key.value === "cc" ? campusProjectsPage(pv, campusStats.value, holyDrawn.value)
    : key.value === "piscine" ? campusPiscinePage(pv, campusStats.value, holyDrawn.value) : [];
});

// the section index; on Profile: your card and every widget you keep (in their order: it follows as you add, move or
// take one away)
const toc = computed(() => key.value !== "home" ? sections.value.filter((s) => s.nav) : [
  ...sections.value.filter((s) => s.id === "profile"),
  ...pins.widgets.flatMap((w) => { const d = WIDGETS.find(([p, i]) => p === w.page && i === w.id); return d ? [{ id: w.id, nav: f.value.t(d[2]) }] : []; })]);
const me = computed(() => state.session?.user);

const title = computed(() => {
  if (onCampus(key.value)) return f.value.t("pages.madrid"); // 42 Madrid: one title, its parts as tabs under it
  if (key.value !== "home") return f.value.t(`pages.${key.value}`);
  return f.value.t("profile.title");
});
const tabLabel = (k: PageKey) => f.value.t(k === "madrid" ? "campus.tab_madrid" : `pages.${k}`);
watch([title, key, () => f.value], () => {
  document.title = `${onCampus(key.value) && key.value !== "madrid" ? `${tabLabel(key.value)} · ` : ""}${title.value} · ${f.value.t("site.name")}`;
}, { immediate: true });

async function status(kick = false): Promise<Status> {
  const s = await api<Status>(`/api/me/status${kick ? "?kick=1" : ""}`);
  state.status = s;
  return s;
}

async function load() {
  clearTimeout(poll);
  try {
    if (!state.session?.user) await loadSession();
    if (!state.session?.user) return router.replace("/");
    loadPins(state.session.user.login);
    let s = await status();
    if (s.state === "refused") return router.replace(`/refused?reason=${encodeURIComponent(s.message || "campus")}`);
    if (!s.consent) { screen.value = "consent"; return; }
    if (!s.has_report && ["none", "done"].includes(s.state)) s = await status(true); // nothing kept on the server: the first extraction
    if (!s.has_report) {
      screen.value = "boot";
      if (s.state !== "failed") poll = window.setTimeout(load, 2000);
      return;
    }
    await fetchView();
    if (["queued", "running"].includes(s.state)) poll = window.setTimeout(watchSync, 2000);
    else freshen(s);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) { state.session = null; return router.replace("/"); }
    throw e;
  }
}

/** The period's view: kept in this tab for the hour (another page draws at once, no skeleton), asked again when `fresh`
 * (a refresh just ended, a report was handed back). */
async function fetchView(fresh = false) {
  const period = pagePeriod(key.value, params.value.period || "");
  const k = `${state.session?.user?.login || ""}|${period}`, kept = viewCache.get(k);
  if (fresh) viewCache.clear();
  else if (kept && Date.now() - kept.at < VIEW_TTL) {
    view.value = kept.v;
    screen.value = "page";
    followCoalitions();
    return;
  }
  try {
    view.value = await api<View>(`/api/me/view${period ? `?period=${encodeURIComponent(period)}` : ""}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) { viewCache.clear(); return load(); } // forgotten while the page sat open: the copy goes back
    throw e;
  }
  viewCache.set(k, { v: view.value, at: Date.now() });
  screen.value = "page";
  followCoalitions();
}

/** The kept report shows at once and is left as it is (owner, 2026-11-25): only one extracted over a day ago (or at an
 * unknown time) brings a fresh extraction in the band; anything sooner waits for the refresh button. */
async function freshen(st: Status) {
  if (st.state !== "done" || Date.now() - Date.parse(st.last || "") < 86400e3) return;
  const s = await api<Status>("/api/me/refresh", { method: "POST" }).catch((e) => e?.body);
  if (!s?.state) return;
  state.status = { ...state.status!, ...s };
  if (["queued", "running"].includes(s.state)) poll = window.setTimeout(watchSync, 2000);
}

/** While an extraction runs from the band: the bar follows it, the page reloads its data once it is over. */
async function watchSync() {
  const s = await status().catch(() => null);
  if (s && ["queued", "running"].includes(s.state)) { poll = window.setTimeout(watchSync, 2000); return; }
  await fetchView(true);
}

/** The server refreshes the coalitions' standing on every quarter of the hour: where it shows, the open page follows
 * (half a minute later, the refresh done). */
let live = 0;
function followCoalitions() {
  clearTimeout(live);
  live = window.setTimeout(async () => {
    const v = view.value;
    if (v && main.value?.querySelector(".standings")) {
      const r = await api<{ coalitions: any[] }>("/api/me/coalitions").catch(() => null);
      if (r && v === view.value && JSON.stringify(r.coalitions) !== JSON.stringify(v.coalitions)) {
        view.value = { ...v, coalitions: r.coalitions };
        for (const [k, c] of viewCache) if (c.v === v) viewCache.set(k, { ...c, v: view.value }); // the kept copy follows
      }
    }
    followCoalitions();
  }, untilQuarter(new Date()) + 30_000);
}

watch([key, () => params.value.period], () => { if (screen.value === "page") fetchView(); else load(); });
load();
onBeforeUnmount(() => { clearTimeout(poll); clearTimeout(live); });

// the field being typed in survives the re-render its own input caused; a link's anchor is reached once drawn
let typingIn: { form: string; name: string; start: number | null; end: number | null } | null = null;
let anchored = "";
watch(sections, async () => {
  await nextTick();
  if (!main.value) return;
  settle(main.value);
  installHoly(main.value);
  markSections(main.value);
  markZoom(main.value);
  placeMarks(main.value);
  fitAxes(main.value);
  fitTicks(main.value);
  fitTitles(main.value);
  fitCard(main.value);
  fitTags(main.value);
  fitKeys(main.value);
  fitLists(main.value);
  fitSelects(main.value);
  evenRows(main.value);
  hideTip();
  if (typingIn) {
    const el = main.value.querySelector<HTMLInputElement>(`form[data-filter="${typingIn.form}"] [name="${typingIn.name}"]`);
    if (el && el.type !== "radio" && el.type !== "checkbox") {
      el.focus({ preventScroll: true });
      if (typingIn.start !== null && "setSelectionRange" in el && el.type === "search") el.setSelectionRange(typingIn.start, typingIn.end);
    } else main.value.querySelector<HTMLElement>(`form[data-filter="${typingIn.form}"] .seg, form[data-filter="${typingIn.form}"]`)?.focus?.();
    typingIn = null;
  }
  if (refocus) { // moved with the keys: the page goes where the widget went
    const grip = main.value.querySelector<HTMLElement>(`[data-widget="${refocus}"] [data-widget-grip]`);
    grip?.focus({ preventScroll: true });
    grip?.scrollIntoView({ block: "center" });
    refocus = "";
  }
  const hash = route.hash;
  if (hash && hash !== anchored) {
    anchored = hash;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }
}, { flush: "post" });

async function accept() {
  await api("/api/me/consent", { method: "POST", body: JSON.stringify({ accept: true }), headers: { "Content-Type": "application/json" } });
  load();
}
async function retry() { await api("/api/me/refresh", { method: "POST" }).catch(() => {}); load(); }

// links inside the pages stay in the app; filter forms write their fields into the address
// every section of a page carries a star by its title; a widget on Profile a handle to move it, its size and a way off
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M10 5l2-2 2 2M10 19l2 2 2-2M5 10l-2 2 2 2M19 10l2 2-2 2"/></svg>'; // move: two crossed two-way arrows
const WIDEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>';
const NARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h7M15 12h7M6 8l4 4-4 4M18 8l-4 4 4 4"/></svg>';
const UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4M5 11l7-7 7 7"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M5 13l7 7 7-7"/></svg>';
const ZOOM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>'; // a chevron: no stem, unlike the move arrows
const UNFOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let refocus = "";
const tool = (cls: string, icon: string, label: string, data: Record<string, string>) => {
  const b = Object.assign(document.createElement("button"), { type: "button", className: `pin ${cls}`, innerHTML: icon, title: label });
  b.setAttribute("aria-label", label);
  Object.assign(b.dataset, data);
  return b;
};
function markSections(root: HTMLElement) {
  const labels = new Map(sections.value.map((s) => [s.id, s.nav]));
  root.querySelectorAll<HTMLElement>(".sec > section[id], .widget > section[id]").forEach((sec) => {
    const widget = sec.parentElement?.dataset.widget;
    const page = widget ? widget.split(":")[0] : key.value;
    const h2 = sec.querySelector<HTMLElement>(":scope > h2, :scope > .panel-head > h2");
    if (!h2 || h2.classList.contains("visually-hidden") || h2.querySelector(".pin")) return;
    if (!widget && page === "home") return; // Profile's own sections (card, figures, path) have no tools
    const on = hasPin("stars", page, sec.id), name = labels.get(sec.id) || h2.textContent || sec.id;
    if (!widget) {
      const star = Object.assign(document.createElement("button"), { type: "button", className: "pin star-pin", innerHTML: STAR });
      Object.assign(star.dataset, { pin: `${page}:${sec.id}`, label: name });
      star.setAttribute("aria-pressed", String(on));
      star.setAttribute("aria-label", f.value.t(on ? "pin.unstar" : "pin.star", { name }));
      star.title = star.getAttribute("aria-label")!;
      h2.append(star);
    } else {
      const wide = sec.parentElement!.classList.contains("wide"), wname = sec.parentElement!.dataset.name || name;
      // a span, not a button: Firefox never starts a drag on a button
      const grip = Object.assign(document.createElement("span"), { className: "pin widget-grip", innerHTML: GRIP, tabIndex: 0, draggable: true, title: f.value.t("widgets.move", { name: wname }) });
      grip.setAttribute("role", "button");
      grip.setAttribute("aria-label", grip.title);
      grip.dataset.widgetGrip = widget;
      // on one column (phones, tablets: touch can't drag) two buttons move it up and down instead of the handle
      const i = +sec.parentElement!.dataset.i!, last = i === pins.widgets.length - 1;
      const up = tool("widget-move", UP, f.value.t("widgets.up", { name: wname }), { widgetMove: "up" });
      const down = tool("widget-move", DOWN, f.value.t("widgets.down", { name: wname }), { widgetMove: "down" });
      up.disabled = i === 0; down.disabled = last;
      // folded: its title and first row (figures, a description) only, the charts and tables away (owner, 2026-11-24)
      const folded = sec.parentElement!.classList.contains("folded");
      const fold = tool("widget-fold", folded ? UNFOLD : FOLD, f.value.t(folded ? "widgets.unfold" : "widgets.fold", { name: wname }), { widgetFold: widget });
      fold.setAttribute("aria-expanded", String(!folded));
      if ("fold" in sec.parentElement!.dataset) h2.append(fold); // only the ones with figures over their charts (profile.ts WIDGETS)
      h2.append(up, down, grip, tool("widget-size", wide ? NARROW : WIDEN, f.value.t(wide ? "widgets.half" : "widgets.wide", { name: wname }), { widgetSize: widget }),
        tool("widget-off", CROSS, f.value.t("widgets.remove", { name: wname }), { widgetOff: widget }));
    }
  });
  if (key.value !== "home") relabelStars(key.value, labels);
}

/** A chart that shares its row gets a button by its title that opens it large over the page (styles/zoom.css sizes it);
 * one that has the whole width (every chart on a phone or a small screen) gets none, and loses it when it gets there. */
const chartTitle = (p: HTMLElement) => p.querySelector<HTMLElement>(":scope > h3, :scope > .block-head > h3");
function markZoom(root: HTMLElement) {
  const page = root.clientWidth;
  root.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => {
    const h3 = chartTitle(p);
    if (!h3 || !p.querySelector(".ch-plot, .heat, .hb-row")) return;
    const has = h3.querySelector(".zoom-pin");
    if (p.getBoundingClientRect().width > page * 0.75) return has?.remove();
    if (has) return;
    h3.append(tool("zoom-pin", ZOOM, f.value.t("zoom.open", { name: (h3.firstChild?.textContent || h3.textContent || "").trim() }), { zoom: "" }));
  });
}
/** On a phone a chart's axis column is as wide as its widest number, not the fixed column made for the longest one: the
 * plot keeps that room (it looked like a margin on the left with none on the right). */
function fitAxes(root: HTMLElement) {
  const phone = innerWidth < 600;
  root.querySelectorAll<HTMLElement>(".vchart, .lchart").forEach((fig) => {
    const w = phone ? Math.max(0, ...[...fig.querySelectorAll<HTMLElement>(".ch-y:not(.right) span")].map((s) => s.offsetWidth)) : 0;
    if (w) fig.style.setProperty("--c-chart-axis-width", `${w + 8}px`); else fig.style.removeProperty("--c-chart-axis-width");
  });
}
/** A chart's month (or level) names never touch: from the last one, which always stays, one that runs into the next one
 * kept is hidden (narrow charts, a long last name at the edge). */
function fitTicks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".ch-x").forEach((axis) => {
    const names = [...axis.children].filter((s) => s.textContent) as HTMLElement[];
    names.forEach((s) => (s.style.visibility = ""));
    let left = Infinity;
    for (const s of names.reverse()) {
      if (getComputedStyle(s).visibility === "hidden" || !s.offsetWidth) continue;
      const r = (s.firstChild ? (() => { const g = document.createRange(); g.selectNodeContents(s); return g.getBoundingClientRect(); })() : s.getBoundingClientRect());
      if (r.right > left - 4 || r.left < axis.parentElement!.getBoundingClientRect().left) s.style.visibility = "hidden"; else left = r.left; // nor out of the chart's left
    }
  });
}
/** On a phone a section's title stays on one line, its buttons beside it: the type shrinks until it fits, never under
 * 70% of its size nor 18px (owner, 2026-11-24: smaller read badly beside the buttons); one that long wraps, its ⓘ and
 * buttons on its first line. */
function fitTitles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("section[id] > h2, section[id] > .panel-head > h2").forEach((h2) => {
    h2.style.fontSize = "";
    h2.classList.toggle("fit", innerWidth < 600);
    if (innerWidth >= 600) return;
    const over = () => h2.scrollWidth > h2.clientWidth || h2.offsetWidth > h2.parentElement!.clientWidth;
    let size = parseFloat(getComputedStyle(h2).fontSize);
    const floor = Math.max(18, Math.round(size * 0.7));
    while (over() && size > floor) h2.style.fontSize = `${--size}px`;
    if (over()) { h2.style.fontSize = ""; h2.classList.remove("fit"); }
  });
}
/** Your name and the line under it (your title and campus) keep to one line at every width: when one doesn't fit, what
 * follows it (OuterCore, the campus) goes first, then its type shrinks until it fits, with no floor (owner, 2026-11-20). */
function fitCard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".pf-name, .pf-who").forEach((el) => {
    el.style.fontSize = "";
    el.classList.remove("cut");
    const over = () => el.scrollWidth > el.clientWidth + 1;
    if (!over()) return;
    el.classList.add("cut");
    if (!over()) return;
    let size = Math.floor((parseFloat(getComputedStyle(el).fontSize) * el.clientWidth) / el.scrollWidth); // near it at once, then a pixel at a time
    el.style.fontSize = `${size}px`;
    while (over() && size > 6) el.style.fontSize = `${--size}px`;
  });
}
/** The card's tags on one line; the ones that don't fit go, from the last, behind "+N" at its end, which opens them in
 * the float (its panel lists only those). */
function fitTags(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".pf-tags").forEach((row) => {
    const tags = [...row.querySelectorAll<HTMLElement>(":scope > .tag")], more = row.querySelector<HTMLDetailsElement>(":scope > .tag-more");
    if (!more) return;
    tags.forEach((t) => (t.style.display = ""));
    more.hidden = true;
    const over = () => row.scrollWidth > row.clientWidth + 1;
    if (!over()) return;
    more.hidden = false;
    let n = tags.length;
    do { tags[--n].style.display = "none"; more.querySelector("summary")!.textContent = `+${tags.length - n}`; } while (n > 1 && over());
    more.querySelectorAll<HTMLElement>(".pop-panel .tag").forEach((c, i) => (c.style.display = i < n ? "none" : ""));
  });
}
/** A list kept to one line (people.ts oneLineList): when the whole of it overflows its line, its first and "+N more". */
function fitLists(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".fit-list").forEach((list) => {
    list.classList.remove("cut");
    const line = list.querySelector("summary")!;
    list.classList.toggle("cut", line.scrollWidth > line.clientWidth); // a pixel over already clips the last letter
  });
}
/** A filter's chosen option keeps to one line: its type shrinks until it fits, never under 12px ("…" past that). */
function fitSelects(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("form[data-filter] .select-val").forEach((v) => {
    v.style.fontSize = "";
    let size = parseFloat(getComputedStyle(v).fontSize);
    while (v.scrollWidth > v.clientWidth && size > 12) v.style.fontSize = `${--size}px`; // a pixel over already shows "…"
  });
}
/** A chart's key keeps to its title's line or goes: when the title and the key don't fit one line, the key is hidden
 * rather than wrapped under it (owner, 2026-11-22; the tips still name every series, the zoom shows the key again). */
function fitKeys(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".block-head > :is(.legend, .scale)").forEach((key) => {
    key.style.display = "";
    const title = key.parentElement!.firstElementChild as HTMLElement;
    if (title !== key && key.offsetTop > title.offsetTop + title.offsetHeight / 2) key.style.display = "none";
  });
}
/** Two half widgets side by side end on the same line when one of them can give or take: the one whose rows scroll (a
 * table, a list) shows fewer rows (never under 400px of them) or more (up to all it has) to meet the other. A widget
 * with nothing that scrolls keeps its own height: beside a longer one it ends higher (nothing honest to fill it with). */
function evenRows(root: HTMLElement) {
  const halves = [...root.querySelectorAll<HTMLElement>(".widgets > .widget.half")];
  const scroller = (w: HTMLElement) => [...w.querySelectorAll<HTMLElement>(".table-wrap, .list")].filter((s) => !s.closest("details:not([open])"))
    .sort((a, b) => b.clientHeight - a.clientHeight)[0] as HTMLElement | undefined;
  halves.forEach((w) => { const s = scroller(w); if (s) s.style.maxHeight = ""; });
  if (innerWidth < 960) return;
  const rows = new Map<number, HTMLElement[]>();
  halves.forEach((w) => rows.set(w.offsetTop, [...(rows.get(w.offsetTop) || []), w]));
  for (const pair of rows.values()) {
    if (pair.length !== 2) continue;
    // each one's height as it is, the least it can take (400px of rows, or its rows when fewer) and the most (every row)
    const m = pair.map((w) => { const s = scroller(w), h = w.offsetHeight, sh = s?.clientHeight || 0;
      return { w, s, h, sh, lo: s ? h - sh + Math.min(400, sh) : h, hi: s ? h - sh + s.scrollHeight : h }; });
    if (m[0].h === m[1].h || !m.some((x) => x.s)) continue;
    // only one gives or takes: it goes to the other's height, as far as its rows allow; both: the shorter one's
    const lo = Math.max(m[0].lo, m[1].lo), hi = Math.min(m[0].hi, m[1].hi), fixed = m.find((x) => !x.s);
    const target = Math.max(lo, Math.min(fixed ? fixed.h : Math.min(m[0].h, m[1].h), hi));
    for (const x of m) {
      if (!x.s || x.h === target) continue;
      const fit = (room: number) => Math.min(Math.max(room, Math.min(400, x.sh)), x.s!.scrollHeight);
      x.s.style.maxHeight = `${fit(x.sh + target - x.h)}px`;
      const off = x.w.offsetHeight - target; // what the change itself moved (a scrollbar, a wrapped foot): once more
      if (off) x.s.style.maxHeight = `${fit(x.s.clientHeight - off)}px`;
    }
  }
}
/** The timeline's names, once drawn: each goes above or below the line (taking turns) where it touches no other name,
 * or one row further out when neither side has room (phones list the stops instead). */
function placeMarks(root: HTMLElement) {
  if (innerWidth < 720) return;
  root.querySelectorAll<HTMLElement>(".pf-time").forEach((tl) => {
    const marks = [...tl.querySelectorAll<HTMLElement>(".pf-mark")];
    const taken: Record<string, [number, number][][]> = { up: [[], []], down: [[], []] };
    marks.forEach((m, i) => {
      m.classList.remove("far");
      const r = m.getBoundingClientRect(), a = r.left - 10, b = r.right + 10;
      for (const lvl of [0, 1]) for (const side of i % 2 ? ["down", "up"] : ["up", "down"]) {
        if (taken[side][lvl].some(([x, y]) => a < y && x < b)) continue;
        m.classList.toggle("up", side === "up");
        m.classList.toggle("down", side === "down");
        m.classList.toggle("far", lvl === 1);
        taken[side][lvl].push([a, b]);
        return;
      }
    });
    tl.classList.toggle("far-up", marks.some((m) => m.matches(".far.up")));
    tl.classList.toggle("far-down", marks.some((m) => m.matches(".far.down")));
  });
}
let zoomResize = 0;
const onResize = () => { cancelAnimationFrame(zoomResize); zoomResize = requestAnimationFrame(() => { fitPreview(); if (main.value) { markZoom(main.value); placeMarks(main.value); fitAxes(main.value); fitTicks(main.value); fitTitles(main.value); fitCard(main.value); fitTags(main.value); fitKeys(main.value); fitLists(main.value); fitSelects(main.value); evenRows(main.value); } }); };
window.addEventListener("resize", onResize);
document.fonts?.ready.then(onResize); // the display type changes every width the fits measured before it came
onBeforeUnmount(() => window.removeEventListener("resize", onResize));

const zoom = ref<HTMLDialogElement | null>(null);
const zoomTitle = ref(""), zoomHtml = ref("");
let tipHome: [Node, Node | null] | null = null;
function openZoom(panel: HTMLElement) {
  const copy = panel.cloneNode(true) as HTMLElement, h3 = chartTitle(copy)!;
  copy.querySelectorAll<HTMLElement>("[data-anim]").forEach((e) => { delete e.dataset.anim; e.classList.add("in"); }); // drawn, also what the page never showed
  copy.querySelectorAll<HTMLElement>(".block-head > :is(.legend, .scale)").forEach((k) => (k.style.display = "")); // a key hidden for want of room shows here
  h3.querySelectorAll(".pin").forEach((b) => b.remove());
  zoomTitle.value = h3.innerHTML; // the page's own markup, already escaped
  h3.remove();
  zoomHtml.value = copy.innerHTML;
  hideTip();
  zoom.value!.showModal();
  nextTick(() => zoom.value && fitTicks(zoom.value)); // wider in the dialog: the names the page hid may fit
  // the dialog sits on the top layer, over the page's tooltip: the tooltip moves in while it is open
  const tip = document.getElementById("tip");
  if (tip) { tipHome = [tip.parentNode!, tip.nextSibling]; zoom.value!.append(tip); }
}
function zoomClosed() {
  hideTip();
  const tip = document.getElementById("tip");
  if (tip && tipHome) tipHome[0].insertBefore(tip, tipHome[1]);
  tipHome = null;
}

function onClick(ev: MouseEvent) {
  const el = ev.target as Element;
  const star = el.closest?.("[data-pin]") as HTMLElement | null;
  if (star) {
    const [page, id] = star.dataset.pin!.split(":");
    togglePin("stars", { page, id, label: star.dataset.label || id });
    const on = hasPin("stars", page, id), name = star.dataset.label || id;
    star.setAttribute("aria-pressed", String(on));
    star.setAttribute("aria-label", f.value.t(on ? "pin.unstar" : "pin.star", { name }));
    star.title = star.getAttribute("aria-label")!;
    return;
  }
  const zoomBtn = el.closest?.("[data-zoom]") as HTMLElement | null;
  if (zoomBtn) return openZoom(zoomBtn.closest<HTMLElement>("[data-panel]")!);
  const size = el.closest?.("[data-widget-size]") as HTMLElement | null;
  if (size) {
    const [page, id] = size.dataset.widgetSize!.split(":");
    refocus = "";
    return setWidget(page, id, { wide: !size.closest(".widget")!.classList.contains("wide") });
  }
  const fold = el.closest?.("[data-widget-fold]") as HTMLElement | null;
  if (fold) {
    const [page, id] = fold.dataset.widgetFold!.split(":");
    refocus = "";
    return setWidget(page, id, { folded: !fold.closest(".widget")!.classList.contains("folded") });
  }
  const move = el.closest?.("[data-widget-move]") as HTMLElement | null;
  if (move) {
    const w = move.closest<HTMLElement>(".widget")!, i = +w.dataset.i!;
    refocus = "";
    moveWidget(i, move.dataset.widgetMove === "up" ? i - 1 : i + 2);
    return nextTick(() => main.value?.querySelector(`[data-widget="${w.dataset.widget}"]`)?.scrollIntoView({ block: "start" }));
  }
  const off = el.closest?.("[data-widget-off]") as HTMLElement | null;
  if (off) {
    const [page, id] = off.dataset.widgetOff!.split(":");
    return togglePin("widgets", { page, id, label: "" });
  }
  if (el.closest?.("[data-widget-add]")) {
    const pick = main.value?.querySelector<HTMLSelectElement>("#widgets select")?.value || "";
    const [page, id] = pick.split(":");
    if (page && id && !hasPin("widgets", page, id)) togglePin("widgets", { page, id, label: "" });
    else return;
    anchored = "";
    router.replace({ query: route.query, hash: `#${id}` });
    return;
  }
  const btn = el.closest?.("[data-preview], [data-download]") as HTMLElement | null;
  if (btn) return exportCsv(btn);
  const a = el.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.target || a.hasAttribute("download")) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith("/app")) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // an anchor on this page
  ev.preventDefault();
  closePops();
  router.push(u.pathname + u.search + (a.hasAttribute("data-keep") ? "" : u.hash));
}

// widgets on Profile: drag a handle onto another widget (before or after it, in the left or right column), or move
// it with the arrow keys on its handle (up and down: the order; left and right: the column of a half widget)
let dragFrom = -1;
// while dragging the page follows the pointer to the band and the window's bottom, so a widget reaches any other
let dragY = -1, following = 0;
const trackDrag = (ev: DragEvent) => { dragY = ev.clientY; };
const dragLeft = (ev: DragEvent) => { if (!ev.relatedTarget) dragY = -1; };
function followDrag() {
  window.scrollBy(0, dragScroll(dragY, document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0, window.innerHeight));
  following = requestAnimationFrame(followDrag);
}
function startFollowing() {
  document.addEventListener("dragover", trackDrag);
  document.addEventListener("dragleave", dragLeft);
  following = requestAnimationFrame(followDrag);
}
function stopFollowing() {
  document.removeEventListener("dragover", trackDrag);
  document.removeEventListener("dragleave", dragLeft);
  cancelAnimationFrame(following);
  dragY = -1;
}
function widgetAt(ev: DragEvent) {
  const grid = main.value?.querySelector<HTMLElement>(".widgets");
  if (!grid || dragFrom < 0) return null;
  const all = [...grid.querySelectorAll<HTMLElement>(":scope > .widget")];
  const two = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length > 1;
  const gr = grid.getBoundingClientRect();
  const side: "left" | "right" | null = two ? (ev.clientX < gr.left + gr.width / 2 ? "left" : "right") : null;
  // the widget under the pointer, else the nearest one
  const dist = (w: HTMLElement) => { const r = w.getBoundingClientRect(); return Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom)); };
  const over = all.reduce<HTMLElement | null>((a, w) => (!a || dist(w) < dist(a) ? w : a), null);
  if (!over) return null;
  const r = over.getBoundingClientRect(), i = +over.dataset.i!;
  const across = two && over.classList.contains("half");
  const after = across ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  // beside a half widget it lands on the side it was dropped on; above or below one, in the column under the pointer
  return { over, to: after ? i + 1 : i, side: across ? (after ? "right" : "left") as "left" | "right" : side, mark: across ? (after ? "right" : "left") : after ? "after" : "before" };
}
const clearDrop = () => main.value?.querySelectorAll("[data-drop]").forEach((w) => w.removeAttribute("data-drop"));
function onDragStart(ev: DragEvent) {
  const w = (ev.target as Element).closest?.("[data-widget-grip]")?.closest(".widget") as HTMLElement | null;
  if (!w || !ev.dataTransfer) return;
  dragFrom = +w.dataset.i!;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", w.dataset.widget!);
  ev.dataTransfer.setDragImage(w.querySelector("h2") || w, 24, 24); // its title: a tall widget's image would hide where it lands
  hideTip();
  w.classList.add("dragging");
  startFollowing();
}
function onDragOver(ev: DragEvent) {
  const t = widgetAt(ev);
  if (!t) return;
  ev.preventDefault();
  if (t.over.dataset.drop !== t.mark) { clearDrop(); t.over.dataset.drop = t.mark; }
}
function onDrop(ev: DragEvent) {
  const t = widgetAt(ev);
  clearDrop();
  stopFollowing(); // the drop redraws the page: dragend may never reach the handle
  if (!t) return;
  ev.preventDefault();
  const moved = pins.widgets[dragFrom];
  const half = main.value?.querySelector(`[data-widget="${moved.page}:${moved.id}"]`)?.classList.contains("half");
  moveWidget(dragFrom, t.to);
  if (half && t.side) setWidget(moved.page, moved.id, { side: t.side });
  dragFrom = -1;
}
function onDragEnd() {
  dragFrom = -1;
  stopFollowing();
  clearDrop();
  main.value?.querySelectorAll(".widget.dragging").forEach((w) => w.classList.remove("dragging"));
}
function onKey(ev: KeyboardEvent) {
  const w = (ev.target as Element).closest?.("[data-widget-grip]")?.closest(".widget") as HTMLElement | null;
  if (!w) return;
  const i = +w.dataset.i!, [page, id] = w.dataset.widget!.split(":");
  if (ev.key === "ArrowUp") moveWidget(i, i - 1);
  else if (ev.key === "ArrowDown") moveWidget(i, i + 2);
  else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && w.classList.contains("half")) setWidget(page, id, { side: ev.key === "ArrowLeft" ? "left" : "right" });
  else return;
  ev.preventDefault();
  refocus = w.dataset.widget!;
}

let typing = 0;
function onInput(ev: Event) {
  const form = (ev.target as Element).closest?.("form[data-filter]") as HTMLFormElement | null;
  if (!form) return;
  clearTimeout(typing);
  const t = ev.target as HTMLInputElement;
  typingIn = { form: form.dataset.filter || "", name: t.name, start: t.type === "search" ? t.selectionStart : null, end: t.type === "search" ? t.selectionEnd : null };
  const apply = () => {
    const q: Record<string, string> = { ...params.value };
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      if (el.type === "checkbox") { if (el.checked) q[el.name] = el.value; else delete q[el.name]; }
      else if (el.type === "radio") { if (el.checked) q[el.name] = el.value; }
      else if (el.value) q[el.name] = el.value; else delete q[el.name];
    }
    router.replace({ query: q, hash: route.hash });
  };
  if ((ev.target as HTMLInputElement).type === "search") typing = window.setTimeout(apply, 300); else apply();
}

const preview = ref<HTMLDialogElement | null>(null);
const previewTitle = ref(""), previewHtml = ref("");
function exportCsv(btn: HTMLElement) {
  if (!pg.value) return;
  const kind = btn.dataset.preview || btn.dataset.download;
  const text = kind === "portfolio" ? portfolioCsv(pg.value) : projectsCsv(pg.value);
  if (btn.dataset.download) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), download: `projects-${pg.value.period}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const [head = [], ...rows] = parseCsv(text);
  previewTitle.value = btn.dataset.title || "";
  const f = fmt.value, AREAS = 2; // portfolioCsv's third column
  // one area by name; several as the first and "+N more", the list in a panel that opens (as a team in the evaluation log)
  const areasCell = (v: string) => {
    const names = v.split(", ").filter(Boolean); // portfolioCsv names them
    if (names.length < 2) return esc(names[0] || "");
    return `<details class="pop who-pop" data-float><summary>${esc(names[0])} <span class="more">${esc(f.t("common.plus_more", { n: names.length - 1 }))}</span></summary>`
      + `<div class="pop-panel"><b>${esc(head[AREAS] || "")}</b><ul>${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div></details>`;
  };
  const cell = (v: string, i: number) => (kind === "portfolio" && i === AREAS ? areasCell(v) : esc(v));
  previewHtml.value = `<table aria-label="${esc(previewTitle.value)}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td>${cell(v, i)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  hideTip(); closePops();
  preview.value?.showModal();
  nextTick(fitPreview);
}
/** The preview's rows on one line each: from 600px the table shrinks (text, columns and rows) until it fits the dialog's
 * width; phones keep it at its size and scroll it both ways (owner, 2026-11-19). */
function fitPreview() {
  const wrap = preview.value?.open ? preview.value.querySelector<HTMLElement>(".table-wrap") : null, table = wrap?.querySelector("table");
  if (!wrap || !table) return;
  table.style.zoom = "";
  if (innerWidth < 600) return;
  const z = wrap.clientWidth / table.offsetWidth;
  if (z < 1) table.style.zoom = String(Math.floor(z * 1000) / 1000);
}

const periods = computed(() => (view.value && view.value.periods.length > 1 && !onCampus(key.value) ? view.value.periods : [])); // the campus has no period of yours
const periodHref = (p: string) => router.resolve({ query: { ...params.value, period: p } }).fullPath;
// Coalition keeps to the student period: its switch shows it and changes nothing, the chosen period waits in the address;
// whoever had a Piscine coalition picks it there (coalitionMode)
const locked = computed(() => pagePeriod(key.value, "") !== "" && !view.value?.report?.piscine_coalition);
const pressedPeriod = computed(() => (key.value === "coalition" && !locked.value ? params.value.period || view.value?.default_period : view.value?.period));
// the period the settings' dot shows is the one this page is drawn for (Coalition: the student one); the chosen one waits in
// the address and comes back on the next page
const shownPeriod = computed(() => key.value === "coalition"
  ? coalitionMode(params.value.period || view.value?.default_period || "all", !!view.value?.report?.piscine_coalition, params.value.coal || "student")
  : pagePeriod(key.value, params.value.period || view.value?.period || ""));
</script>

<template>
  <AppHeader :page="key" :period="shownPeriod" :periods="periods" @refreshed="watchSync" />
  <main v-if="screen === 'page'" id="main" ref="main" :data-page="`web-${key}`" :class="{ 'holy-full': key === 'holygraph' }" @click="onClick" @input="onInput" @change="onInput" @submit.prevent
    @keydown="onKey" @dragstart="onDragStart" @dragover="onDragOver" @drop="onDrop" @dragend="onDragEnd">
    <h1 v-if="key === 'holygraph'" class="visually-hidden">{{ title }}</h1>
    <header v-else class="page-head">
      <h1>{{ title }}</h1>
      <nav v-if="periods.length" class="seg periods" :aria-label="f.t('rail.period')">
        <a v-for="p in periods" :key="p" :href="locked ? undefined : periodHref(p)" data-keep role="button" :aria-pressed="p === pressedPeriod"
          :aria-disabled="locked && p !== view?.period ? 'true' : undefined" :title="locked ? f.t('period.student_only') : undefined">{{ f.t(`period.${p}`) }}</a>
      </nav>
      <p v-else-if="key === 'home' && state.status?.last" class="periods only">{{ f.t("today.as_of", { time: f.stamp(new Date(state.status.last).getTime()) }) }}</p>
    </header>
    <nav v-if="onCampus(key)" class="campus-tabs" :aria-label="f.t('campus.tabs')">
      <RouterLink v-for="k in CAMPUS_TABS" :key="k" :to="PATHS[k]" :aria-current="k === key ? 'page' : undefined">{{ tabLabel(k) }}</RouterLink>
    </nav>
    <nav v-if="toc.length > 1 && key !== 'holygraph'" class="toc" :aria-label="f.t('rail.sections')"><a v-for="s in toc" :key="s.id" :href="`#${s.id}`">{{ s.nav }}</a></nav>
    <div v-for="s in sections" :key="s.id + key" class="sec" v-html="s.html"></div>
    <footer v-if="key !== 'holygraph'" class="site-foot">
      <SiteCredit />
      <nav class="foot-links"><RouterLink to="/about">{{ f.t("site.about") }}</RouterLink><RouterLink to="/privacy">{{ f.t("site.privacy") }}</RouterLink>
        <a v-if="state.session?.issues_url" :href="state.session.issues_url" rel="noopener" target="_blank">{{ f.t("site.issues") }}</a></nav>
      <p class="foot-note">{{ f.t(view?.light && !view?.seat_days ? "footer.light" : "footer.full", { when: f.dayTime(view?.report.generated) }) }}</p>
    </footer>
  </main>
  <main v-else-if="screen === 'consent'" id="main" class="solo">
    <div class="boot-panel">
      <h2>{{ f.t("consent.title") }}</h2>
      <p>{{ f.t("consent.lede", { version: state.session?.consent_version ?? "" }) }}</p>
      <form class="signin" @submit.prevent="consentOk && accept()">
        <label class="consent"><input v-model="consentOk" type="checkbox" required />
          <span>{{ f.t("site.accept").split("{privacy}")[0] }}<RouterLink to="/privacy" target="_blank">{{ f.t("site.accept_link") }}</RouterLink>{{ f.t("site.accept").split("{privacy}")[1] }}</span></label>
        <p class="row-btns"><button class="btn primary" type="submit" :disabled="!consentOk">{{ f.t("consent.continue") }}</button></p>
      </form>
    </div>
  </main>
  <!-- loading, a copy coming back from this browser or the first extraction: on Profile your card, the rest in grey -->
  <main v-else id="main" class="skel" :data-page="`web-${key}`" :aria-busy="screen !== 'boot' || state.status?.state !== 'failed'">
    <header class="page-head"><h1>{{ title }}</h1>
      <p v-if="screen !== 'boot'" class="visually-hidden" role="status">{{ f.t("boot.title") }}</p>
      <p v-else-if="state.status?.state === 'failed'" class="periods only" role="status"><b>{{ f.t("boot.failed") }}</b><br />
        <button class="btn primary" type="button" @click="retry">{{ f.t("boot.retry") }}</button></p>
      <p v-else-if="state.status && state.status.next_refresh_in > 0 && ['none', 'done'].includes(state.status.state)" class="periods only" role="status">
        <b>{{ state.status.next_refresh_in < 60 ? f.t("refresh.wait_s", { count: state.status.next_refresh_in }) : f.t("refresh.wait", { count: Math.ceil(state.status.next_refresh_in / 60) }) }}</b> {{ f.t("boot.wait_note") }}</p>
      <p v-else class="periods only" role="status"><b>{{ f.t(state.status?.message || `status.${state.status?.state || 'queued'}`) }}</b> {{ f.t("boot.first") }}</p>
    </header>
    <section v-if="me && key === 'home'" id="profile" class="pf" :aria-label="f.t('profile.title')">
      <div class="pf-head"><div class="avatar-lg pf-photo"><span aria-hidden="true">{{ initials(me.name || me.login) }}</span>
        <img v-if="me.has_image" :src="'/avatar/me'" alt="" @error="($event.target as HTMLElement).remove()" /></div>
        <div class="pf-id"><p class="pf-name">{{ me.name || me.login }}</p><p class="pf-sub"><span>{{ me.login }}</span></p></div></div>
      <div class="modules pf-modules" aria-hidden="true"><article v-for="n in 4" :key="n" class="module"><h3 class="tab"><i class="sk"></i></h3><p class="figure"><i class="sk"></i></p></article></div>
    </section>
    <section class="modules-wrap" aria-hidden="true"><div class="modules">
      <article v-for="n in 3" :key="n" class="module"><h3 class="tab"><i class="sk"></i></h3><p class="figure"><i class="sk"></i></p><i class="sk"></i><i class="sk"></i></article>
    </div></section>
  </main>
  <div id="tip" role="tooltip"></div>
  <Teleport to="#dialogs">
    <dialog ref="preview" class="preview" aria-labelledby="preview-title" @click="($event.target as Element) === preview && preview?.close()">
      <div class="preview-head"><h2 id="preview-title">{{ previewTitle }}</h2><button class="btn secondary" type="button" @click="preview?.close()">{{ f.t("landing.close") }}</button></div>
      <div class="table-wrap tall" v-html="previewHtml"></div>
    </dialog>
    <dialog ref="zoom" class="zoom" aria-labelledby="zoom-title" @click="($event.target as Element) === zoom && zoom?.close()" @close="zoomClosed">
      <div class="zoom-box">
        <div class="zoom-head"><h2 id="zoom-title" v-html="zoomTitle"></h2><button class="btn secondary" type="button" @click="zoom?.close()">{{ f.t("landing.close") }}</button></div>
        <div class="zoom-body" v-html="zoomHtml"></div>
      </div>
    </dialog>
  </Teleport>
</template>
