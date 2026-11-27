<script setup lang="ts">
// The owner's operations page: API budget, extractions, the process, who is signed in, and who has signed in (since the
// server started and ever: the visitors list, privacy policy v5).
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { api, fmt, loadSession, state } from "../state";
import { S1, hbars } from "../lib/charts";
import AppHeader from "./AppHeader.vue";

const f = computed(() => fmt.value);
const router = useRouter();
const s = shallowRef<any>(null);
let timer = 0;
async function load() {
  try { s.value = await api("/api/stats"); } catch { return router.replace("/app"); }
  timer = window.setTimeout(load, 10000);
}
onMounted(async () => {
  if (!state.session?.user) await loadSession().catch(() => null);
  if (!state.session?.user?.owner) return router.replace("/app");
  document.title = `${f.value.t("stats.title")} · ${f.value.t("site.name")}`;
  load();
});
onBeforeUnmount(() => clearTimeout(timer));

// the campus count: made here or in make dev, moved to production by the owner (export there, import here: only a count
// is taken, the server checks it holds nothing about anyone)
const campusAt = ref<string>("");
const piscineAt = ref<string>(""); // the Piscine is read again only when it may have changed (2026-11-26)
const imported = ref<string>("");
async function loadCampus() { const r = await api<{ stats: any }>("/api/campus-stats").catch(() => null); campusAt.value = r?.stats?.generated_at || ""; piscineAt.value = r?.stats?.piscine?.generated_at || ""; }
onMounted(loadCampus);
// the holy graph the owner drew in the editor (make dev): imported here in production from the editor's download
const holyCustom = ref(false), holyNote = ref("");
async function loadHoly() { holyCustom.value = !!(await api("/api/holygraph").catch(() => null)); }
onMounted(loadHoly);
async function importHoly(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try { await api("/api/holygraph", { method: "PUT", body: await file.text(), headers: { "Content-Type": "application/json" } }); holyNote.value = f.value.t("stats.holy_imported"); loadHoly(); }
  catch (e: any) { holyNote.value = f.value.t("stats.campus_refused", { why: e?.body?.why || e?.body?.error || "" }); }
}
async function resetHoly() { await api("/api/holygraph", { method: "DELETE" }).catch(() => {}); holyNote.value = f.value.t("stats.holy_reset_done"); loadHoly(); }
async function importCampus(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await api("/api/campus-stats/import", { method: "POST", body: await file.text(), headers: { "Content-Type": "application/json" } });
    imported.value = f.value.t("stats.campus_imported");
    loadCampus();
  } catch (e: any) { imported.value = f.value.t("stats.campus_refused", { why: e?.body?.why || e?.body?.error || "" }); }
}

const dur = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const tiles = computed(() => {
  const x = s.value, F = f.value;
  if (!x) return null;
  const n = x.extractions, hour = x.last_hour.reduce((a: number, b: number) => a + b, 0);
  return {
    api: [[F.t("stats.requests_total"), F.num(x.requests_total)], [F.t("stats.requests_hour"), F.num(hour)]],
    chart: hbars(F, x.last_hour.map((_: number, i: number) => F.t("stats.app", { n: i + 1 })), [[F.t("stats.used"), x.last_hour, S1]], { label: F.t("stats.api_title"), end: (_i, v) => F.num(v), big: true }),
    ext: [[F.t("stats.ext_total"), F.num(n)], [F.t("stats.ext_queued"), F.num(x.queued)],
      [F.t("stats.ext_avg_req"), n ? F.num(Math.round(x.extraction_requests / n)) : "–"],
      [F.t("stats.ext_avg_time"), n ? F.t("stats.secs", { n: F.num(Math.round(x.extraction_seconds / n)) }) : "–"],
      [F.t("stats.failed"), F.num(x.failed)], [F.t("stats.timeouts"), F.num(x.timeouts)], [F.t("stats.denied"), F.num(x.denied)]],
    sys: [[F.t("stats.uptime"), dur(x.uptime_s)], [F.t("stats.memory"), F.num(x.memory_keys)], [F.t("stats.peak"), F.num(x.peak_sessions)]],
    note: `${F.t("stats.started")} ${F.stamp(new Date(x.started).getTime())} · ${F.t("stats.last_publish")} ${x.last_publish ? F.stamp(new Date(x.last_publish).getTime()) : F.t("stats.never")}`,
  };
});
// one row per person signed in: their latest session, and how many they have open (one per browser)
const sessions = computed(() => {
  const by = new Map<string, any>();
  for (const u of s.value?.sessions || []) {
    const had = by.get(u.login);
    by.set(u.login, had ? { ...had, n: had.n + 1, created: Math.max(had.created, u.created) } : { ...u, n: 1 });
  }
  return [...by.values()];
});
const at = (iso: string) => new Date(iso).getTime();
// before: the login came before the record started (VISITORS_SEED): its first sign-in is "before" that date, its last unknown
// until it signs in again
const visitors = computed(() => (s.value?.visitors || []) as { login: string; first: string; last?: string; before?: boolean }[]);
// since the last start (make production), then ever
const lists = computed(() => s.value ? [[f.value.t("stats.visitors_since", { at: f.value.stamp(at(s.value.started)) }), visitors.value.filter((v) => v.last && at(v.last) >= at(s.value.started))],
  [f.value.t("stats.visitors_all"), visitors.value]] as [string, typeof visitors.value][] : []);
