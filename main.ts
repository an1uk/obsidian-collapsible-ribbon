import { Plugin, PluginSettingTab, Setting, Notice, setIcon, setTooltip } from "obsidian";
import { RibbonRail } from "./ribbon";
import { DEFAULT_SETTINGS, normalizeSettings, type RibbonSettings } from "./settings";

export default class CollapsibleRibbonPlugin extends Plugin {
  settings: RibbonSettings = { ...DEFAULT_SETTINGS };
  private rail: RibbonRail | null = null;
  private active = false;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = normalizeSettings(saved);
    this.active = true;
    if (saved?.settingsVersion !== 2) this.updateSettings({});
    this.rail = new RibbonRail(
      this.app.workspace.containerEl,
      () => this.settings,
      (patch) => this.updateSettings(patch),
      (button, pinned) => {
        setIcon(button, pinned ? "pin-off" : "pin");
        setTooltip(button, pinned ? "Unpin ribbon" : "Pin ribbon open", { placement: "right" });
      },
      (icon, label) => setIcon(icon, /\b(?:kanban|board)\b/i.test(label) ? "kanban" : "circle-help"),
    );
    this.addSettingTab(new RibbonSettingTab(this));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.rail?.refresh()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.rail?.refreshMetrics()));
    this.app.workspace.onLayoutReady(() => {
      // onLayoutReady has no unsubscribe API; guard a plugin disabled during startup.
      if (this.active) this.rail?.refresh();
    });
  }

  updateSettings(patch: Partial<RibbonSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.rail?.applySettings();
    const snapshot = { ...this.settings };
    // Serialize writes so rapid clicks cannot persist an older state last.
    this.saveQueue = this.saveQueue.then(() => this.saveData(snapshot)).catch((error: unknown) => {
      console.error("Collapsible Ribbon: could not save settings", error);
      if (this.active) new Notice("Collapsible Ribbon could not save settings. Check the developer console.");
    });
  }

  onunload(): void {
    this.active = false;
    this.rail?.destroy();
    this.rail = null;
  }
}

class RibbonSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: CollapsibleRibbonPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Expanded ribbon width")
      .setDesc("Width in pixels, from 120 to 300. Default: 220. You can also drag the rail’s right edge.")
      .addSlider((slider) => slider.setLimits(120, 300, 1)
        .setValue(this.plugin.settings.expandedWidth).setDynamicTooltip()
        .onChange((expandedWidth) => this.plugin.updateSettings({ expandedWidth })));
    new Setting(this.containerEl)
      .setName("Animate transitions")
      .setDesc("Use a subtle width transition. Respects reduced motion preferences.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.animate)
        .onChange((animate) => this.plugin.updateSettings({ animate })));
    new Setting(this.containerEl)
      .setName("Show labels when expanded")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showLabels)
        .onChange((showLabels) => this.plugin.updateSettings({ showLabels })));
  }
}
