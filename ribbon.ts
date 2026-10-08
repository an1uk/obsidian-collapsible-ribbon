import { clampWidth, MIN_WIDTH, MAX_WIDTH, type RibbonSettings } from "./settings";
import { RibbonItems, RIBBON_SELECTOR } from "./ribbon-items";

type RailMode = "collapsed" | "overlay" | "pinned";
type SavedStyle = { value: string; priority: string };
const GROUPS = ".side-dock-actions, .side-dock-settings";
const STATE_ATTRIBUTES = ["data-cr-mode", "data-cr-animate", "data-cr-labels", "data-cr-resizing"];
const OBSERVE_OPTIONS: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ["aria-label", "aria-labelledby", "title", "data-tooltip", "data-tooltip-classes"],
};

export class RibbonRail {
  private ribbon: HTMLElement | null = null;
  private pin: HTMLButtonElement | null = null;
  private surface: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private mutation: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  private frame: number | null = null;
  private closeTimer: number | null = null;
  private notifyResize = false;
  private destroyed = false;
  private items: RibbonItems;
  private readonly styles = new Map<HTMLElement, Map<string, SavedStyle>>();
  private readonly attributes = new Map<string, string | null>();
  private readonly listeners: Array<() => void> = [];
  private hadRootClass = false;
  private hadTooltipBodyClass = false;
  private pinState: boolean | null = null;
  private open = false;
  private pointerInside = false;
  private focusInside = false;
  private actionPointer: number | null = null;
  private drag: { id: number; startX: number; width: number } | null = null;
  private previewWidth: number | null = null;
  private readonly win: Window & typeof window;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly settings: () => RibbonSettings,
    private readonly updateSettings: (patch: Partial<RibbonSettings>) => void,
    private readonly renderPin: (button: HTMLElement, pinned: boolean) => void,
    renderFallback: (icon: HTMLElement, label: string) => void,
  ) {
    this.items = new RibbonItems(renderFallback);
    const win = workspace.ownerDocument.defaultView;
    if (!win) throw new Error("Ribbon has no owning window");
    this.win = win;
  }

  private get mode(): RailMode {
    return this.settings().pinned ? "pinned" : this.open ? "overlay" : "collapsed";
  }

  refresh(): void {
    if (this.destroyed) return;
    const ribbon = this.workspace.querySelector<HTMLElement>(RIBBON_SELECTOR);
    if (ribbon !== this.ribbon) {
      this.detach();
      if (!ribbon) return;
      this.ribbon = ribbon;
      this.hadRootClass = ribbon.classList.contains("cr-ribbon");
      this.hadTooltipBodyClass = this.win.document.body.classList.contains("cr-ribbon-expanded");
      for (const name of STATE_ATTRIBUTES) this.attributes.set(name, ribbon.getAttribute(name));
      this.refreshMetrics();
      ribbon.classList.add("cr-ribbon");
      this.createControls(ribbon);
      this.mutation = new this.win.MutationObserver((records) => {
        this.items.capture(records);
        this.applySettings();
      });
      this.resize = new this.win.ResizeObserver((entries) => {
        this.notifyResize ||= entries.some((entry) => entry.target === this.ribbon);
        this.scheduleGeometry();
      });
      this.resize.observe(ribbon);
      this.resize.observe(this.surface!);
      this.listen(ribbon, "pointerover", this.onPointerOver, true);
      this.listen(ribbon, "pointerenter", this.onPointerEnter);
      this.listen(ribbon, "pointerleave", this.onPointerLeave);
      this.listen(ribbon, "focusin", this.onFocusIn);
      this.listen(ribbon, "focusout", this.onFocusOut);
      this.listen(ribbon, "pointerdown", this.onActionDown, true);
      this.listen(this.win, "pointermove", this.onPointerMove, true);
      this.listen(this.win, "pointerup", this.onPointerUp, true);
      this.listen(this.win, "pointercancel", this.onPointerCancel, true);
      this.listen(this.win, "blur", this.onBlur);
      this.listen(this.win, "resize", this.onWindowResize);
      this.focusInside = ribbon.contains(ribbon.ownerDocument.activeElement);
      this.open = this.focusInside;
    }
    this.applySettings();
  }

  refreshMetrics(): void {
    const ribbon = this.ribbon;
    if (!ribbon || this.destroyed) return;
    const mode = ribbon.getAttribute("data-cr-mode");
    ribbon.removeAttribute("data-cr-mode");
    const style = this.win.getComputedStyle(ribbon);
    const nativeWidth = Number.parseFloat(style.getPropertyValue("--ribbon-width")) || 44;
    const px = (value: string) => Number.parseFloat(value) || 0;
    const inset = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
    this.setProperty(ribbon, "--cr-native-width", nativeWidth + "px");
    this.setProperty(ribbon, "--cr-ribbon-inset", inset + "px");
    for (const group of ribbon.querySelectorAll<HTMLElement>(GROUPS)) {
      const groupStyle = this.win.getComputedStyle(group);
      const groupInset = px(groupStyle.paddingLeft) + px(groupStyle.paddingRight)
        + px(groupStyle.borderLeftWidth) + px(groupStyle.borderRightWidth);
      this.setProperty(group, "--cr-icon-column", Math.max(0, nativeWidth - inset - groupInset) + "px");
    }
    if (mode !== null) ribbon.setAttribute("data-cr-mode", mode);
    this.scheduleGeometry();
  }

  private createControls(ribbon: HTMLElement): void {
    this.pin = ribbon.createEl("button");
    this.pin.type = "button";
    this.pin.className = "clickable-icon side-dock-ribbon-action cr-pin";
    this.listen(this.pin, "click", () => {
      this.cancelClose();
      this.updateSettings({ pinned: !this.settings().pinned });
      this.scheduleClose();
    });
    this.surface = ribbon.createDiv();
    this.surface.className = "cr-overlay-background";
    this.surface.setAttribute("aria-hidden", "true");
    this.handle = ribbon.createDiv();
    this.handle.className = "cr-resize-handle";
    this.handle.tabIndex = 0;
    this.handle.setAttribute("role", "separator");
    this.handle.setAttribute("aria-label", "Ribbon width");
    this.handle.setAttribute("aria-orientation", "vertical");
    this.handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    this.handle.setAttribute("aria-valuemax", String(MAX_WIDTH));
    this.listen(this.handle, "pointerdown", this.onResizeDown);
    this.listen(this.handle, "lostpointercapture", this.onPointerCancel);
    this.listen(this.handle, "keydown", this.onHandleKey);
    this.ribbon!.append(this.surface, this.handle);
  }

  applySettings(): void {
    const ribbon = this.ribbon;
    if (!ribbon || this.destroyed) return;
    // Drain pending external metadata first, then exclude our own title/ARIA writes.
    this.items.capture(this.mutation?.takeRecords() ?? []);
    this.mutation?.disconnect();
    try {
      for (const [element, properties] of this.styles) {
        if (element !== ribbon && !ribbon.contains(element)) {
          this.restoreStyles(element, properties);
          this.styles.delete(element);
        }
      }
      if (Array.from(ribbon.querySelectorAll<HTMLElement>(GROUPS)).some((group) => !this.styles.has(group))) {
        this.refreshMetrics();
      }
      // Removing a focused action need not emit focusout; do not retain a stale focus hold.
      if (this.focusInside && !ribbon.contains(ribbon.ownerDocument.activeElement)) {
        this.focusInside = false;
        this.scheduleClose();
      }
      const bottom = ribbon.querySelector<HTMLElement>(".side-dock-settings");
      if (bottom && this.pin && bottom.lastElementChild !== this.pin) bottom.append(this.pin);
      if (this.surface?.parentElement !== ribbon) ribbon.append(this.surface!);
      if (this.handle?.parentElement !== ribbon) ribbon.append(this.handle!);
      const settings = this.settings();
      const width = this.previewWidth ?? settings.expandedWidth;
      this.setProperty(ribbon, "--cr-expanded-width", width + "px");
      ribbon.setAttribute("data-cr-mode", this.mode);
      ribbon.setAttribute("data-cr-animate", String(settings.animate));
      ribbon.setAttribute("data-cr-labels", String(settings.showLabels));
      ribbon.setAttribute("data-cr-resizing", String(this.drag !== null));
      if (this.pin && this.pinState !== settings.pinned) {
        this.pinState = settings.pinned;
        this.renderPin(this.pin, settings.pinned);
        // Mark this control's tooltips too, without adding a visible row label.
        this.pin.setAttribute("data-tooltip-classes", "cr-ribbon-tooltip");
        this.pin.setAttribute("aria-pressed", String(settings.pinned));
      }
      this.pin?.setAttribute("aria-expanded", String(this.mode !== "collapsed"));
      this.handle?.setAttribute("aria-valuenow", String(width));
      this.handle?.setAttribute("aria-valuetext", width + " pixels");
      this.win.document.body.classList.toggle("cr-ribbon-expanded", this.mode !== "collapsed");
      this.items.sync(ribbon, this.mode !== "collapsed");
      this.updateGeometry();
    } finally {
      this.mutation?.observe(ribbon, OBSERVE_OPTIONS);
    }
  }

  private readonly onPointerOver = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === "touch") return;
    const target = event.target as Element | null;
    const action = target?.closest?.(".side-dock-ribbon-action");
    if (!action || !this.ribbon?.contains(action)) return;
    // Capture runs before Obsidian's body-level delegated tooltip handler.
    this.pointerInside = true;
    this.openRail();
  };
  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    if (this.open) this.cancelClose();
  };
  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.scheduleClose();
  };
  private readonly onFocusIn = (): void => {
    this.focusInside = true;
    this.openRail();
  };
  private readonly onFocusOut = (event: Event): void => {
    this.focusInside = !!this.ribbon?.contains((event as FocusEvent).relatedTarget as Node | null);
    this.scheduleClose();
  };
  private readonly onActionDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    const action = (event.target as Element | null)?.closest?.(".side-dock-ribbon-action:not(.cr-pin)");
    if (pointer.button === 0 && action && this.ribbon?.contains(action)) this.actionPointer = pointer.pointerId;
  };
  private readonly onResizeDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0 || this.drag) return;
    pointer.preventDefault();
    this.cancelClose();
    this.drag = { id: pointer.pointerId, startX: pointer.clientX, width: this.settings().expandedWidth };
    this.previewWidth = this.drag.width;
    this.handle?.focus();
    try { this.handle?.setPointerCapture(pointer.pointerId); } catch { /* Window listeners also cover lost capture. */ }
    this.applySettings();
  };
  private readonly onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.drag?.id !== pointer.pointerId) return;
    this.previewWidth = clampWidth(this.drag.width + pointer.clientX - this.drag.startX);
    this.applySettings();
  };
  private readonly onPointerUp = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.drag?.id === pointer.pointerId) this.finishResize(true);
    if (this.actionPointer === pointer.pointerId) this.actionPointer = null;
    this.pointerInside = this.containsPoint(pointer.clientX, pointer.clientY);
    this.scheduleClose();
  };
  private readonly onPointerCancel = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.drag?.id === pointer.pointerId) this.finishResize(false);
    if (this.actionPointer === pointer.pointerId) this.actionPointer = null;
    this.scheduleClose();
  };
  private readonly onHandleKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (this.drag) return;
    const width = this.settings().expandedWidth;
    const step = key.shiftKey ? 10 : 1;
    const next = key.key === "ArrowLeft" ? width - step : key.key === "ArrowRight" ? width + step
      : key.key === "Home" ? MIN_WIDTH : key.key === "End" ? MAX_WIDTH : null;
    if (next === null) return;
    key.preventDefault();
    this.updateSettings({ expandedWidth: clampWidth(next) });
  };
  private readonly onBlur = (): void => {
    this.actionPointer = null;
    this.pointerInside = false;
    this.focusInside = false;
    this.finishResize(false);
    this.scheduleClose();
  };
  private readonly onWindowResize = (): void => this.scheduleGeometry();

  private finishResize(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    const width = this.previewWidth ?? drag.width;
    this.drag = null;
    this.previewWidth = null;
    try {
      if (this.handle?.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    } catch { /* Capture may already have been released by the browser. */ }
    if (commit) this.updateSettings({ expandedWidth: width });
    else this.applySettings();
  }

  private openRail(): void {
    this.cancelClose();
    if (this.open) return;
    this.open = true;
    this.applySettings();
  }

  private cancelClose(): void {
    if (this.closeTimer !== null) this.win.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private scheduleClose(): void {
    this.cancelClose();
    if (this.settings().pinned || !this.open || this.pointerInside || this.focusInside || this.drag || this.actionPointer !== null) return;
    this.closeTimer = this.win.setTimeout(() => {
      this.closeTimer = null;
      if (this.destroyed || this.settings().pinned || this.pointerInside || this.focusInside || this.drag || this.actionPointer !== null) return;
      this.open = false;
      this.applySettings();
    }, 180);
  }

  private containsPoint(x: number, y: number): boolean {
    const rect = (this.mode === "overlay" ? this.surface : this.ribbon)?.getBoundingClientRect();
    return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  private scheduleGeometry(): void {
    if (this.destroyed || !this.ribbon || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      this.updateGeometry();
      if (this.notifyResize) {
        this.notifyResize = false;
        this.win.dispatchEvent(new this.win.Event("resize"));
      }
    });
  }

  private updateGeometry(): void {
    const ribbon = this.ribbon;
    if (!ribbon) return;
    const rect = ribbon.getBoundingClientRect();
    this.setProperty(ribbon, "--cr-left", rect.left + "px");
    this.setProperty(ribbon, "--cr-top", rect.top + "px");
    this.setProperty(ribbon, "--cr-height", rect.height + "px");
    const width = this.mode === "pinned" ? rect.width : this.surface?.getBoundingClientRect().width ?? 0;
    this.setProperty(ribbon, "--cr-visual-width", width + "px");
  }

  private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    this.listeners.push(() => target.removeEventListener(type, handler, capture));
  }

  private setProperty(element: HTMLElement, name: string, value: string): void {
    let saved = this.styles.get(element);
    if (!saved) {
      saved = new Map<string, SavedStyle>();
      this.styles.set(element, saved);
    }
    if (!saved.has(name)) saved.set(name, {
      value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
    });
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }

  private restoreStyles(element: HTMLElement, properties: Map<string, SavedStyle>): void {
    for (const [name, original] of properties) {
      if (original.value) element.style.setProperty(name, original.value, original.priority);
      else element.style.removeProperty(name);
    }
  }

  private detach(): void {
    this.items.capture(this.mutation?.takeRecords() ?? []);
    this.mutation?.disconnect();
    this.resize?.disconnect();
    this.mutation = null;
    this.resize = null;
    this.cancelClose();
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.notifyResize = false;
    for (const remove of this.listeners.splice(0)) remove();
    const drag = this.drag;
    this.drag = null;
    try {
      if (drag && this.handle?.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    } catch { /* The containing window may already have released capture. */ }
    this.previewWidth = null;
    this.items.destroy();
    this.pin?.remove();
    this.surface?.remove();
    this.handle?.remove();
    this.pin = null;
    this.surface = null;
    this.handle = null;
    this.pinState = null;
    this.open = false;
    this.pointerInside = false;
    this.focusInside = false;
    this.actionPointer = null;
    for (const [element, properties] of this.styles) this.restoreStyles(element, properties);
    this.styles.clear();
    if (this.ribbon) {
      this.win.document.body.classList.toggle("cr-ribbon-expanded", this.hadTooltipBodyClass);
      if (!this.hadRootClass) this.ribbon.classList.remove("cr-ribbon");
      for (const [name, value] of this.attributes) {
        if (value === null) this.ribbon.removeAttribute(name);
        else this.ribbon.setAttribute(name, value);
      }
      this.win.dispatchEvent(new this.win.Event("resize"));
    }
    this.attributes.clear();
    this.ribbon = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
  }
}