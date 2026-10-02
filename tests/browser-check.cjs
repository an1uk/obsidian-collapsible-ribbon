const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { build } = require("esbuild");

// Optional visual check: pass local app archive, theme, Chromium executable and Playwright module.
const [archivePath, themePath, chromePath, playwrightPath] = process.argv.slice(2);
if (![archivePath, themePath, chromePath, playwrightPath].every(Boolean)) {
  throw new Error("Usage: node tests/browser-check.cjs <obsidian.asar> <theme.css> <chrome.exe> <playwright-module>");
}
const { chromium } = require(playwrightPath);
function archiveText(name) {
  const file = fs.readFileSync(archivePath);
  const header = JSON.parse(file.subarray(16, 16 + file.readUInt32LE(12)).toString());
  const entry = header.files[name];
  const start = 8 + file.readUInt32LE(4) + Number(entry.offset);
  return file.subarray(start, start + entry.size).toString();
}
const svg = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M5 5h14v14H5z" stroke="currentColor" fill="none"/></svg>';
function markup(theme, css) {
  return '<html><head><style>' + archiveText("app.css") + '</style><style>' +
    fs.readFileSync(themePath, "utf8") + '</style><style>' + css + '</style></head>' +
    '<body class="' + theme + ' show-ribbon is-focused"><div class="app-container"><div class="horizontal-main-container"><div class="workspace">' +
    '<div class="workspace-ribbon mod-left"><div class="sidebar-toggle-button mod-left"><div class="clickable-icon">' + svg + '</div></div>' +
    '<div class="side-dock-actions"><div id="calendar" class="clickable-icon side-dock-ribbon-action" aria-label="Calendar">' + svg + '</div>' +
    '<div id="long-label" class="clickable-icon side-dock-ribbon-action" aria-label="A deliberately long label that must truncate">' + svg + '</div></div>' +
    '<div class="side-dock-settings"><div id="settings" class="clickable-icon side-dock-ribbon-action" title="Settings">' + svg + '</div></div></div>' +
    '<div id="editor" class="workspace-split mod-root" style="flex:1 1 0;min-width:0"><div class="workspace-leaf">Editor</div></div>' +
    '<div class="workspace-ribbon mod-right"></div></div></div></div><div id="ribbon-tip" class="tooltip cr-ribbon-tooltip">Ribbon tooltip</div>' +
    '<div id="other-tip" class="tooltip">Other tooltip</div><button id="outside" style="position:fixed;left:800px;top:100px">Outside</button></body></html>';
}

