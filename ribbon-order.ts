import { RIBBON_SELECTOR } from "./ribbon-items";
import type { RibbonSettings } from "./settings";

interface NativeItem { id: string; buttonEl?: HTMLElement; hidden?: boolean; title?: string; icon?: string; }
interface NativeRibbon {
  containerEl: HTMLElement;
  ribbonItemsEl: HTMLElement;
  items: NativeItem[];
  onChange(save: boolean, ...args: unknown[]): unknown;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

// Retain slots for temporarily absent plugins, including those not loaded this session.
function mergeOrder(saved: string[], current: string[]): string[] {
  const present = new Set(current);
  const known = new Set(saved);
  const reordered = current.filter((id) => known.has(id));
  let index = 0;
  return saved.map((id) => present.has(id) ? reordered[index++]! : id)
    .concat(current.filter((id) => !known.has(id)));
}

export class RibbonOrder {
  private ribbon: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private gesture = false;
  private restoring = false;
  private refreshTimer: number | null = null;
  private settingsSnapshot: string | null = null;
  private hook: { target: NativeRibbon; release: () => void } | null = null;
  private timer: number | null = null;
  private destroyed = false;
  private readonly win: Window & typeof globalThis;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly nativeRibbon: () => unknown,
    private readonly settings: () => RibbonSettings,
    private readonly save: (patch: Partial<RibbonSettings>) => void,
    private readonly refreshSettings: () => void = () => {},
  ) {
    this.win = workspace.ownerDocument.defaultView as Window & typeof globalThis;
  }

