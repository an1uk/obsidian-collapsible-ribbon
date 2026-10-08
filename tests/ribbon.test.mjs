import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
const { installDomHelpers } = require("./dom-helpers.cjs");
const { RibbonRail } = require("./.generated/ribbon.js");
const { DEFAULT_SETTINGS, normalizeSettings } = require("./.generated/settings.js");
const Plugin = require("./.generated/plugin.cjs").default;
const markup = '<div class="workspace-ribbon mod-left" style="--ribbon-width:44px;padding:8px 4px;border-right:1px solid">' +
  '<div class="side-dock-actions"><div class="side-dock-ribbon-action clickable-icon" aria-label="Open graph view"><svg></svg></div></div>' +
  '<div class="side-dock-settings"><div class="side-dock-ribbon-action clickable-icon" title="Settings"><svg></svg></div></div></div>';
const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(side = "mod-left") {
  const win = new Window();
  installDomHelpers(win);
  win.document.body.innerHTML = '<div class="workspace">' + markup.replace('mod-left', side) +
    '<div class="workspace-ribbon mod-right"><div class="side-dock-ribbon-action" aria-label="Right"></div></div></div><button id="outside">Outside</button>';
  const workspace = win.document.querySelector(".workspace");
  const settings = { ...DEFAULT_SETTINGS };
  const patches = [];
  const rail = new RibbonRail(workspace, () => settings, (patch) => {
    patches.push(patch); Object.assign(settings, patch); rail.applySettings();
  }, (button, pinned) => {
    button.textContent = pinned ? "pin-off" : "pin";
    button.setAttribute("aria-label", pinned ? "Unpin ribbon" : "Pin ribbon open");
  }, (icon, label) => {
    icon.textContent = /\b(?:kanban|board)\b/i.test(label) ? "kanban" : "circle-help";
  });
  const pointer = (type, options = {}) => new win.PointerEvent(type, {
    bubbles: type !== "pointerleave" && type !== "pointerenter",
    pointerType: "mouse", pointerId: 1, button: 0, clientX: 20, clientY: 70, ...options,
  });
  const ribbon = () => workspace.querySelector(".workspace-ribbon." + side);
  const action = () => ribbon().querySelector(".side-dock-actions .side-dock-ribbon-action");
  const enter = () => action().firstElementChild.dispatchEvent(pointer("pointerover"));
  const leave = () => ribbon().dispatchEvent(pointer("pointerleave", { relatedTarget: win.document.body }));
  const mode = () => ribbon().getAttribute("data-cr-mode");
  const close = async () => { rail.destroy(); await win.happyDOM.close(); };
  return { win, workspace, rail, settings, patches, pointer, ribbon, action, enter, leave, mode, close };
}

test("hover opens before delegated tooltips without changing native nodes or right ribbon", async () => {
  const f = fixture();
  const action = f.action(), svg = action.firstElementChild;
  const right = f.workspace.querySelector(".mod-right").outerHTML;
  let clicks = 0, pointers = 0, menus = 0;
  action.addEventListener("click", () => clicks++);
  action.addEventListener("pointerdown", () => pointers++);
  action.addEventListener("contextmenu", () => menus++);
  action.style.display = "none";
  f.rail.refresh();
  assert.equal(f.mode(), "collapsed");
  f.ribbon().dispatchEvent(f.pointer("pointerover"));
  assert.equal(f.mode(), "collapsed");
  let delegatedMode;
  f.win.document.body.addEventListener("pointerover", () => { delegatedMode = f.mode(); }, { once: true });
  f.enter();
  assert.equal(delegatedMode, "overlay");
  assert.equal(action.firstElementChild, svg);
  assert.equal(action.style.display, "none");
  for (const type of ["click", "pointerdown", "contextmenu"]) action.dispatchEvent(f.pointer(type));
  assert.deepEqual([clicks, pointers, menus], [1, 1, 1]);
  assert.equal(action.getAttribute("aria-label"), "Open graph view");
  assert.equal(action.getAttribute("data-cr-label"), "Open graph view");
  assert.match(action.getAttribute("data-tooltip-classes"), /cr-ribbon-tooltip/);
  assert.equal(f.workspace.querySelector(".mod-right").outerHTML, right);
  assert.equal(f.patches.length, 0);
  await f.close();
});