(async () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const bundle = await build({ entryPoints: ["./ribbon.ts"], bundle: true, write: false, format: "iife", globalName: "FixtureRail" });
  const orderBundle = await build({ entryPoints: ["./ribbon-order.ts"], bundle: true, write: false, format: "iife", globalName: "FixtureOrder" });
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    for (const theme of [
      "theme-light", "theme-dark",
      "theme-light anp-card-layout anp-card-layout-actions",
      "theme-dark anp-card-layout anp-card-layout-actions anp-colorful-frame",
      "theme-dark anp-border-layout anp-colorful-frame",
    ]) {
      await page.setContent(markup(theme, css));
      const geometry = () => page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        return {
          ribbon: rect(".workspace-ribbon.mod-left").width,
          editor: rect("#editor").width,
          header: rect(".sidebar-toggle-button").width,
          icons: Array.from(document.querySelectorAll(".side-dock-ribbon-action:not(.cr-pin) svg")).map((el) => {
            const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }),
          mode: document.querySelector(".workspace-ribbon.mod-left").getAttribute("data-cr-mode"),
        };
      });
      const original = await geometry();
      await page.mouse.move(900, 500);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        window.saved = { settingsVersion: 2, pinned: false, expandedWidth: 220, animate: true, showLabels: true };
        window.writes = [];
        window.commands = 0;
        window.originalAction = document.querySelector("#calendar");
        window.originalSvg = originalAction.firstElementChild;
        originalAction.addEventListener("click", () => { commands++; });
        window.rail = new FixtureRail.RibbonRail(document.querySelector(".workspace"), () => saved,
          (patch) => { writes.push(patch); Object.assign(saved, patch); rail.applySettings(); },
          (button, pinned) => {
            button.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M8 5h8v7l-4 4-4-4z" stroke="currentColor" fill="none"/></svg>';
            button.setAttribute("aria-label", pinned ? "Unpin ribbon" : "Pin ribbon open");
          }, (icon, label) => {
            icon.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke="currentColor"/></svg>';
            icon.dataset.kind = /\b(?:kanban|board)\b/i.test(label) ? "kanban" : "circle-help";
          });
        rail.refresh();
      });
      await page.waitForTimeout(200);
      const collapsed = await geometry();
      assert.equal(collapsed.ribbon, original.ribbon);
      assert.equal(collapsed.editor, original.editor);
      await page.locator("#calendar").hover(); await page.waitForTimeout(230);
      const overlay = await geometry();
      assert.equal(overlay.mode, "overlay");
      assert.equal(overlay.ribbon, original.ribbon, "hover must keep ribbon width");
      assert.equal(overlay.editor, original.editor, "hover must keep editor width");
      assert.equal(overlay.header, original.header, "hover must keep header width");
      await page.waitForFunction(() => document.querySelector(".workspace-ribbon.mod-left").dataset.crMode === "overlay" && Math.abs(document.querySelector(".cr-overlay-background").getBoundingClientRect().width - 220) < 1, null, { timeout: 2000 });
      assert.ok(Math.abs(await page.locator(".cr-overlay-background").evaluate((el) => el.getBoundingClientRect().width) - 220) < 1);
      assert.equal(await page.locator("#calendar").evaluate((el) => getComputedStyle(el).getPropertyValue("--no-tooltip").trim()), "true");
      assert.equal(await page.locator("#ribbon-tip").evaluate((el) => getComputedStyle(el).display), "none");
      assert.notEqual(await page.locator("#other-tip").evaluate((el) => getComputedStyle(el).display), "none");
      assert.equal(await page.locator("#settings").getAttribute("title"), null);
      assert.equal(await page.locator("#settings").getAttribute("aria-label"), "Settings");
      assert.equal(await page.locator("#long-label").evaluate((el) => getComputedStyle(el, "::after").textOverflow), "ellipsis");
      const row = await page.locator("#calendar").boundingBox();
      assert.ok(row.width > 190);
      await page.mouse.click(row.x + 120, row.y + row.height / 2);
      assert.equal(await page.evaluate(() => commands), 1, "label area must trigger the existing action");
      assert.equal(await page.evaluate(() => originalAction === document.querySelector("#calendar") && originalSvg === originalAction.firstElementChild), true);
      // Moving through the blank overlay area must not accidentally collapse it.
      await page.mouse.move(150, 300); await page.waitForTimeout(220);
      assert.equal((await geometry()).mode, "overlay");
      // A real capture-based pointer drag previews the width, then commits once.
      const handle = await page.locator(".cr-resize-handle").boundingBox();
      await page.mouse.move(handle.x + 3, handle.y + 120); await page.mouse.down();
      await page.mouse.move(handle.x + 43, handle.y + 120, { steps: 4 });
      assert.equal(await page.evaluate(() => saved.expandedWidth), 220);
      assert.equal(await page.evaluate(() => writes.length), 0);
      assert.equal(await page.locator(".cr-resize-handle").getAttribute("aria-valuenow"), "260");
      assert.equal(await page.locator(".workspace-ribbon.mod-left").evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
      await page.mouse.up(); await page.waitForTimeout(170);
      assert.equal(await page.evaluate(() => saved.expandedWidth), 260);
      assert.equal(await page.evaluate(() => writes.length), 1);
      await page.locator(".cr-resize-handle").press("ArrowLeft");
      await page.locator(".cr-resize-handle").press("Shift+ArrowRight");
      assert.equal(await page.evaluate(() => saved.expandedWidth), 269);
      await page.evaluate(() => { saved.expandedWidth = 220; rail.applySettings(); });
      await page.waitForTimeout(170);
      const cancelHandle = await page.locator(".cr-resize-handle").boundingBox();
      const writesBeforeCancel = await page.evaluate(() => writes.length);
      await page.mouse.move(cancelHandle.x + 3, cancelHandle.y + 120); await page.mouse.down();
      await page.mouse.move(cancelHandle.x + 43, cancelHandle.y + 120);
      await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
      await page.mouse.up();
      assert.equal(await page.evaluate(() => saved.expandedWidth), 220);
      assert.equal(await page.evaluate(() => writes.length), writesBeforeCancel);
      await page.locator(".cr-pin").click();
      await page.waitForFunction(() => Math.abs(document.querySelector(".workspace-ribbon.mod-left").getBoundingClientRect().width - 220) < 0.1, null, { timeout: 2000 });
      const pinned = await geometry();
      assert.equal(pinned.mode, "pinned");
      assert.ok(Math.abs(pinned.ribbon - 220) < 0.1);
      assert.ok(Math.abs((original.editor - pinned.editor) - (220 - original.ribbon)) < 1);
      assert.equal(await page.locator("#ribbon-tip").evaluate((el) => getComputedStyle(el).display), "none");
      await page.locator(".cr-pin").click(); await page.waitForTimeout(230);
      assert.equal((await geometry()).mode, "overlay");
      await page.locator("#outside").click(); await page.waitForTimeout(240);
      assert.equal((await geometry()).mode, "collapsed");
      assert.equal(await page.locator("#settings").getAttribute("title"), "Settings");
      assert.equal(await page.locator("#settings").getAttribute("aria-label"), null);
      assert.notEqual(await page.locator("#ribbon-tip").evaluate((el) => getComputedStyle(el).display), "none");
      for (const state of [collapsed, overlay, pinned]) {
        for (let index = 0; index < original.icons.length; index++) {
          assert.ok(Math.abs(original.icons[index].x - state.icons[index].x) < 1, "icons must keep horizontal position");
          // The bottom settings action intentionally moves up by the height of the added pin row.
          if (index < original.icons.length - 1) assert.ok(Math.abs(original.icons[index].y - state.icons[index].y) < 1, "top rows must keep height");
          assert.ok(Math.abs(collapsed.icons[index].y - state.icons[index].y) < 1, "expansion must keep row height");
        }
      }
      // A theme width change must refresh the native icon column without changing hover allocation.
      await page.evaluate(() => { document.body.style.setProperty("--ribbon-width", "50px"); rail.refreshMetrics(); });
      await page.waitForFunction(() => Math.abs(document.querySelector(".workspace-ribbon.mod-left").getBoundingClientRect().width - 50) < 0.1, null, { timeout: 2000 });
      const widerNative = await geometry(); assert.ok(Math.abs(widerNative.ribbon - 50) < 0.1);
      await page.locator("#calendar").hover(); await page.waitForTimeout(200);
      const widerHover = await geometry(); assert.ok(Math.abs(widerHover.ribbon - 50) < 0.1); assert.ok(Math.abs(widerHover.editor - widerNative.editor) < 0.1);
      for (let index = 0; index < widerHover.icons.length; index++) assert.ok(Math.abs(widerHover.icons[index].x - widerNative.icons[index].x) < 0.1);
      await page.evaluate(() => { document.body.style.removeProperty("--ribbon-width"); rail.refreshMetrics(); });
      // Metadata and runtime setting changes remain correct while pinned.
      await page.evaluate(() => { saved.pinned = true; saved.showLabels = false; saved.animate = false; rail.applySettings(); });
      await page.waitForTimeout(30);
      assert.equal(await page.locator("#long-label").evaluate((el) => getComputedStyle(el, "::after").content), "none");
      assert.equal(await page.locator(".workspace-ribbon.mod-left").evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
      await page.evaluate(() => { saved.showLabels = true; rail.applySettings(); });
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.waitForFunction(() => Math.abs(document.querySelector(".cr-resize-handle").getBoundingClientRect().height - document.querySelector(".workspace-ribbon.mod-left").getBoundingClientRect().height) < 1, null, { timeout: 2000 });
      const panel = await page.locator(".workspace-ribbon.mod-left").boundingBox();
      const separator = await page.locator(".cr-resize-handle").boundingBox();
      assert.ok(Math.abs(separator.x + separator.width - panel.x - panel.width) < 1);
      assert.ok(Math.abs(separator.height - panel.height) < 1);
      await page.setViewportSize({ width: 1000, height: 650 });
      await page.waitForFunction(() => Math.abs(document.querySelector(".cr-resize-handle").getBoundingClientRect().height - document.querySelector(".workspace-ribbon.mod-left").getBoundingClientRect().height) < 1, null, { timeout: 2000 });
      if (theme === "theme-dark") {
        await page.screenshot({ path: "tests/.generated/pinned-dark.png" });
        await page.evaluate(() => { saved.pinned = false; rail.applySettings(); });
        await page.locator("#calendar").hover(); await page.waitForTimeout(230);
        await page.screenshot({ path: "tests/.generated/hover-dark.png" });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => { saved.animate = true; saved.pinned = true; rail.applySettings(); });
      assert.equal(await page.locator(".workspace-ribbon.mod-left").evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        const action = document.createElement("div");
        action.id = "kanban";
        action.className = "clickable-icon side-dock-ribbon-action";
        action.setAttribute("aria-label", "Create new board");
        window.kanbanCommands = 0;
        action.addEventListener("click", () => { kanbanCommands++; });
        document.querySelector(".side-dock-actions").append(action);
      });
      await page.waitForFunction(() => document.querySelector("#kanban .cr-fallback-icon svg"));
      assert.equal(await page.locator("#kanban .cr-fallback-icon").getAttribute("data-kind"), "kanban");
      assert.equal(await page.locator("#kanban").getAttribute("aria-label"), "Create new board");
      const kanbanIconX = await page.locator("#kanban svg").evaluate((el) => {
        const r = el.getBoundingClientRect(); return r.x + r.width / 2;
      });
      const regularIconX = await page.locator("#calendar svg").evaluate((el) => {
        const r = el.getBoundingClientRect(); return r.x + r.width / 2;
      });
      assert.ok(Math.abs(kanbanIconX - regularIconX) < 1, "fallback icon must align with native icons");
      const kanbanIconBox = await page.locator("#kanban svg").boundingBox();
      await page.mouse.click(kanbanIconBox.x + kanbanIconBox.width / 2, kanbanIconBox.y + kanbanIconBox.height / 2);
      assert.equal(await page.evaluate(() => kanbanCommands), 1);
      await page.evaluate(() => {
        document.querySelector("#kanban").innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24"></svg>';
      });
      await page.waitForFunction(() => !document.querySelector("#kanban .cr-fallback-icon"));
      await page.evaluate(() => { document.querySelector("#kanban").replaceChildren(); });
      await page.waitForFunction(() => document.querySelector("#kanban .cr-fallback-icon svg"));
      const writesBeforeUnload = await page.evaluate(() => writes.length);
      const unloadHandle = await page.locator(".cr-resize-handle").boundingBox();
      await page.mouse.move(unloadHandle.x + 3, unloadHandle.y + 120); await page.mouse.down();
      await page.mouse.move(unloadHandle.x + 33, unloadHandle.y + 120);
      await page.evaluate(() => rail.destroy()); await page.mouse.up(); await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => writes.length), writesBeforeUnload);
      const unloaded = await geometry();
      assert.equal(unloaded.ribbon, original.ribbon);
      assert.equal(unloaded.editor, original.editor);
      assert.equal(await page.locator(".cr-pin,.cr-resize-handle,.cr-overlay-background").count(), 0);
      assert.equal(await page.locator("#calendar").getAttribute("data-tooltip-classes"), null);
      for (let index = 0; index < original.icons.length; index++) assert.deepEqual(unloaded.icons[index], original.icons[index]);
      console.log(JSON.stringify({ theme, hoverRibbon: overlay.ribbon, hoverEditor: overlay.editor, pinnedRibbon: pinned.ribbon,
        pinnedEditor: pinned.editor, resize: true, tooltipScope: true, iconsAligned: true, unloadRestored: true }));
      // Verify ordering with real theme CSS and native-style mouse commits.
      await page.setContent(markup(theme, css));
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.addScriptTag({ content: orderBundle.outputFiles[0].text });
      await page.evaluate(() => {
        window.saved = { settingsVersion:2, pinned:false, expandedWidth:220, animate:false, showLabels:true,
          ribbonOrder:["late", "long-label", "calendar"] };
        window.native = {
          containerEl: document.querySelector(".mod-left"), ribbonItemsEl:document.querySelector(".side-dock-actions"),
          items: ["calendar", "long-label"].map(id => ({id,buttonEl:document.getElementById(id)})),
          onChange() { this.ribbonItemsEl.replaceChildren(...this.items.map(item => item.buttonEl)); },
        };
        window.orderWrites = [];
        window.order = new FixtureOrder.RibbonOrder(document.querySelector(".workspace"), () => native,
          () => saved, patch => {orderWrites.push(patch); Object.assign(saved,patch);});
        window.rail = new FixtureRail.RibbonRail(document.querySelector(".workspace"), () => saved,
          patch => {Object.assign(saved,patch);rail.applySettings();}, button => {
            button.textContent="pin"; button.setAttribute("aria-label","Pin ribbon open");
          }, icon => {icon.innerHTML="<svg></svg>";});
        rail.refresh(); order.refresh();
        window.late = document.getElementById("calendar").cloneNode(true);
        late.id="late"; late.setAttribute("aria-label","Late plugin");
        native.items.push({id:"late",buttonEl:late}); native.onChange(false);
      });
      await page.waitForFunction(() => document.querySelector(".side-dock-actions").firstElementChild.id === "late");
      const orderIds = () => page.evaluate(() => Array.from(native.ribbonItemsEl.children,el=>el.id));
      assert.deepEqual(await orderIds(), ["late", "long-label", "calendar"]);
      const orderedCollapsed = await geometry();
      await page.locator("#calendar").hover();
      const orderedOverlay = await geometry();
      assert.equal(orderedCollapsed.ribbon, orderedOverlay.ribbon);
      assert.equal(orderedCollapsed.editor, orderedOverlay.editor);
      assert.ok(orderedOverlay.icons.every(icon => Math.abs(icon.x-orderedCollapsed.icons[0].x)<1));
      await page.mouse.down();
      await page.evaluate(() => {
        native.ribbonItemsEl.prepend(document.getElementById("calendar"));
        window.addEventListener("mouseup", () => {
          native.items = Array.from(native.ribbonItemsEl.children,buttonEl => native.items.find(item => item.buttonEl===buttonEl));
          native.onChange(true);
        }, {once:true});
      });
      await page.waitForTimeout(30);
      assert.deepEqual(await orderIds(), ["calendar", "late", "long-label"]);
      await page.mouse.up();
      await page.waitForFunction(() => saved.ribbonOrder[0] === "calendar");
      assert.deepEqual(await page.evaluate(() => saved.ribbonOrder), ["calendar", "late", "long-label"]);
      assert.equal(await page.evaluate(() => orderWrites.length), 1);
      await page.evaluate(() => {
        order.destroy(); native.items = native.items.filter(item=>item.id!=="late"); native.onChange(false);
        window.order = new FixtureOrder.RibbonOrder(document.querySelector(".workspace"), () => native,
          () => saved, patch => {orderWrites.push(patch);Object.assign(saved,patch);});
        order.refresh(); native.items.push({id:"late",buttonEl:late}); native.onChange(false);
      });
      await page.waitForFunction(() => native.ribbonItemsEl.children[1].id === "late");
      assert.deepEqual(await orderIds(), ["calendar", "late", "long-label"]);
      await page.evaluate(() => {order.destroy();rail.destroy();native.items.reverse();native.onChange(false);});
      await page.waitForTimeout(30);
      assert.deepEqual(await orderIds(), ["long-label", "late", "calendar"]);
      console.log(JSON.stringify({theme, orderRestored:true, nativeMouseCommitSaved:true, lateReloadRestored:true, orderUnloadClean:true}));
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });