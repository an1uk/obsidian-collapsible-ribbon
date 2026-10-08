import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Window } from "happy-dom";
const require = createRequire(import.meta.url);
const { installDomHelpers } = require("./dom-helpers.cjs");
const { RibbonOrder } = require("./.generated/ribbon-order.js");
const { DEFAULT_SETTINGS, normalizeSettings } = require("./.generated/settings.js");
const Plugin = require("./.generated/plugin.cjs").default;
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));

function fixture(saved = [], options = {}) {
  const win = new Window();
  installDomHelpers(win);
  win.document.body.innerHTML = '<div class="workspace"><div class="workspace-ribbon ' + (options.side ?? "mod-left") + '"><div class="side-dock-actions"></div><div class="side-dock-settings"></div></div><div class="workspace-ribbon mod-right"></div></div>';
  const workspace = win.document.querySelector(".workspace");
  const settings = { ...DEFAULT_SETTINGS, ribbonOrder: [...saved] }, patches = [];
  const native = {
    containerEl: workspace.querySelector(".workspace-ribbon." + (options.side ?? "mod-left")), ribbonItemsEl: workspace.querySelector(".side-dock-actions"),
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
  }, () => options.refresh?.(native));
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

test("settings reorders commit without a ribbon gesture and repeated alternation saves once per change", async () => {
  const f = fixture(["a", "missing", "b", "c"]); const a=f.add("a"); f.add("b"); const c=f.add("c");
  f.order.refresh();
  f.native.items.reverse(); f.native.onChange(true);
  assert.deepEqual(f.settings.ribbonOrder,["c","missing","b","a"],"settings commit must be accepted immediately");
  await delay(); assert.deepEqual(f.ids(),["c","b","a"]);
  f.down(a); f.native.ribbonItemsEl.prepend(a.buttonEl); await delay();
  f.up(); f.native.items.splice(0,3,a,c,f.native.items[1]); f.native.onChange(true); await delay();
  assert.deepEqual(f.settings.ribbonOrder,["a","missing","c","b"]);
  f.native.items.reverse(); f.native.onChange(true); await delay();
  assert.deepEqual(f.settings.ribbonOrder,["b","missing","c","a"]);
  assert.equal(f.patches.length,3);
  f.add("missing"); await delay(); assert.deepEqual(f.ids(),["b","missing","c","a"]);
  const saved=[...f.settings.ribbonOrder]; await f.close();
  const restarted=fixture(saved); restarted.add("a"); restarted.add("c"); restarted.order.refresh();
  restarted.add("b"); restarted.add("missing"); await delay();
  assert.deepEqual(restarted.ids(),saved); await restarted.close();
});

test("settings refreshes coalesce after stable order changes and defer during native drag previews", async () => {
  const pages=[]; const f=fixture(["a","b"],{refresh:native=>pages.push(native.items.filter(item=>!item.hidden).map(item=>item.id))});
  f.add("a"); const b=f.add("b"); f.order.refresh(); await delay();
  assert.deepEqual(pages,[["a","b"]]);
  f.down(b); f.native.ribbonItemsEl.prepend(b.buttonEl); f.order.refresh(); await delay();
  assert.equal(pages.length,1,"do not redraw settings during a preview");
  f.up(); f.native.items.reverse(); f.native.onChange(true); await delay();
  assert.deepEqual(pages.at(-1),["b","a"]); assert.equal(pages.length,2);
  f.native.items[0].hidden=true; f.native.onChange(true); f.native.onChange(true); await delay();
  assert.deepEqual(pages.at(-1),["a"]); assert.equal(pages.length,3);
  f.native.items[0].hidden=false; f.native.onChange(true); await delay();
  assert.deepEqual(pages.at(-1),["b","a"]); assert.equal(f.patches.length,1);
  await f.close();
});

test("native wrapper preserves receivers, arguments, returns, errors and inherited ownership", async () => {
  const f=fixture(["a","b"]); f.add("a"); f.add("b"); const calls=[]; const sentinel={result:true};
  const original=f.native.onChange;
  const prototype={onChange(...args){calls.push({receiver:this,args}); if(args[1]==="fail")throw sentinel; original.call(this,args[0]); return sentinel;}};
  delete f.native.onChange; Object.setPrototypeOf(f.native,prototype);
  f.order.refresh(); const wrapper=f.native.onChange;
  assert.notEqual(wrapper,prototype.onChange);
  assert.equal(f.native.onChange(false,"extra",7),sentinel);
  assert.deepEqual(calls.at(-1),{receiver:f.native,args:[false,"extra",7]});
  const borrowed={...f.native};assert.equal(wrapper.call(borrowed,false,"borrowed"),sentinel);
  assert.equal(calls.at(-1).receiver,borrowed);assert.deepEqual(calls.at(-1).args,[false,"borrowed"]);
  assert.throws(()=>f.native.onChange(true,"fail"),error=>error===sentinel);
  assert.equal(f.patches.length,0);
  f.order.destroy();
  assert.equal(Object.hasOwn(f.native,"onChange"),false); assert.equal(f.native.onChange,prototype.onChange);
  wrapper.call(f.native,true,"after-unload"); await delay(); assert.equal(f.patches.length,0);
  await f.win.happyDOM.close();
});

test("unload preserves another plugin's outer wrapper and makes our retained wrapper inert", async () => {
  let refreshes=0; const f=fixture(["a","b"],{refresh:()=>refreshes++}); f.add("a"); f.add("b");
  const original=f.native.onChange; f.order.refresh(); const ours=f.native.onChange;
  let otherCalls=0; const other=function(...args){otherCalls++;return ours.apply(this,args);}; f.native.onChange=other;
  f.order.destroy(); f.native.items.reverse(); f.native.onChange(true); await delay();
  assert.equal(f.native.onChange,other); assert.equal(otherCalls,1);
  assert.deepEqual(f.ids(),["b","a"]); assert.deepEqual(f.settings.ribbonOrder,["a","b"]);
  assert.equal(refreshes,0); assert.equal(f.patches.length,0);
  f.native.onChange=original; await f.win.happyDOM.close();
});

test("plugin refreshes the cached native Interface tab while preserving navigation and separate-window state", async () => {
  const f=fixture(); f.add("a"); f.add("b"); const settingsWin=new Window(); let ready;
  const interfaceTab={id:"interface",containerEl:settingsWin.document.createElement("div"),updates:0,
    update(){this.updates++;this.rows=f.native.items.filter(item=>!item.hidden).map(item=>item.id);}};
  const other={id:"other",update(){throw new Error("unrelated settings tab must not refresh");}};
  const settingsManager={settingTabs:[other,interfaceTab],activeTab:null,pageStack:[{page:{pagePath:["Ribbon menu configuration"]}}]};
  const app={setting:settingsManager,workspace:{containerEl:f.workspace,leftRibbon:f.native,on:()=>({}),onLayoutReady:cb=>{ready=cb;}}};
  const plugin=new Plugin(app);plugin.data={...DEFAULT_SETTINGS,ribbonOrder:["a","b"]};
  await plugin.onload();ready();await delay();
  assert.deepEqual(interfaceTab.rows,["a","b"]);
  f.native.items.reverse();f.native.onChange(true);await delay();await plugin.saveQueue;
  assert.deepEqual(interfaceTab.rows,["b","a"],"closed settings cache must also refresh");
  settingsManager.activeTab=interfaceTab;const pageStack=settingsManager.pageStack;
  interfaceTab.containerEl.append(settingsWin.document.createElement("button"));
  settingsWin.document.body.append(interfaceTab.containerEl);interfaceTab.containerEl.firstElementChild.focus();
  const focus=settingsWin.document.activeElement;
  f.native.items.reverse();f.native.onChange(true);await delay();await plugin.saveQueue;
  assert.deepEqual(interfaceTab.rows,["a","b"]);assert.equal(settingsManager.activeTab,interfaceTab);
  assert.equal(settingsManager.pageStack,pageStack);assert.equal(settingsWin.document.activeElement,focus);
  assert.deepEqual(plugin.saved.map(data=>data.ribbonOrder),[["b","a"],["a","b"]]);
  const count=interfaceTab.updates;plugin.onunload();f.native.items.reverse();f.native.onChange(true);await delay();
  assert.equal(interfaceTab.updates,count);
  await settingsWin.happyDOM.close();await f.close();
});

test("read-only native methods leave native commits unchanged instead of partially enabling ordering", async () => {
  const f=fixture(["b","a"]);f.add("a");f.add("b");
  const original=f.native.onChange;
  Object.defineProperty(f.native,"onChange",{value:original,writable:false,configurable:false});
  f.order.refresh();assert.equal(f.native.onChange,original);assert.deepEqual(f.ids(),["a","b"]);
  f.native.items.reverse();f.native.onChange(true);await delay();
  assert.deepEqual(f.ids(),["b","a"]);assert.equal(f.patches.length,0);
  await f.close();assert.equal(f.native.onChange,original);
});

test("layout rebinding restores hook ownership, refreshes once and cancels obsolete queued updates", async () => {
  let refreshes=0;const f=fixture(["a","b"],{refresh:()=>refreshes++});f.add("a");f.add("b");
  const descriptor=Object.getOwnPropertyDescriptor(f.native,"onChange");
  f.order.refresh();const wrapper=f.native.onChange;f.order.refresh();assert.equal(f.native.onChange,wrapper);
  const fresh=f.native.containerEl.cloneNode(false);fresh.innerHTML='<div class="side-dock-actions"></div><div class="side-dock-settings"></div>';
  f.native.containerEl.replaceWith(fresh);f.native.containerEl=fresh;f.native.ribbonItemsEl=fresh.firstElementChild;
  f.native.onChange(false);f.order.refresh();assert.notEqual(f.native.onChange,wrapper);
  await delay();assert.equal(refreshes,1);
  f.order.destroy();assert.deepEqual(Object.getOwnPropertyDescriptor(f.native,"onChange"),descriptor);
  f.native.items.reverse();f.native.onChange(true);await delay();assert.equal(refreshes,1);
  await f.win.happyDOM.close();
});

test("missing or changed native Settings APIs do not prevent native order commits or persistence", async () => {
  for (const setting of [undefined,{}, {settingTabs:"changed"},{settingTabs:[{id:"interface",update:null}]}]) {
    const f=fixture();f.add("a");f.add("b");let ready;
    const app={setting,workspace:{containerEl:f.workspace,leftRibbon:f.native,on:()=>({}),onLayoutReady:cb=>{ready=cb;}}};
    const plugin=new Plugin(app);plugin.data={...DEFAULT_SETTINGS,ribbonOrder:["a","b"]};
    await plugin.onload();ready();f.native.items.reverse();f.native.onChange(true);await delay();await plugin.saveQueue;
    assert.deepEqual(plugin.saved.at(-1).ribbonOrder,["b","a"]);assert.deepEqual(f.ids(),["b","a"]);
    plugin.onunload();await f.close();
  }
});


test("Obsidian 1.14 primary ribbon restores late icons and commits native Settings order", async () => {
  const pages=[];const f=fixture(["late","a"],{side:"mod-primary",refresh:native=>pages.push(native.items.map(item=>item.id))});
  f.add("a");f.order.refresh();f.add("late");await delay();assert.deepEqual(f.ids(),["late","a"]);
  f.native.items.reverse();f.native.onChange(true);await delay();
  assert.deepEqual(f.settings.ribbonOrder,["a","late"]);assert.deepEqual(pages.at(-1),["a","late"]);
  await f.close();
});
