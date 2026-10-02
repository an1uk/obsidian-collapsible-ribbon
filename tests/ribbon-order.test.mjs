import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Window } from "happy-dom";
const require = createRequire(import.meta.url);
const { RibbonOrder } = require("./.generated/ribbon-order.js");
const { DEFAULT_SETTINGS, normalizeSettings } = require("./.generated/settings.js");
const Plugin = require("./.generated/plugin.cjs").default;
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));

function fixture(saved = []) {
  const win = new Window();
  win.document.body.innerHTML = '<div class="workspace"><div class="workspace-ribbon mod-left"><div class="side-dock-actions"></div><div class="side-dock-settings"></div></div><div class="workspace-ribbon mod-right"></div></div>';
  const workspace = win.document.querySelector(".workspace");
  const settings = { ...DEFAULT_SETTINGS, ribbonOrder: [...saved] }, patches = [];
  const native = {
    containerEl: workspace.querySelector(".mod-left"), ribbonItemsEl: workspace.querySelector(".side-dock-actions"),
    items: [], notifications: [],
    onChange(save) {
      this.notifications.push(save);
      const buttons = this.items.filter(item => item.buttonEl).map(item => {
        item.buttonEl.style.display = item.hidden ? "none" : "";
        return item.buttonEl;
      });
      this.ribbonItemsEl.replaceChildren(...buttons);
    },
  };
  const order = new RibbonOrder(workspace, () => native, () => settings, (patch) => {
    patches.push(patch); Object.assign(settings, patch);
  });
  const add = (id, hidden = false) => {
    let item = native.items.find(item => item.id === id);
    if (!item) { item = { id, hidden }; native.items.push(item); }
    item.buttonEl = win.document.createElement("div");
    item.buttonEl.className = "side-dock-ribbon-action clickable-icon";
    item.buttonEl.setAttribute("aria-label", id);
    item.buttonEl.innerHTML = "<svg></svg>";
    native.onChange(false);
    return item;
  };
  const remove = (id) => { const item = native.items.find(item => item.id === id); delete item.buttonEl; native.onChange(false); };
  const ids = () => Array.from(native.ribbonItemsEl.children, el => el.getAttribute("aria-label"));
  const down = (item) => item.buttonEl.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  const up = () => win.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, button: 0 }));
  const close = async () => { order.destroy(); await win.happyDOM.close(); };
  return { win, workspace, native, settings, patches, order, add, remove, ids, down, up, close };
}

test("late startup icons restore saved positions without replacing nodes, handlers or hidden flags", async () => {
  const f = fixture(["late:first", "core:a", "late:middle", "core:b"]);
  const a = f.add("core:a"), b = f.add("core:b", true);
  const array = f.native.items, right = f.workspace.querySelector(".mod-right").outerHTML;
  f.order.refresh();
  const middle = f.add("late:middle"), first = f.add("late:first");
  let clicks = 0; middle.buttonEl.addEventListener("click", () => clicks++);
  const nodes = [first.buttonEl, a.buttonEl, middle.buttonEl, b.buttonEl];
  await delay();
  assert.deepEqual(f.ids(), ["late:first", "core:a", "late:middle", "core:b"]);
  assert.deepEqual(Array.from(f.native.ribbonItemsEl.children), nodes);
  assert.equal(f.native.items, array);
  assert.equal(b.hidden, true); assert.equal(b.buttonEl.style.display, "none");
  middle.buttonEl.click(); assert.equal(clicks, 1);
  assert.equal(f.workspace.querySelector(".mod-right").outerHTML, right);
  assert.deepEqual(f.patches, []);
  assert.ok(f.native.notifications.every(save => save === false));
  await f.close();
});

test("native mouse drag stays free during movement and captures the committed internal order", async () => {
  const f = fixture(["a", "absent", "b", "c"]);
  const a = f.add("a"); f.add("b"); const c = f.add("c"); f.order.refresh();
  f.down(c);
  f.native.ribbonItemsEl.prepend(c.buttonEl); await delay();
  assert.deepEqual(f.ids(), ["c", "a", "b"], "do not restore while native drag is in progress");
  assert.deepEqual(f.native.items.map(item => item.id), ["a", "b", "c"]);
  f.up();
  // Native bubble handler runs after our capture handler, as in Obsidian.
  f.native.items.splice(0, 3, c, a, f.native.items[1]); f.native.onChange(true);
  await delay();
  assert.deepEqual(f.settings.ribbonOrder, ["c", "absent", "a", "b"]);
  assert.deepEqual(f.ids(), ["c", "a", "b"]);
  assert.equal(f.patches.length, 1);
  const absent = f.add("absent"); await delay();
  assert.equal(f.native.ribbonItemsEl.children[1], absent.buttonEl);
  await f.close();
});

test("ordinary clicks and plugin loads during a gesture cannot replace the remembered custom order", async () => {
  const f = fixture(["late", "a", "b"]);
  const a = f.add("a"); f.add("b"); f.order.refresh();
  f.down(a); f.add("late"); await delay();
  assert.deepEqual(f.ids(), ["a", "b", "late"]);
  f.up(); await delay();
  assert.deepEqual(f.ids(), ["late", "a", "b"]);
  assert.deepEqual(f.patches, []);
  f.down(a); f.up(); await delay(); assert.deepEqual(f.patches, []);
  await f.close();
});

