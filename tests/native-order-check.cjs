const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { Window } = require("happy-dom");
const { RibbonOrder } = require("./.generated/ribbon-order.js");
const { RibbonRail } = require("./.generated/ribbon.js");
const { DEFAULT_SETTINGS } = require("./.generated/settings.js");
if (!process.argv[2]) throw new Error("Usage: node tests/native-order-check.cjs <Obsidian-1.13.7.asar>");
const archive = fs.readFileSync(process.argv[2]);
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entry = header.files["app.js"];
const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const app = archive.subarray(offset, offset + entry.size).toString();
const start = app.indexOf("X6=function(){function e(e,t)");
const end = app.indexOf(",Q6=", start);
assert.ok(start >= 0 && end > start, "native ribbon class must be found");
const drops = new WeakMap();
const NativeRibbon = vm.runInNewContext("(" + app.slice(start + 3, end) + ")", {
  Gv: (button, drag, group, threshold, begin, drop) => drops.set(button, drop),
});

const pageStart = app.indexOf("t.prototype.buildRibbonPage=function") + "t.prototype.buildRibbonPage=".length;
const pageEnd = app.indexOf(",t.prototype.buildToolbarPageDef=", pageStart);
assert.ok(pageEnd > pageStart, "native ribbon settings builder must be found");
const buildRibbonPage = vm.runInNewContext("(" + app.slice(pageStart, pageEnd) + ")", {
  rd: {isPhone:false}, Kd: (items, from, to) => items.splice(to, 0, items.splice(from, 1)[0]),
  bd: {setting:{appearance:{optionConfigureRibbon:()=>"Ribbon menu configuration",optionConfigureRibbonDesc:()=>"",labelAdditionalRibbonItems:()=>"Hidden"}}},
});
const updateStart = app.indexOf("l6=function");
const updateBody = app.indexOf("e.prototype.update=function", updateStart) + "e.prototype.update=".length;
const updateEnd = app.indexOf(",e.prototype.getControlValue=", updateBody);
assert.ok(updateEnd > updateBody, "native settings update method must be found");
const updateTab = vm.runInNewContext("(" + app.slice(updateBody, updateEnd) + ")", {H2:()=>{}});

