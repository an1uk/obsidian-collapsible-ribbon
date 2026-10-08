import { Plugin, PluginSettingTab, Notice, setIcon, setTooltip, type SettingDefinitionItem } from "obsidian";
import { isRecord, isUnknownArray } from "./guards";
import { RibbonOrder } from "./ribbon-order";
import { RibbonRail } from "./ribbon";
import { DEFAULT_SETTINGS, normalizeSettings, type RibbonSettings } from "./settings";

export default class CollapsibleRibbonPlugin extends Plugin {
  settings: RibbonSettings = { ...DEFAULT_SETTINGS };
  private rail: RibbonRail | null = null;
  private order: RibbonOrder | null = null;
  private layoutReady = false;
  private active = false;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = normalizeSettings(saved);
    this.active = true;
    if (!isRecord(saved) || saved.settingsVersion !== 2) this.updateSettings({});
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
    this.order = new RibbonOrder(
      this.app.workspace.containerEl,
      () => this.app.workspace.leftRibbon,
      () => this.settings,
      (patch) => this.updateSettings(patch),
      () => this.refreshNativeRibbonSettings(),
    );
    this.addSettingTab(new RibbonSettingTab(this));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.rail?.refresh();
      if (this.layoutReady) this.order?.refresh();
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.rail?.refreshMetrics()));
    this.app.workspace.onLayoutReady(() => {
      // onLayoutReady has no unsubscribe API; guard a plugin disabled during startup.
      if (this.active) {
        this.layoutReady = true;
        this.rail?.refresh();
        this.order?.refresh();
      }
    });
  }

  private refreshNativeRibbonSettings(): void {
    if (!this.active) return;
    // Native settings cache page definitions even while closed; update through their own renderer.
    const app: unknown = this.app;
    if (!isRecord(app) || !isRecord(app.setting) || !isUnknownArray(app.setting.settingTabs)) return;
    const tab = app.setting.settingTabs.find(isInterfaceTab);
    tab?.update();
  }

  updateSettings(patch: Partial<RibbonSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.rail?.applySettings();
    const snapshot = { ...this.settings };
    // Serialize writes so rapid clicks cannot persist an older state last.
    this.saveQueue = this.saveQueue.then(() => this.saveData(snapshot)).catch((error: unknown) => {
      console.error("Collapsible Ribbon: could not save settings", error);
      if (this.active) new Notice("Could not save ribbon settings. Check the developer console.");
    });
  }

  onunload(): void {
    this.active = false;
    this.order?.destroy();
    this.order = null;
    this.layoutReady = false;
    this.rail?.destroy();
    this.rail = null;
  }
}

interface InterfaceTab {
  id: "interface";
  update: (this: InterfaceTab) => void;
}

function isInterfaceTab(value: unknown): value is InterfaceTab {
  return isRecord(value) && value.id === "interface" && typeof value.update === "function";
}

type RibbonSettingKey = "expandedWidth" | "animate" | "showLabels";

class RibbonSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: CollapsibleRibbonPlugin) {
    super(plugin.app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem<RibbonSettingKey>[] {
    return [
      {
        name: "Expanded ribbon width",
        desc: "Width in pixels, from 120 to 300. Default: 220. You can also drag the rail’s right edge.",
        control: { type: "slider", key: "expandedWidth", min: 120, max: 300, step: 1,
          defaultValue: DEFAULT_SETTINGS.expandedWidth, displayFormat: (value) => value + " px" },
      },
      {
        name: "Animate transitions",
        desc: "Use a subtle width transition. Respects reduced motion preferences.",
        control: { type: "toggle", key: "animate", defaultValue: DEFAULT_SETTINGS.animate },
      },
      {
        name: "Show labels when expanded",
        control: { type: "toggle", key: "showLabels", defaultValue: DEFAULT_SETTINGS.showLabels },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "expandedWidth" || key === "animate" || key === "showLabels") return this.plugin.settings[key];
    return undefined;
  }

  override setControlValue(key: string, value: unknown): void {
    if (key === "expandedWidth" && typeof value === "number" && Number.isFinite(value)) {
      this.plugin.updateSettings({ expandedWidth: value });
    } else if ((key === "animate" || key === "showLabels") && typeof value === "boolean") {
      this.plugin.updateSettings({ [key]: value });
    }
  }
}
