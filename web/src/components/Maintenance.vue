<script setup lang="ts">
// The notice shown while Monday's campus count runs (the server closes the site to all but the owner): when it should end,
// why, and the page comes back by itself. In make dev the owner can show it on request (DevLive.vue).
import { computed, onBeforeUnmount, onMounted } from "vue";
import { fmt, loadSession, setLang, state } from "../state";
import { MAINT_SIM } from "../maintenance";
import SnakeGame from "./SnakeGame.vue";

const f = computed(() => fmt.value);
const sim = import.meta.env.DEV && !!sessionStorage.getItem(MAINT_SIM);
const until = computed(() => state.session?.maintenance?.until || (sim ? new Date(Date.now() + 85 * 60_000).toISOString() : ""));
const time = computed(() => {
  const t = Date.parse(until.value);
  return Number.isFinite(t) ? new Intl.DateTimeFormat(f.value.lang === "es" ? "es-ES" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(t) : "";
});
let timer = 0;
onMounted(() => {
  document.title = `${f.value.t("maint.title")} · ${f.value.t("site.name")}`;
  if (sim) return;
  timer = window.setInterval(async () => { const s = await loadSession().catch(() => null); if (s && !s.maintenance) location.reload(); }, 60_000);
});
onBeforeUnmount(() => clearInterval(timer));
function leave() { sessionStorage.removeItem(MAINT_SIM); location.reload(); }
</script>

<template>
  <div class="maint" role="status">
    <div class="maint-band"><div class="maint-lang" role="group" :aria-label="f.t('settings.language')">
      <button type="button" :aria-pressed="f.lang === 'en'" @click="setLang('en')">EN</button><button type="button" :aria-pressed="f.lang === 'es'" @click="setLang('es')">ES</button>
    </div></div>
    <main class="maint-main">
      <p class="maint-brand">{{ f.t("site.name") }}</p>
      <h1>{{ f.t("maint.title") }}</h1>
      <div class="maint-cols">
        <div class="maint-text">
          <p class="maint-lead">{{ f.t("maint.body") }}</p>
          <p v-if="time" class="maint-until">{{ f.t("maint.until", { time }) }}</p>
          <p class="maint-auto">{{ f.t("maint.auto") }}</p>
          <button v-if="sim" class="btn secondary" type="button" @click="leave">{{ f.t("maint.sim_leave") }}</button>
        </div>
        <SnakeGame />
      </div>
    </main>
  </div>
</template>