test("initial order is adopted, new IDs append and missing slots survive removal and subsequent restart", async () => {
  const f = fixture(); f.add("a"); f.add("b"); f.order.refresh();
  assert.deepEqual(f.settings.ribbonOrder, ["a", "b"]);
  f.add("new"); await delay(); assert.deepEqual(f.settings.ribbonOrder, ["a", "b", "new"]);
  f.remove("a"); await delay(); assert.deepEqual(f.settings.ribbonOrder, ["a", "b", "new"]);
  f.add("a"); await delay(); assert.deepEqual(f.ids(), ["a", "b", "new"]);
  const saved = [...f.settings.ribbonOrder]; await f.close();
  const restarted = fixture(saved); restarted.add("new"); restarted.order.refresh();
  restarted.add("b"); restarted.add("a"); await delay();
  assert.deepEqual(restarted.ids(), saved);
  assert.deepEqual(restarted.patches, []);
  await restarted.close();
});

test("layout replacement rebinds order restoration and unload cancels a pending capture", async () => {
  const f = fixture(["b", "a"]); const a = f.add("a"); f.add("b"); f.order.refresh();
  const old = f.native.containerEl;
  const fresh = old.cloneNode(false); fresh.innerHTML = '<div class="side-dock-actions"></div><div class="side-dock-settings"></div>';
  old.replaceWith(fresh); f.native.containerEl = fresh; f.native.ribbonItemsEl = fresh.firstElementChild;
  f.native.items = []; f.add("a"); f.order.refresh(); f.add("b"); await delay();
  assert.deepEqual(f.ids(), ["b", "a"]);
  f.down(f.native.items[0]); f.up(); const count = f.patches.length; f.order.destroy();
  f.native.items.reverse(); f.native.onChange(false); await delay();
  assert.deepEqual(f.ids(), ["a", "b"]); assert.equal(f.patches.length, count);
  a.buttonEl.dispatchEvent(new f.win.MouseEvent("mousedown", {bubbles:true}));
  f.order.refresh(); await delay(); assert.equal(f.patches.length, count);
  await f.win.happyDOM.close();
});

test("invalid or unavailable native APIs and unmanaged rows leave the ribbon unchanged", async () => {
  for (const invalid of [undefined, {}, { items: [] }, "duplicate", "unmanaged"]) {
    const f = fixture(["b", "a"]); f.add("a"); f.add("b");
    let value = invalid;
    if (invalid === "duplicate") { f.native.items[1].id = "a"; value = f.native; }
    if (invalid === "unmanaged") { f.native.ribbonItemsEl.append(f.win.document.createElement("span")); value = f.native; }
    const controller = new RibbonOrder(f.workspace, () => value, () => f.settings, patch => f.patches.push(patch));
    const html = f.native.containerEl.innerHTML;
    controller.refresh(); await delay();
    assert.equal(f.native.containerEl.innerHTML, html); assert.deepEqual(f.patches, []);
    controller.destroy(); await f.close();
  }
});

test("window blur ends the order gesture and restores an uncommitted DOM preview", async () => {
  const f = fixture(["a", "b"]); f.add("a"); const b = f.add("b"); f.order.refresh();
  f.down(b); f.native.ribbonItemsEl.prepend(b.buttonEl); await delay();
  f.win.dispatchEvent(new f.win.Event("blur")); await delay();
  assert.deepEqual(f.ids(), ["a", "b"]); assert.deepEqual(f.patches, []);
  await f.close();
});

test("saved order validation preserves v2 preferences and drops duplicate or invalid IDs", () => {
  const settings = normalizeSettings({ settingsVersion:2, pinned:true, expandedWidth:250, animate:false,
    showLabels:false, ribbonOrder:["plugin:board", null, "", 3, "core:a", "plugin:board", "__proto__"] });
  assert.deepEqual(settings.ribbonOrder, ["plugin:board", "core:a", "__proto__"]);
  assert.equal(settings.pinned, true); assert.equal(settings.expandedWidth, 250);
  assert.equal(settings.animate, false); assert.equal(settings.showLabels, false);
  assert.deepEqual(normalizeSettings({settingsVersion:2,ribbonOrder:"a"}).ribbonOrder, []);
  assert.deepEqual(normalizeSettings({ribbonOrder:["a"]}).ribbonOrder, []);
});

test("plugin persists a native reorder and restores late icons after a fresh plugin launch", async () => {
  const f = fixture(); f.add("a"); const b = f.add("b");
  let ready;
  const app = { workspace: { containerEl:f.workspace, leftRibbon:f.native,
    on:() => ({}), onLayoutReady:callback => {ready=callback;} } };
  const plugin = new Plugin(app); plugin.data = {...DEFAULT_SETTINGS, pinned:true, expandedWidth:245};
  await plugin.onload(); assert.equal(plugin.saved.length, 0); ready(); await plugin.saveQueue;
  b.buttonEl.dispatchEvent(new f.win.MouseEvent("mousedown", {bubbles:true,button:0}));
  f.up(); f.native.items.reverse(); f.native.onChange(true); await delay(); await plugin.saveQueue;
  assert.deepEqual(plugin.saved.at(-1).ribbonOrder, ["b", "a"]);
  assert.equal(plugin.saved.at(-1).pinned, true); assert.equal(plugin.saved.at(-1).expandedWidth, 245);
  const saved = plugin.saved.at(-1); plugin.onunload();
  f.native.items = []; f.add("a");
  const restarted = new Plugin(app); restarted.data = saved; await restarted.onload(); ready();
  f.add("b"); await delay(); await restarted.saveQueue;
  assert.deepEqual(f.ids(), ["b", "a"]); assert.equal(restarted.saved.length, 0);
  restarted.onunload(); await f.close();
});