const acerezo = (login: string) => `https://acerezo.top/user/${encodeURIComponent(login)}`;
const intra = (login: string) => `https://profile.intra.42.fr/users/${encodeURIComponent(login)}`;
</script>

<template>
  <AppHeader nav />
  <main v-if="tiles" id="main" class="stats-page">
    <div class="page-head"><h1>{{ f.t("stats.title") }}</h1></div>
    <section class="stats-sec"><h2>{{ f.t("stats.api_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.api" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div>
      <div v-html="tiles.chart"></div></section>
    <section class="stats-sec"><h2>{{ f.t("stats.ext_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.ext" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div></section>
    <section class="stats-sec"><h2>{{ f.t("stats.sys_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.sys" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div>
      <p class="note">{{ tiles.note }}</p></section>
    <section class="stats-sec"><h2>{{ f.t("stats.campus_title") }}</h2>
      <p class="note">{{ campusAt ? f.t("stats.campus_at", { date: f.stamp(Date.parse(campusAt)) }) : f.t("stats.campus_none") }}<template v-if="piscineAt && piscineAt !== campusAt"> {{ f.t("stats.campus_piscine_at", { date: f.stamp(Date.parse(piscineAt)) }) }}</template></p>
      <div class="row-links">
        <a v-if="campusAt" class="btn secondary" href="/api/campus-stats/export" download="campus.json">{{ f.t("stats.campus_export") }}</a>
        <label class="btn secondary">{{ f.t("stats.campus_import") }}<input type="file" accept="application/json,.json" class="visually-hidden" @change="importCampus"></label>
      </div>
      <p v-if="imported" class="note" role="status">{{ imported }}</p>
      <p class="note">{{ f.t("stats.campus_how") }}</p></section>
    <section class="stats-sec"><h2>{{ f.t("stats.holy_title") }}</h2>
      <p class="note">{{ f.t(holyCustom ? "stats.holy_custom" : "stats.holy_builtin") }}</p>
      <div class="row-links">
        <label class="btn secondary">{{ f.t("stats.holy_import") }}<input type="file" accept="application/json,.json" class="visually-hidden" @change="importHoly"></label>
        <button v-if="holyCustom" class="btn secondary" type="button" @click="resetHoly">{{ f.t("stats.holy_reset") }}</button>
      </div>
      <p v-if="holyNote" class="note" role="status">{{ holyNote }}</p>
      <p class="note">{{ f.t("stats.holy_how") }}</p></section>
    <section class="stats-sec"><h2>{{ f.t("stats.sessions") }}<span class="count"><span class="sep"> · </span>{{ sessions.length }}</span></h2>
      <div v-if="sessions.length" class="table-wrap"><table class="stat-table">
        <thead><tr><th scope="col">{{ f.t("stats.col_login") }}</th><th scope="col">{{ f.t("stats.col_name") }}</th><th scope="col" class="num">{{ f.t("stats.col_signed_in") }}</th></tr></thead>
        <tbody><tr v-for="u in sessions" :key="u.login"><td><a class="login-link" :href="acerezo(u.login)" target="_blank" rel="noopener noreferrer">{{ u.login }}</a></td>
          <td>{{ u.name }}<span v-if="u.n > 1" class="sub">{{ f.plural(u.n, "stats.n_sessions") }}</span></td><td class="num">{{ f.stamp(u.created * 1000) }}</td></tr></tbody>
      </table></div>
      <p v-else class="note">{{ f.t("stats.no_sessions") }}</p></section>
    <section class="stats-sec"><h2>{{ f.t("stats.visitors_title") }}</h2>
      <div class="stat-visitors">
        <div v-for="[title, list] in lists" :key="title" class="block">
          <h3>{{ title }}<span class="count"><span class="sep"> · </span>{{ list.length }}</span></h3>
          <div v-if="list.length" class="table-wrap"><table class="stat-table">
            <thead><tr><th scope="col">{{ f.t("stats.col_login") }}</th><th scope="col">{{ f.t("stats.col_profiles") }}</th><th scope="col" class="num">{{ f.t("stats.col_first") }}</th><th scope="col" class="num">{{ f.t("stats.col_last") }}</th></tr></thead>
            <tbody><tr v-for="v in list" :key="v.login"><td><b>{{ v.login }}</b></td>
              <td class="links"><a class="login-link" :href="acerezo(v.login)" target="_blank" rel="noopener noreferrer">acerezo.top</a><a class="login-link" :href="intra(v.login)" target="_blank" rel="noopener noreferrer">intra</a></td>
              <td class="num">{{ v.before ? f.t("stats.before", { date: f.day(v.first) }) : f.stamp(at(v.first)) }}</td><td class="num">{{ v.last ? f.stamp(at(v.last)) : "–" }}</td></tr></tbody>
          </table></div>
          <p v-else class="note">{{ f.t("stats.no_visitors") }}</p>
        </div>
      </div></section>
  </main>
  <div id="tip" role="tooltip"></div>
</template>
