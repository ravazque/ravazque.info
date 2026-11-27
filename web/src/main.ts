import { createApp } from "vue";
import "./styles/fonts.css";
import "./styles/controls.css";
import "./styles/report.css";
import "./styles/dash.css";
import "./styles/site.css";
import "./styles/v2.css";
import "./styles/friendly-evaluations.css";
import "./styles/friendly-coalition.css";
import "./styles/friendly-projects.css";
import "./styles/friendly-people.css";
import "./styles/friendly-madrid.css";
import "./styles/spacing.css";
import "./styles/zoom.css";
import "./devsim";
import App from "./App.vue";
import { router } from "./router";
import { install } from "./lib/behave";
import { applyTheme } from "./lib/look";
import { settings } from "./state";

applyTheme(settings.get("theme"));
// shortcut: the browser copy of the report (privacy policy ≤ v5) is gone since v6; remove once those copies are old (2027)
try { indexedDB.deleteDatabase("logbook"); Object.keys(localStorage).filter((k) => k.startsWith("copy:")).forEach((k) => localStorage.removeItem(k)); } catch { /* private mode */ }
install();
createApp(App).use(router).mount("#app");

// make dev-live: ui.json or colors.json saved, the stylesheet comes again (vite.config.ts liveUiCss) in the same place, so
// the rules after it still win; one that fails (a file saved half-written) leaves the last one
if (import.meta.hot) import.meta.hot.on("ui-css", () => {
  const old = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href^="/ui.css"]');
  if (!old) return;
  const next = old.cloneNode() as HTMLLinkElement;
  next.href = `/ui.css?t=${Date.now()}`;
  next.onload = () => old.remove();
  next.onerror = () => next.remove();
  old.after(next);
});