test("180ms dismissal is cancelled on re-entry and keyboard focus holds the overlay", async () => {
  const f = fixture(); f.rail.refresh(); f.enter(); f.leave();
  await delay(60); assert.equal(f.mode(), "overlay");
  f.ribbon().dispatchEvent(f.pointer("pointerenter"));
  await delay(160); assert.equal(f.mode(), "overlay");
  f.workspace.querySelector(".cr-pin").focus(); f.leave();
  await delay(200); assert.equal(f.mode(), "overlay");
  f.win.document.querySelector("#outside").focus();
  await delay(200); assert.equal(f.mode(), "collapsed");
  await f.close();
});

test("pinning persists only explicit state and unpinning under the pointer retains hover", async () => {
  const f = fixture(); f.rail.refresh(); f.enter();
  const pin = f.workspace.querySelector(".cr-pin");
  pin.click();
  assert.equal(f.mode(), "pinned");
  assert.equal(pin.getAttribute("aria-label"), "Unpin ribbon");
  assert.equal(pin.getAttribute("aria-pressed"), "true");
  assert.equal(pin.hasAttribute("data-cr-label"), false);
  f.leave(); await delay(200); assert.equal(f.mode(), "pinned");
  f.ribbon().dispatchEvent(f.pointer("pointerenter")); pin.click();
  assert.equal(f.mode(), "overlay");
  assert.equal(pin.getAttribute("aria-label"), "Pin ribbon open");
  assert.equal(pin.getAttribute("aria-pressed"), "false");
  f.leave(); await delay(200); assert.equal(f.mode(), "collapsed");
  assert.deepEqual(f.patches, [{ pinned: true }, { pinned: false }]);
  await f.close();
});

test("width drag previews without saving, commits once, and keyboard changes are clamped", async () => {
  const f = fixture(); f.rail.refresh(); f.enter();
  const handle = f.workspace.querySelector(".cr-resize-handle");
  let captured = null;
  handle.setPointerCapture = (id) => { captured = id; };
  handle.hasPointerCapture = (id) => captured === id;
  handle.releasePointerCapture = () => { captured = null; };
  handle.dispatchEvent(f.pointer("pointerdown", { pointerId: 7, clientX: 220 }));
  f.win.dispatchEvent(f.pointer("pointermove", { pointerId: 7, clientX: 270 }));
  assert.equal(f.settings.expandedWidth, 220);
  assert.equal(f.ribbon().style.getPropertyValue("--cr-expanded-width"), "270px");
  assert.equal(f.ribbon().getAttribute("data-cr-resizing"), "true");
  assert.equal(f.patches.length, 0);
  f.leave(); await delay(200); assert.equal(f.mode(), "overlay");
  f.win.dispatchEvent(f.pointer("pointerup", { pointerId: 7, clientX: 270 }));
  assert.equal(f.settings.expandedWidth, 270);
  assert.equal(f.patches.length, 1);
  assert.equal(captured, null);
  assert.equal(handle.getAttribute("aria-valuenow"), "270");
  assert.equal(f.ribbon().getAttribute("data-cr-resizing"), "false");
  const key = (key, shiftKey = false) => handle.dispatchEvent(new f.win.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  key("ArrowRight"); assert.equal(f.settings.expandedWidth, 271);
  key("ArrowLeft", true); assert.equal(f.settings.expandedWidth, 261);
  key("End"); key("ArrowRight"); assert.equal(f.settings.expandedWidth, 300);
  key("Home"); key("ArrowLeft"); assert.equal(f.settings.expandedWidth, 120);
  await f.close();
});

test("cancel, lost capture and window blur revert unsaved width previews", async () => {
  const f = fixture(); f.rail.refresh(); f.enter();
  const handle = f.workspace.querySelector(".cr-resize-handle");
  for (const cancel of ["pointercancel", "lostpointercapture", "blur"]) {
    handle.dispatchEvent(f.pointer("pointerdown", { pointerId: 8, clientX: 220 }));
    f.win.dispatchEvent(f.pointer("pointermove", { pointerId: 8, clientX: 280 }));
    if (cancel === "blur") f.win.dispatchEvent(new f.win.Event("blur"));
    else (cancel === "lostpointercapture" ? handle : f.win).dispatchEvent(f.pointer(cancel, { pointerId: 8 }));
    assert.equal(f.ribbon().style.getPropertyValue("--cr-expanded-width"), "220px");
    assert.equal(f.settings.expandedWidth, 220);
    assert.equal(f.patches.length, 0);
  }
  await f.close();
});

test("native action dragging holds the overlay until pointer release", async () => {
  const f = fixture(); f.rail.refresh(); f.enter();
  f.action().dispatchEvent(f.pointer("pointerdown", { pointerId: 9 }));
  f.leave(); await delay(200); assert.equal(f.mode(), "overlay");
  f.win.dispatchEvent(f.pointer("pointerup", { pointerId: 9, clientX: 900, clientY: 900 }));
  await delay(200); assert.equal(f.mode(), "collapsed");
  await f.close();
});

test("title-only metadata stays accessible, updates while suppressed, and restores latest titles", async () => {
  const f = fixture(); f.rail.refresh();
  const settings = f.ribbon().querySelector(".side-dock-settings .side-dock-ribbon-action");
  f.enter();
  assert.equal(settings.getAttribute("title"), null);
  assert.equal(settings.getAttribute("aria-label"), "Settings");
  settings.setAttribute("title", "Updated settings"); await delay();
  assert.equal(settings.getAttribute("title"), null);
  assert.equal(settings.getAttribute("aria-label"), "Updated settings");
  assert.equal(settings.getAttribute("data-cr-label"), "Updated settings");
  settings.setAttribute("data-tooltip-classes", "other-plugin-class"); await delay();
  assert.equal(settings.getAttribute("data-tooltip-classes"), "other-plugin-class cr-ribbon-tooltip");
  f.leave(); await delay(200);
  assert.equal(settings.getAttribute("title"), "Updated settings");
  assert.equal(settings.getAttribute("aria-label"), null);
  f.enter(); settings.setAttribute("aria-label", "External accessible name"); await delay();
  f.rail.destroy();
  assert.equal(settings.getAttribute("aria-label"), "External accessible name");
  assert.equal(settings.getAttribute("title"), "Updated settings");
  assert.equal(settings.getAttribute("data-tooltip-classes"), "other-plugin-class");
  await f.win.happyDOM.close();
});

test("late items, reference labels, missing metadata, reorder and replaced groups stay correct", async () => {
  const f = fixture(); f.rail.refresh(); f.enter();
  const group = f.ribbon().querySelector(".side-dock-actions");
  const item = f.win.document.createElement("div"); item.className = "side-dock-ribbon-action";
  item.setAttribute("aria-label", "Calendar"); group.append(item); await delay();
  assert.equal(item.getAttribute("data-cr-label"), "Calendar");
  group.prepend(item); await delay(); assert.equal(group.firstElementChild, item);
  const label = f.win.document.createElement("span"); label.id = "calendar-name"; label.textContent = "Named calendar";
  group.append(label); item.setAttribute("aria-labelledby", label.id); await delay();
  assert.equal(item.getAttribute("data-cr-label"), "Named calendar");
  label.textContent = "Changed name"; await delay(); assert.equal(item.getAttribute("data-cr-label"), "Changed name");
  item.removeAttribute("aria-labelledby"); item.removeAttribute("aria-label"); await delay();
  assert.equal(item.hasAttribute("data-cr-label"), false);
  item.setAttribute("data-tooltip", "Fallback"); await delay(); assert.equal(item.getAttribute("data-cr-label"), "Fallback");
  item.remove(); await delay(); assert.equal(item.hasAttribute("data-cr-label"), false);
  assert.equal(item.hasAttribute("data-tooltip-classes"), false);
  const previous = f.ribbon().querySelector(".side-dock-settings");
  const replacement = f.win.document.createElement("div"); replacement.className = "side-dock-settings";
  previous.replaceWith(replacement); await delay();
  assert.equal(replacement.querySelectorAll(".cr-pin").length, 1);
  assert.ok(replacement.style.getPropertyValue("--cr-icon-column"));
  assert.equal(previous.style.getPropertyValue("--cr-icon-column"), "");
  f.rail.refresh(); assert.equal(f.workspace.querySelectorAll(".cr-resize-handle").length, 1);
  await f.close();
});

test("iconless Kanban action gets a reversible fallback without replacing its handler or a later native icon", async () => {
  const f = fixture(); f.rail.refresh();
  const action = f.win.document.createElement("div");
  action.className = "side-dock-ribbon-action clickable-icon";
  action.setAttribute("aria-label", "Create new board");
  let clicks = 0;
  action.addEventListener("click", () => clicks++);
  f.ribbon().querySelector(".side-dock-actions").append(action);
  await delay();
  let fallback = action.querySelector(".cr-fallback-icon");
  assert.ok(fallback);
  assert.equal(fallback.textContent, "kanban");
  assert.equal(action.getAttribute("aria-label"), "Create new board");
  fallback.click(); assert.equal(clicks, 1);
  f.enter(); assert.equal(action.getAttribute("data-cr-label"), "Create new board");
  const nativeIcon = f.win.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  action.replaceChildren(nativeIcon);
  await delay();
  assert.equal(action.firstElementChild, nativeIcon);
  assert.equal(action.querySelector(".cr-fallback-icon"), null);
  action.replaceChildren(); await delay();
  fallback = action.querySelector(".cr-fallback-icon");
  assert.equal(fallback.textContent, "kanban");
  action.setAttribute("aria-label", "Other action"); await delay();
  assert.equal(fallback.textContent, "circle-help");
  f.rail.destroy();
  assert.equal(action.childElementCount, 0);
  assert.equal(action.getAttribute("aria-label"), "Other action");
  assert.equal(action.hasAttribute("data-cr-label"), false);
  await f.win.happyDOM.close();
});
test("unload restores prior values, releases capture, cancels timers and removes listeners", async () => {
  const f = fixture();
  const ribbon = f.ribbon();
  ribbon.style.setProperty("--cr-expanded-width", "190px", "important");
  ribbon.setAttribute("data-cr-mode", "original");
  const action = f.action(); action.setAttribute("data-cr-label", "original label");
  action.setAttribute("data-tooltip-classes", "existing-class");
  f.rail.refresh(); f.enter();
  const handle = f.workspace.querySelector(".cr-resize-handle"), pin = f.workspace.querySelector(".cr-pin");
  let captured = false, released = false;
  handle.setPointerCapture = () => { captured = true; };
  handle.hasPointerCapture = () => captured;
  handle.releasePointerCapture = () => { captured = false; released = true; };
  handle.dispatchEvent(f.pointer("pointerdown", { pointerId: 10, clientX: 220 }));
  f.win.dispatchEvent(f.pointer("pointermove", { pointerId: 10, clientX: 290 }));
  f.rail.destroy();
  assert.equal(released, true);
  assert.equal(ribbon.classList.contains("cr-ribbon"), false);
  assert.equal(ribbon.getAttribute("data-cr-mode"), "original");
  assert.equal(ribbon.style.getPropertyValue("--cr-expanded-width"), "190px");
  assert.equal(ribbon.style.getPropertyPriority("--cr-expanded-width"), "important");
  assert.equal(action.getAttribute("data-cr-label"), "original label");
  assert.equal(action.getAttribute("data-tooltip-classes"), "existing-class");
  assert.equal(ribbon.querySelector(".cr-pin,.cr-resize-handle,.cr-overlay-background"), null);
  pin.click(); handle.dispatchEvent(f.pointer("pointerdown")); f.enter(); await delay(200);
  assert.equal(f.patches.length, 0); assert.equal(ribbon.getAttribute("data-cr-mode"), "original");
  f.rail.refresh(); assert.equal(ribbon.querySelector(".cr-pin"), null);
  await f.win.happyDOM.close();
});

test("layout replacement cleans the old ribbon and rebinds once; pending dismissal cannot resurrect it", async () => {
  const f = fixture(); f.rail.refresh(); f.enter(); f.leave();
  const old = f.ribbon();
  const fresh = f.win.document.createElement("div"); fresh.innerHTML = markup;
  old.replaceWith(fresh.firstElementChild); f.rail.refresh(); f.rail.refresh();
  await delay(200);
  assert.equal(old.classList.contains("cr-ribbon"), false);
  assert.equal(old.querySelector("[data-cr-label]"), null);
  assert.equal(f.workspace.querySelectorAll(".cr-pin").length, 1);
  assert.equal(f.mode(), "collapsed");
  await f.close();
});

test("v1 migration resets pin/width once, preserves preferences and validates v2 values", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ expanded: true, expandedWidth: 165, animate: false, showLabels: false }),
    { ...DEFAULT_SETTINGS, animate: false, showLabels: false });
  const saved = { ...DEFAULT_SETTINGS, pinned: true, expandedWidth: 240, animate: false, showLabels: false };
  assert.deepEqual(normalizeSettings(saved), saved);
  assert.equal(normalizeSettings({ settingsVersion: 2, expandedWidth: NaN }).expandedWidth, 220);
  assert.equal(normalizeSettings({ settingsVersion: 2, expandedWidth: 20 }).expandedWidth, 120);
  assert.equal(normalizeSettings({ settingsVersion: 2, expandedWidth: 400 }).expandedWidth, 300);
  assert.equal(normalizeSettings({ settingsVersion: 2, expandedWidth: 220.7 }).expandedWidth, 221);
});

