const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

exports.loadObsidian = function(archivePath) {
  const archive = fs.readFileSync(archivePath);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
  const read = (name) => {
    const entry = header.files[name];
    const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
    return archive.subarray(start, start + entry.size).toString();
  };
  const app = read("app.js");
  const marker = app.indexOf('createDiv("workspace-ribbon side-dock-ribbon")');
  const ribbonStart = app.lastIndexOf("=function(){function e(e,t)", marker);
  const ribbonEnd = app.indexOf("},e}()", marker) + "},e}()".length;
  assert.ok(marker >= 0 && ribbonStart >= 0 && ribbonEnd > marker, "native ribbon class must be found");
  const ribbonSource = app.slice(ribbonStart + 1, ribbonEnd);
  const dragName = ribbonSource.match(/([\w$]+)\(o,o,this\.ribbonItemsEl,5/)[1];
  const mobileName = ribbonSource.match(/([\w$]+)\.isMobile/)[1];
  const sideName = ribbonSource.match(/,i=([\w$]+)\(t\);n\.addClass/)?.[1];
  let sideMap;
  if (sideName) {
    const start = app.indexOf("function " + sideName + "(");
    sideMap = vm.runInNewContext("(" + app.slice(start, app.indexOf("}", start) + 1) + ")");
  }
  function method(name, next) {
    const match = new RegExp("([\\w$]+)\\.prototype\\." + name + "=function").exec(app);
    assert.ok(match, "native method must be found: " + name);
    const start = app.indexOf("function", match.index);
    const end = app.indexOf("," + match[1] + ".prototype." + next + "=", start);
    assert.ok(end > start, "native method boundary must be found: " + name);
    return app.slice(start, end);
  }
  const build = method("buildRibbonPage", "buildToolbarPageDef");
  const updateMarker = app.indexOf("prototype.update=function(){this.settingItems=this.getSettingDefinitions()");
  const updateStart = app.indexOf("function", updateMarker);
  const updateOwner = app.slice(updateMarker - 8, updateMarker).match(/([\w$]+)\.$/)[1];
  const updateEnd = app.indexOf("," + updateOwner + ".prototype.getControlValue=", updateStart);
  assert.ok(updateMarker >= 0 && updateEnd > updateStart, "native settings update method must be found");
  const update = app.slice(updateStart, updateEnd);
  const phone = build.match(/([\w$]+)\.isPhone/)[1];
  const labels = build.match(/([\w$]+)\.setting\.appearance/)[1];
  const reorder = build.match(/([\w$]+)\(n\.items,r,o\)/)[1];
  const validate = update.match(/\),([\w$]+)\(this\.settingItems,this\.name\)/)[1];
  const settingsScript = "(function(){const " + phone + "={isPhone:false}," + labels +
    '={setting:{appearance:{optionConfigureRibbon:()=>"Ribbon menu configuration",optionConfigureRibbonDesc:()=>"",labelAdditionalRibbonItems:()=>"Hidden"}}},' +
    reorder + "=(items,from,to)=>items.splice(to,0,items.splice(from,1)[0])," + validate +
    "=()=>{};return {build:(" + build + "),update:(" + update + ")};})()";
  return {
    version: JSON.parse(read("package.json")).version,
    ribbonSide: sideName ? "mod-primary" : "mod-left", read, settingsScript,
    settingsMethods: vm.runInNewContext(settingsScript),
    createRibbon(win, workspace, onDrop) {
      const createDiv = (cls) => {
        const node = win.document.createElement("div"); node.className = cls;
        node.addClass = (...names) => node.classList.add(...names);
        node.createDiv = (name) => { const child = createDiv(name); node.append(child); return child; };
        return node;
      };
      const context = {createDiv, [mobileName]:{isMobile:true}, [dragName]:onDrop};
      if (sideName) context[sideName] = sideMap;
      const NativeRibbon = vm.runInNewContext("(" + ribbonSource + ")", context);
      const native = new NativeRibbon(workspace, "left");
      Object.defineProperty(native.items, "remove", {value(item) {const index=this.indexOf(item);if(index>=0)this.splice(index,1);}});
      return native;
    },
  };
};
