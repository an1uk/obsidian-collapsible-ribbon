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
  const orderController = enabled ? new RibbonOrder(workspace, () => native, () => settings, patch => Object.assign(settings, patch)) : null;
  const add = id => native.addRibbonItemButton(id, "square", id, () => {});
  const order = () => Array.from(native.ribbonItemsEl.children, node => node.getAttribute("aria-label"));
  const flush = async () => { await win.happyDOM.waitUntilComplete(); };
  const close = async () => { orderController?.destroy(); rail?.destroy(); await win.happyDOM.close(); };
  return {win, native, rail, settings, orderController, add, order, flush, close};
}
(async () => {
  const first = fixture();
  first.add("core:first"); const middle = first.add("plugin:middle"); first.add("core:last");
  first.rail.refresh(); first.orderController.refresh();
  middle.dispatchEvent(new first.win.MouseEvent("mousedown", {bubbles:true,button:0}));
  first.win.dispatchEvent(new first.win.MouseEvent("mouseup", {button:0}));
  drops.get(middle)(0);
  await first.flush();
  assert.deepEqual(first.settings.ribbonOrder, ["plugin:middle", "core:first", "core:last"]);
  const nativeSaved = first.native.saved, pluginSaved = [...first.settings.ribbonOrder];
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
