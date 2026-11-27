import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../server/internal/web/dist", import.meta.url));
// where the dev server sends API calls: a local go run, or the running make dev (API=https://localhost, make dev-live)
const go = process.env.API || "http://localhost:8000";

// make dev-live: /ui.css made here from ui.json and colors.json (the Go server embeds them, so a colour changed there would
// wait for make dev-build), made again whenever either is saved; the open page swaps its stylesheet at once (main.ts)
function liveUiCss(): Plugin {
  const server = fileURLToPath(new URL("../server", import.meta.url)), data = `${server}/core/data`;
  let css: Promise<string> | null = null;
  const make = () => (css = new Promise<string>((ok, no) =>
    execFile("go", ["run", "./cmd/uicss"], { cwd: server, maxBuffer: 1 << 24 }, (e, out, err) => (e ? no(new Error(err || e.message)) : ok(out)))));
  return {
    name: "live-ui-css",
    apply: "serve",
    configureServer(dev) {
      dev.watcher.add([`${data}/ui.json`, `${data}/colors.json`]);
      dev.watcher.on("change", (f) => {
        if (!/[\\/](ui|colors)\.json$/.test(f)) return;
        make().then(() => dev.ws.send({ type: "custom", event: "ui-css" }), (e) => dev.config.logger.error(`ui.css not made: ${e.message}`));
      });
      dev.middlewares.use("/ui.css", async (_req, res) => {
        try {
          const body = await (css || make());
          res.setHeader("Content-Type", "text/css");
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        } catch (e) {
          css = null; // a file saved half-written: the next request tries again
          res.statusCode = 500;
          res.end(`/* ui.css not made: ${String(e).replace(/\*\//g, "")} */`);
        }
      });
    },
  };
}

// "offline": a single-file export (one script and one stylesheet, to be inlined into one HTML page)
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    liveUiCss(),
    // the Go binary embeds this folder: it must exist (with this file) even before the first build
    { name: "keep-dist", apply: (_c, env) => env.mode !== "offline", closeBundle: () => writeFileSync(`${out}/.gitkeep`, "") },
  ],
  resolve: { alias: { "@data": fileURLToPath(new URL("../server/core/data", import.meta.url)) } },
  build: mode === "offline"
    ? { outDir: "dist-offline", emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 1e9, rollupOptions: { output: { inlineDynamicImports: true } } }
    : { outDir: out, emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    fs: { allow: [".."] },
    proxy: Object.fromEntries(["/api", "/auth", "/dev", "/avatar", "/healthz"].map((p) => [p, { target: go, changeOrigin: true, secure: false }])),
  },
  test: { environment: "jsdom" },
}));