test("plugin saves migration once, restores v2 pin/width and serializes rapid writes", async () => {
  const f = fixture(); let ready;
  const refs = [];
  const app = { workspace: {
    containerEl: f.workspace,
    on: (name, callback) => { const ref = { name, callback }; refs.push(ref); return ref; },
    onLayoutReady: (callback) => { ready = callback; },
  } };
  const legacy = new Plugin(app);
  legacy.data = { expanded: true, expandedWidth: 165, animate: false, showLabels: true };
  await legacy.onload(); await legacy.saveQueue; ready();
  assert.equal(legacy.settings.pinned, false); assert.equal(legacy.settings.expandedWidth, 220);
  assert.equal(legacy.saved.length, 1); assert.equal(legacy.saved[0].settingsVersion, 2);
  legacy.onunload();
  const plugin = new Plugin(app);
  plugin.data = { ...DEFAULT_SETTINGS, pinned: true, expandedWidth: 240 };
  await plugin.onload(); ready();
  assert.equal(plugin.saved.length, 0);
  assert.equal(f.workspace.querySelector(".cr-pin").getAttribute("aria-label"), "Unpin ribbon");
  assert.equal(f.ribbon().getAttribute("data-cr-mode"), "pinned");
  let finishFirst;
  plugin.write = () => plugin.saved.length === 1 ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve();
  plugin.updateSettings({ pinned: false }); plugin.updateSettings({ pinned: true, expandedWidth: 250 });
  await Promise.resolve(); assert.equal(plugin.saved.length, 1);
  finishFirst(); await plugin.saveQueue;
  assert.deepEqual(plugin.saved.map((s) => s.pinned), [false, true]);
  assert.equal(plugin.saved.at(-1).expandedWidth, 250);
  plugin.onunload(); for (const ref of refs) ref.callback(); ready();
  assert.equal(f.workspace.querySelector(".cr-pin"), null);
  assert.equal(plugin.events.length, 2);
  await f.win.happyDOM.close();
});
test("removing a focused action group releases its hover hold without a focusout event", async () => {
  const f = fixture(); f.rail.refresh();
  f.workspace.querySelector(".cr-pin").focus();
  assert.equal(f.mode(), "overlay");
  f.ribbon().querySelector(".side-dock-settings").remove();
  await delay(230); assert.equal(f.mode(), "collapsed");
  await f.close();
});


test("Obsidian 1.14 primary ribbon supports hover, pinning, resizing and clean unload without touching the secondary ribbon", async () => {
  const f=fixture("mod-primary");
  const right=f.workspace.querySelector(".mod-right");right.classList.replace("mod-right","mod-secondary");
  const original=right.outerHTML;
  f.rail.refresh();f.enter();assert.equal(f.mode(),"overlay");
  const pin=f.workspace.querySelector(".cr-pin");assert.ok(pin);pin.click();assert.equal(f.mode(),"pinned");
  const handle=f.workspace.querySelector(".cr-resize-handle");
  handle.dispatchEvent(new f.win.KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
  assert.equal(f.settings.expandedWidth,221);
  pin.click();f.leave();await delay(200);assert.equal(f.mode(),"collapsed");
  assert.equal(right.outerHTML,original);f.rail.destroy();
  assert.equal(f.ribbon().querySelector(".cr-pin,.cr-resize-handle,.cr-overlay-background"),null);
  assert.equal(f.ribbon().classList.contains("cr-ribbon"),false);assert.equal(right.outerHTML,original);
  await f.win.happyDOM.close();
});


test("tooltip visibility uses an owned body class and restores it on collapse, layout change and unload", async () => {
  const f=fixture(); const body=f.win.document.body;
  f.rail.refresh(); assert.equal(body.classList.contains("cr-ribbon-expanded"),false);
  f.enter();assert.equal(body.classList.contains("cr-ribbon-expanded"),true);
  f.leave();await delay(200);assert.equal(body.classList.contains("cr-ribbon-expanded"),false);
  f.ribbon().querySelector(".cr-pin").click();assert.equal(body.classList.contains("cr-ribbon-expanded"),true);
  f.rail.destroy();assert.equal(body.classList.contains("cr-ribbon-expanded"),false);
  await f.win.happyDOM.close();
  const prior=fixture();prior.win.document.body.classList.add("cr-ribbon-expanded");prior.rail.refresh();
  prior.rail.destroy();assert.equal(prior.win.document.body.classList.contains("cr-ribbon-expanded"),true);
  await prior.win.happyDOM.close();
});

test("Obsidian helpers and tooltip state stay in the ribbon's owning document", async () => {
  const first=fixture(),second=fixture();first.rail.refresh();second.rail.refresh();
  first.enter();assert.equal(first.win.document.body.classList.contains("cr-ribbon-expanded"),true);
  assert.equal(second.win.document.body.classList.contains("cr-ribbon-expanded"),false);
  for(const control of first.ribbon().querySelectorAll(".cr-pin,.cr-overlay-background,.cr-resize-handle")) {
    assert.equal(control.ownerDocument,first.win.document);
  }
  second.enter();await first.close();assert.equal(second.win.document.body.classList.contains("cr-ribbon-expanded"),true);
  await second.close();
});

test("declarative settings expose searchable controls and persist through the normal validated save path", async () => {
  const f=fixture();let ready;
  const app={workspace:{containerEl:f.workspace,on:()=>({}),onLayoutReady:callback=>{ready=callback;}}};
  const plugin=new Plugin(app);plugin.data={...DEFAULT_SETTINGS,pinned:true,expandedWidth:245,animate:false,showLabels:false};
  await plugin.onload();ready();const tab=plugin.tabs[0];const definitions=tab.getSettingDefinitions();
  assert.equal(definitions.length,3);assert.ok(definitions.every(item=>item.name && item.searchable!==false));
  assert.deepEqual(definitions.map(item=>item.control.key),["expandedWidth","animate","showLabels"]);
  assert.deepEqual(definitions[0].control,{type:"slider",key:"expandedWidth",min:120,max:300,step:1,defaultValue:220,displayFormat:definitions[0].control.displayFormat});
  assert.equal(definitions[0].control.displayFormat(245),"245 px");
  assert.equal(tab.getControlValue("expandedWidth"),245);assert.equal(tab.getControlValue("animate"),false);
  tab.setControlValue("expandedWidth",270.7);tab.setControlValue("animate",true);tab.setControlValue("showLabels",true);
  await plugin.saveQueue;assert.equal(plugin.settings.expandedWidth,271);assert.equal(plugin.settings.pinned,true);
  assert.deepEqual(plugin.saved.map(data=>[data.expandedWidth,data.animate,data.showLabels]),[[271,false,false],[271,true,false],[271,true,true]]);
  const count=plugin.saved.length;
  for(const [key,value] of [["expandedWidth","bad"],["expandedWidth",NaN],["animate",1],["showLabels",null],["pinned",false]])tab.setControlValue(key,value);
  await plugin.saveQueue;assert.equal(plugin.saved.length,count);assert.equal(tab.getControlValue("unknown"),undefined);
  plugin.onunload();await f.win.happyDOM.close();
});