function fixture(savedOrder = [], enabled = true) {
  const win = new Window();
  win.document.body.innerHTML = '<div class="workspace"><div class="workspace-ribbon mod-left" style="--ribbon-width:44px"><div class="side-dock-actions"></div><div class="side-dock-settings"></div></div></div>';
  const workspace = win.document.querySelector(".workspace");
  const native = Object.create(NativeRibbon.prototype);
  native.containerEl = workspace.querySelector(".mod-left");
  native.items = [];
  Object.defineProperty(native.items, "remove", { value(item) { const index = this.indexOf(item); if (index >= 0) this.splice(index, 1); } });
  native.ribbonItemsEl = workspace.querySelector(".side-dock-actions");
  native.ribbonItemsEl.setChildrenInPlace = (nodes) => native.ribbonItemsEl.replaceChildren(...nodes);
  native.workspace = { requestSaveLayout: () => { native.saved = native.serialize(); } };
  native.makeRibbonItemButton = (icon, title, callback) => {
    const button = win.document.createElement("div");
    button.className = "side-dock-ribbon-action clickable-icon";
    button.setAttribute("aria-label", title);
    button.innerHTML = "<svg></svg>";
    button.toggle = (visible) => { button.style.display = visible ? "" : "none"; };
    button.addEventListener("click", callback);
    return button;
  };
  const settings = { ...DEFAULT_SETTINGS, ribbonOrder: [...savedOrder] };
  const rail = enabled ? new RibbonRail(workspace, () => settings,
    patch => { Object.assign(settings, patch); rail.applySettings(); },
    (button, pinned) => { button.textContent = pinned ? "pin-off" : "pin"; },
    (icon) => { icon.innerHTML = "<svg></svg>"; }) : null;
  const tab = {name:"Interface",settingItems:[],getSettingDefinitions(){return [buildRibbonPage.call(this)];},update:updateTab};
  tab.app = {workspace:{leftRibbon:native}};
  tab.setting = {activeTab:null,pageStack:[],refreshSearch(){},refreshCurrentPage(target){
    if (this.activeTab === target) this.rendered = target.settingItems[0];
  }};
  const orderController = enabled ? new RibbonOrder(workspace, () => native, () => settings,
    patch => Object.assign(settings, patch), () => tab.update()) : null;
  const add = id => native.addRibbonItemButton(id, "square", id, () => {});
  const order = () => Array.from(native.ribbonItemsEl.children, node => node.getAttribute("aria-label"));
  const flush = async () => { await win.happyDOM.waitUntilComplete(); };
  const close = async () => { orderController?.destroy(); rail?.destroy(); await win.happyDOM.close(); };
  return {win, native, rail, settings, tab, orderController, add, order, flush, close};
}
(async () => {
  const first = fixture();
  first.add("core:first"); const middle = first.add("plugin:middle"); first.add("core:last");
  first.tab.update(); first.rail.refresh(); first.orderController.refresh();
  await first.flush();
  middle.dispatchEvent(new first.win.MouseEvent("mousedown", {bubbles:true,button:0}));
  first.win.dispatchEvent(new first.win.MouseEvent("mouseup", {button:0}));
  drops.get(middle)(0);
  await first.flush();
  assert.deepEqual(first.settings.ribbonOrder, ["plugin:middle", "core:first", "core:last"]);
  const settingsNames = (tab) => Array.from(tab.settingItems[0].items[0].items, row => row.name);
  assert.deepEqual(settingsNames(first.tab), ["plugin:middle", "core:first", "core:last"], "closed settings definitions must follow the ribbon");
  first.tab.setting.activeTab = first.tab;
  const navigation = [{page:{title:"Ribbon menu configuration"}}]; first.tab.setting.pageStack = navigation;
  first.tab.settingItems[0].items[0].onReorder(0, 2); await first.flush();
  assert.deepEqual(first.order(), ["core:first", "core:last", "plugin:middle"]);
  assert.deepEqual(first.settings.ribbonOrder, ["core:first", "core:last", "plugin:middle"]);
  assert.equal(first.tab.setting.pageStack, navigation); assert.equal(first.tab.setting.activeTab, first.tab);
  assert.deepEqual(Array.from(first.tab.setting.rendered.items[0].items, row=>row.name), first.order());
  first.tab.settingItems[0].items[0].onDelete(1); await first.flush();
  assert.equal(first.native.items[1].hidden, true);
  assert.equal(first.native.items[1].buttonEl.style.display, "none");
  assert.deepEqual(settingsNames(first.tab), ["core:first", "plugin:middle"]);
  first.tab.settingItems[0].items[1].items[0].action(); await first.flush();
  assert.equal(first.native.items[1].hidden, false);
  assert.deepEqual(settingsNames(first.tab), first.order());
  middle.dispatchEvent(new first.win.MouseEvent("mousedown", {bubbles:true,button:0}));
  first.win.dispatchEvent(new first.win.MouseEvent("mouseup", {button:0})); drops.get(middle)(0); await first.flush();
  assert.deepEqual(settingsNames(first.tab), ["plugin:middle", "core:first", "core:last"]);
  const nativeSaved = first.native.saved, pluginSaved = [...first.settings.ribbonOrder];
  console.log(JSON.stringify({nativeSettingsReorder:true,nativeHideShow:true,nativeSettingsCacheRefresh:true,navigationPreserved:true}));
  await first.close();
  for (const enabled of [false, true]) {
    const f = fixture(pluginSaved, enabled);
    f.add("core:first"); f.add("core:last"); f.native.load(nativeSaved);
    f.rail?.refresh(); f.orderController?.refresh();
    const late = f.add("plugin:middle"); await f.flush();
    assert.deepEqual(f.order(), enabled ? pluginSaved : ["core:first", "core:last", "plugin:middle"]);
    if (enabled) {
      assert.deepEqual(Array.from(f.native.items, item => item.id), pluginSaved);
      late.remove(); f.native.removeRibbonAction("plugin:middle"); await f.flush();
      const replacement = f.add("plugin:middle"); await f.flush();
      assert.equal(f.native.ribbonItemsEl.firstElementChild, replacement);
      f.orderController.destroy(); f.rail.destroy();
      assert.deepEqual(f.order(), pluginSaved);
    }
    console.log(JSON.stringify({orderingEnabled:enabled, savedOrder:pluginSaved, startupOrder:f.order(), nativeModelMatchesDOM:true}));
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