  // Obsidian has no public ordering API. Fail closed if its native structure changes.
  private native(): NativeRibbon | null {
    const value = this.nativeRibbon() as Partial<NativeRibbon> | null | undefined;
    const group = this.ribbon?.querySelector<HTMLElement>(".side-dock-actions");
    if (!group || !value || value.containerEl !== this.ribbon
      || value.ribbonItemsEl !== group
      || typeof value.onChange !== "function" || !Array.isArray(value.items)) return null;
    const ids = new Set<string>();
    for (const item of value.items) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) return null;
      if (item.buttonEl && (item.buttonEl.ownerDocument !== this.workspace.ownerDocument
        || typeof item.buttonEl.matches !== "function" || !item.buttonEl.matches(".side-dock-ribbon-action")
        || (item.buttonEl.parentElement && item.buttonEl.parentElement !== value.ribbonItemsEl))) return null;
      ids.add(item.id);
    }
    const buttons = new Set(value.items.map((item) => item.buttonEl));
    if (Array.from(group.children).some((node) => !buttons.has(node as HTMLElement))) return null;
    return value as NativeRibbon;
  }

  private bind(native: NativeRibbon): boolean {
    if (this.hook?.target === native) return true;
    this.hook?.release();
    this.hook = null;
    const descriptor = Object.getOwnPropertyDescriptor(native, "onChange");
    if (descriptor && (!("value" in descriptor) || (!descriptor.configurable && !descriptor.writable))) return false;
    if (!descriptor && !Object.isExtensible(native)) return false;
    const original = native.onChange;
    const controller = this;
    let active = true;
    const wrapper = function(this: NativeRibbon, save: boolean, ...args: unknown[]): unknown {
      const result = original.call(this, save, ...args);
      if (active && !controller.destroyed && !controller.restoring && this === native) {
        try {
          if (controller.native() !== native) return result;
          if (save === true) {
            const order = mergeOrder(controller.settings().ribbonOrder, native.items.map((item) => item.id));
            if (!same(order, controller.settings().ribbonOrder)) controller.save({ ribbonOrder: order });
          }
          controller.restore();
        } catch (error) {
          // Compatibility failures must not change the native method's return or errors.
          console.error("Collapsible Ribbon: could not synchronize ribbon order", error);
        }
      }
      return result;
    };
    Object.defineProperty(native, "onChange", descriptor ? { ...descriptor, value: wrapper }
      : { value: wrapper, writable: true, configurable: true });
    this.hook = { target: native, release: () => {
      active = false;
      // An outer wrapper from another plugin may still delegate to ours after unload.
      if (native.onChange !== wrapper) return;
      if (descriptor) Object.defineProperty(native, "onChange", descriptor);
      else delete (native as Partial<NativeRibbon>).onChange;
    } };
    return true;
  }

  private scheduleSettingsRefresh(): void {
    if (this.destroyed || this.gesture || this.timer !== null || this.refreshTimer !== null) return;
    const native = this.native();
    if (!native || this.snapshot(native) === this.settingsSnapshot) return;
    this.refreshTimer = this.win.setTimeout(() => {
      this.refreshTimer = null;
      const current = this.native();
      if (this.destroyed || this.gesture || this.timer !== null || !current) return;
      const snapshot = this.snapshot(current);
      if (snapshot === this.settingsSnapshot) return;
      this.settingsSnapshot = snapshot;
      try { this.refreshSettings(); }
      catch (error) { console.error("Collapsible Ribbon: could not refresh native ribbon settings", error); }
    }, 0);
  }

  private snapshot(native: NativeRibbon): string {
    return JSON.stringify(native.items.map((item) => [item.id, item.hidden, item.title, item.icon]));
  }

  refresh(): void {
    if (this.destroyed) return;
    const ribbon = this.workspace.querySelector<HTMLElement>(RIBBON_SELECTOR);
    if (ribbon !== this.ribbon) {
      this.detach();
      this.ribbon = ribbon;
      if (!ribbon) return;
      this.observer = new this.win.MutationObserver(() => this.restore());
      this.observer.observe(ribbon, { childList: true, subtree: true });
      ribbon.addEventListener("mousedown", this.begin, true);
      this.win.addEventListener("mouseup", this.end, true);
      this.win.addEventListener("blur", this.cancel);
    }
    this.restore();
  }

  private restore(): void {
    if (this.destroyed || this.restoring || this.gesture || this.timer !== null) return;
    const native = this.native();
    if (!native || !this.bind(native)) return;
    const current = native.items.map((item) => item.id);
    const saved = this.settings().ribbonOrder;
    const order = saved.concat(current.filter((id) => !saved.includes(id)));
    const rank = new Map(order.map((id, index) => [id, index]));
    const sorted = [...native.items].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const buttons = sorted.map((item) => item.buttonEl).filter((button): button is HTMLElement => !!button);
    const visibleNodes = Array.from(native.ribbonItemsEl.children);
    const domChanged = buttons.length !== visibleNodes.length
      || buttons.some((button, index) => button !== visibleNodes[index]);
    if (!same(current, sorted.map((item) => item.id)) || domChanged) {
      // Keep the native array itself, its item objects, hidden flags and handlers intact.
      this.restoring = true;
      try {
        native.items.splice(0, native.items.length, ...sorted);
        native.onChange(false);
      } finally { this.restoring = false; }
    }
    if (!same(saved, order)) this.save({ ribbonOrder: order });
    this.scheduleSettingsRefresh();
  }

  private readonly begin = (event: MouseEvent): void => {
    if (event.button !== 0 || this.gesture || this.timer !== null) return;
    const native = this.native();
    const action = (event.target as Element | null)?.closest?.(".side-dock-ribbon-action");
    if (!native || !native.items.some((item) => item.buttonEl === action)) return;
    this.gesture = true;
  };

  private readonly end = (): void => {
    if (!this.gesture || this.timer !== null) return;
    // Native Obsidian commits the drag in a window mouseup handler after capture.
    this.timer = this.win.setTimeout(() => {
      this.timer = null;
      this.gesture = false;
      this.restore();
    }, 0);
  };

  private readonly cancel = (): void => {
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
    this.gesture = false;
    this.restore();
  };

  private detach(): void {
    this.hook?.release();
    this.hook = null;
    if (this.refreshTimer !== null) this.win.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.settingsSnapshot = null;
    this.observer?.disconnect();
    this.observer = null;
    this.ribbon?.removeEventListener("mousedown", this.begin, true);
    this.win.removeEventListener("mouseup", this.end, true);
    this.win.removeEventListener("blur", this.cancel);
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
    this.gesture = false;
    this.ribbon = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
  }
}
