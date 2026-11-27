<script setup lang="ts">
// A snake to pass the time on the maintenance notice: arrows or WASD, or a swipe; Space or a tap on the board pauses, the
// one button on it starts and resumes. Colours from ui.json (read off the page), the best score kept for this visit only.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { fmt } from "../state";
import { type Dir, start, step, turn } from "../lib/snake";

const f = computed(() => fmt.value);
const canvas = ref<HTMLCanvasElement | null>(null);
const game = shallowRef(start());
const running = ref(false), best = ref(0);
let timer = 0;

function draw() {
  const c = canvas.value, s = game.value;
  if (!c) return;
  const ctx = c.getContext("2d")!, css = getComputedStyle(c), cell = c.width / s.size;
  const v = (n: string) => css.getPropertyValue(n).trim();
  ctx.fillStyle = v("--seat-empty"); ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = v("--critical"); ctx.fillRect(s.food[0] * cell + cell * 0.2, s.food[1] * cell + cell * 0.2, cell * 0.6, cell * 0.6);
  s.body.forEach(([x, y], i) => { ctx.fillStyle = i ? v("--accent-data") : v("--ink"); ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); });
}
function tick() {
  game.value = step(game.value);
  best.value = Math.max(best.value, game.value.score);
  draw();
  if (game.value.over) stop();
}
function play() {
  if (game.value.over) game.value = start();
  running.value = true;
  clearInterval(timer);
  timer = window.setInterval(tick, Math.max(70, 130 - game.value.score * 3));
  canvas.value?.focus();
}
function stop() { running.value = false; clearInterval(timer); }
function go(d: Dir) { game.value = turn(game.value, d); if (!running.value) play(); }
const KEYS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
function key(e: KeyboardEvent) {
  if (e.key === " ") { e.preventDefault(); return running.value ? stop() : play(); }
  const d = KEYS[e.key];
  if (d) { e.preventDefault(); go(d); }
}
let touch: [number, number] | null = null;
function down(e: PointerEvent) { touch = [e.clientX, e.clientY]; }
function up(e: PointerEvent) {
  if (!touch) return;
  const dx = e.clientX - touch[0], dy = e.clientY - touch[1];
  touch = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return running.value ? stop() : play();
  go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
}
onMounted(() => { draw(); document.addEventListener("visibilitychange", () => document.hidden && stop()); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="snake" :aria-label="f.t('maint.game')">
    <p class="snake-head"><b>{{ f.t("maint.game") }}</b><span>{{ f.t("maint.score", { n: game.score, best }) }}</span></p>
    <div class="snake-board">
      <canvas ref="canvas" width="432" height="432" tabindex="0" role="img" :aria-label="f.t('maint.score', { n: game.score, best })"
        @keydown="key" @pointerdown="down" @pointerup="up"></canvas>
      <div v-if="!running" class="snake-start">
        <p v-if="game.over" class="snake-over" role="status">{{ f.t("maint.over", { n: game.score }) }}</p>
        <button class="snake-go" type="button" @click="play">{{ game.over ? f.t("maint.again") : game.score || game.body.length > 3 ? f.t("maint.resume") : f.t("maint.play") }}</button>
      </div>
    </div>
    <p class="snake-how">{{ f.t("maint.how") }}</p>
  </section>
</template>
