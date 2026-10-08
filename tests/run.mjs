import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir("tests/.generated", { recursive: true });
await build({
  entryPoints: ["ribbon.ts", "ribbon-order.ts", "settings.ts"],
  outdir: "tests/.generated", bundle: true, platform: "node", format: "cjs",
});
await build({
  entryPoints: ["main.ts"], outfile: "tests/.generated/plugin.cjs",
  bundle: true, platform: "node", format: "cjs",
  plugins: [{ name: "obsidian-test-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: `
      export class Plugin {
        constructor(app) { this.app = app; this.events = []; this.saved = []; }
        async loadData() { return this.data; }
        saveData(data) { this.saved.push(data); return this.write?.(data) ?? Promise.resolve(); }
        addSettingTab(tab) { (this.tabs ??= []).push(tab); }
        registerEvent(ref) { this.events.push(ref); }
      }
      export class PluginSettingTab { constructor(app, plugin) { this.app=app; this.plugin=plugin; } }
      export class Setting {}
      export class Notice {}
      export function setIcon(el, icon) { el.textContent = icon; }
      export function setTooltip(el, title) { el.setAttribute('aria-label', title); }
    ` }));
  } }],
});
const result = spawnSync(process.execPath, ["--test", "tests/ribbon.test.mjs", "tests/ribbon-order.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
