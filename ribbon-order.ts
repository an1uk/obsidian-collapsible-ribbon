import type { RibbonSettings } from "./settings";

interface NativeItem { id: string; buttonEl?: HTMLElement; }
interface NativeRibbon {
  containerEl: HTMLElement;
  ribbonItemsEl: HTMLElement;
  items: NativeItem[];
  onChange(save: boolean): void;
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
  private gesture: string[] | null = null;
  private timer: number | null = null;
  private destroyed = false;
  private readonly win: Window & typeof globalThis;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly nativeRibbon: () => unknown,
    private readonly settings: () => RibbonSettings,
    private readonly save: (patch: Partial<RibbonSettings>) => void,
  ) {
    this.win = workspace.ownerDocument.defaultView as Window & typeof globalThis;
  }

  // Obsidian has no public ordering API. Fail closed if its native structure changes.
  private native(): NativeRibbon | null {
    const value = this.nativeRibbon() as Partial<NativeRibbon> | null | undefined;
    if (!this.ribbon || !value || value.containerEl !== this.ribbon
      || value.ribbonItemsEl !== this.ribbon.querySelector(".side-dock-actions")
      || typeof value.onChange !== "function" || !Array.isArray(value.items)) return null;
    const ids = new Set<string>();
    for (const item of value.items) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) return null;
      if (item.buttonEl && (item.buttonEl.ownerDocument !== this.workspace.ownerDocument
        || !item.buttonEl.matches?.(".side-dock-ribbon-action")
        || (item.buttonEl.parentElement && item.buttonEl.parentElement !== value.ribbonItemsEl))) return null;
      ids.add(item.id);
    }
    const buttons = new Set(value.items.map((item) => item.buttonEl));
    if (Array.from(value.ribbonItemsEl!.children).some((node) => !buttons.has(node as HTMLElement))) return null;
    return value as NativeRibbon;
  }

  refresh(): void {
    if (this.destroyed) return;
    const ribbon = this.workspace.querySelector<HTMLElement>(".workspace-ribbon.mod-left");
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
    if (this.destroyed || this.gesture || this.timer !== null) return;
    const native = this.native();
    if (!native) return;
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
      native.items.splice(0, native.items.length, ...sorted);
      native.onChange(false);
    }
    if (!same(saved, order)) this.save({ ribbonOrder: order });
  }

  private readonly begin = (event: MouseEvent): void => {
    if (event.button !== 0 || this.gesture || this.timer !== null) return;
    const native = this.native();
    const action = (event.target as Element | null)?.closest?.(".side-dock-ribbon-action");
    if (!native || !native.items.some((item) => item.buttonEl === action)) return;
    this.gesture = native.items.map((item) => item.id);
  };

  private readonly end = (): void => {
    if (!this.gesture || this.timer !== null) return;
    // Native Obsidian commits the drag in a window mouseup handler after capture.
    this.timer = this.win.setTimeout(() => {
      this.timer = null;
      const before = this.gesture;
      this.gesture = null;
      const native = this.native();
      if (!before || !native) return;
      const current = native.items.map((item) => item.id);
      const previousIds = new Set(before), currentIds = new Set(current);
      if (!same(before.filter((id) => currentIds.has(id)), current.filter((id) => previousIds.has(id)))) {
        const order = mergeOrder(this.settings().ribbonOrder, current);
        if (!same(order, this.settings().ribbonOrder)) this.save({ ribbonOrder: order });
      }
      this.restore();
    }, 0);
  };

  private readonly cancel = (): void => {
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
    this.gesture = null;
    this.restore();
  };

  private detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.ribbon?.removeEventListener("mousedown", this.begin, true);
    this.win.removeEventListener("mouseup", this.end, true);
    this.win.removeEventListener("blur", this.cancel);
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
    this.gesture = null;
    this.ribbon = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
  }
}
