<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from "vue";
import { useRoute } from "vue-router";
import { loadSession, state } from "./state";
import { MAINT_SIM } from "./maintenance";
const Maintenance = defineAsyncComponent(() => import("./components/Maintenance.vue"));
const route = useRoute();
// the app pages share one dashboard (switching pages keeps the loaded report); every other page stands alone
const key = computed(() => (/^\/app(\/(projects|holygraph|evaluations|coalition|people|campus))?\/?$/.test(route.path) ? "app" : route.path));
// Monday's campus count closes the site to everyone but the owner; the owner sees the notice in make dev on request
const closed = computed(() => (!!state.session?.maintenance && !state.session.user?.owner) || (import.meta.env.DEV && !!sessionStorage.getItem(MAINT_SIM)));
onMounted(() => { if (!state.session) loadSession().catch(() => {}); });
</script>

<template>
  <Maintenance v-if="closed" />
  <RouterView v-else :key="key" />
</template>
