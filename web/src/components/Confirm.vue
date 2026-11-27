<script setup lang="ts">
// Asked before acting: "Delete my data" and the owner's publish to the public site. A page of its own: what happens, what
// goes and what stays (or never leaves), and two clear buttons. In make dev the owner sees it with ?preview=1 (DevLive):
// nothing is deleted or sent.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, fmt, loadSession, state } from "../state";
import { forgetVisit } from "../lib/behave";
import AppHeader from "./AppHeader.vue";

const props = defineProps<{ kind: "delete" | "publish" }>();
const f = computed(() => fmt.value);
const route = useRoute(), router = useRouter();
const result = ref<{ ok: boolean; url?: string; error?: string } | null>(null);
const working = ref(false);
const preview = computed(() => import.meta.env.DEV && route.query.preview === "1" && !!state.session?.user?.owner);
const lists = computed(() => [f.value.raw(`${props.kind}.goes`) as string[] || [], f.value.raw(`${props.kind}.stays`) as string[] || []]);
onMounted(async () => {
  if (!state.session?.user) await loadSession().catch(() => null);
  if (!state.session?.user) return router.replace("/");
  if (props.kind === "publish" && !state.session.user.can_publish && !preview.value) router.replace("/app");
  document.title = `${f.value.t(`${props.kind}.title`)} · ${f.value.t("site.name")}`;
});

async function yes() {
  if (preview.value) { result.value = { ok: false, error: "preview" }; return; }
  working.value = true;
  if (props.kind === "delete") {
    await api("/api/me/delete", { method: "POST" }).catch(() => {});
    // what the policy says: nothing of this site stays in the browser (language, theme, stars, widgets, pages seen)
    forgetVisit();
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode */ }
    location.replace("/"); // a full load: nothing of this account stays in memory
    return;
  }
  try {
    const r = await api<{ url: string }>("/api/me/publish", { method: "POST" });
    result.value = { ok: true, url: r.url };
  } catch (e: any) {
    result.value = { ok: false, error: e.body?.error || "github" };
  }
  working.value = false;
}
</script>

<template>
  <AppHeader nav />
  <main id="main" class="confirm-page">
    <div class="page-head"><h1>{{ f.t(`${kind}.title`) }}</h1></div>
    <p v-if="preview" class="confirm-preview" role="note">{{ f.t("confirm.preview") }}</p>
    <template v-if="result">
      <p class="confirm-lede" role="status">
        <template v-if="result.ok">{{ f.t("publish.done") }} · <a :href="result.url" target="_blank" rel="noopener">{{ f.t("publish.view") }}</a> · <a href="https://ravazque.github.io/ravazque/" target="_blank" rel="noopener">{{ f.t("publish.page") }}</a></template>
        <template v-else>{{ f.t(result.error === "preview" ? "confirm.preview_done" : `publish.error_${result.error}`) }}</template>
      </p>
      <div class="confirm-actions"><RouterLink class="btn secondary" to="/app">{{ f.t("confirm.back") }}</RouterLink></div>
    </template>
    <template v-else>
      <p class="confirm-lede">{{ f.t(`${kind}.confirm`) }}</p>
      <div class="confirm-cols">
        <section v-for="(items, i) in lists" :key="i" class="confirm-list">
          <h2>{{ f.t(`${kind}.${i ? "stays_title" : "goes_title"}`) }}</h2>
          <ul><li v-for="item in items" :key="item">{{ item }}</li></ul>
        </section>
      </div>
      <div class="confirm-actions">
        <button :class="['btn', kind === 'delete' ? 'danger-solid' : 'primary']" type="button" :disabled="working" @click="yes">{{ f.t(`${kind}.yes`) }}</button>
        <RouterLink class="btn secondary" to="/app">{{ f.t(`${kind}.no`) }}</RouterLink>
      </div>
    </template>
  </main>
  <div id="tip" role="tooltip"></div>
</template>
