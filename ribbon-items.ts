export const ACTIONS = ".side-dock-actions > .side-dock-ribbon-action, .side-dock-settings > .side-dock-ribbon-action";
export const TOOLTIP_CLASS = "cr-ribbon-tooltip";

interface ItemState {
  labelAttribute: string | null;
  title: string | null;
  tooltipClasses: string | null;
  hadTooltipClass: boolean;
  injectedAria: boolean;
  originalAria: string | null;
  fallback: HTMLElement | null;
  fallbackLabel: string | null;
}

export class RibbonItems {
  private readonly items = new Map<HTMLElement, ItemState>();

  constructor(private readonly renderFallback: (icon: HTMLElement, label: string) => void) {}

  // Called only for external mutations; the controller pauses observation for its writes.
  capture(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type !== "attributes") continue;
      const item = record.target as HTMLElement;
      const state = this.items.get(item);
      if (!state) continue;
      if (record.attributeName === "title") state.title = item.getAttribute("title");
      if (record.attributeName === "aria-label") state.injectedAria = false;
      if (record.attributeName === "data-tooltip-classes") {
        const value = item.getAttribute("data-tooltip-classes");
        state.tooltipClasses = state.hadTooltipClass || value === null ? value
          : value.split(/\s+/).filter((token) => token !== TOOLTIP_CLASS).join(" ") || null;
      }
    }
  }

  sync(ribbon: HTMLElement, expanded: boolean): void {
    const present = new Set(ribbon.querySelectorAll<HTMLElement>(ACTIONS));
    for (const [item, state] of this.items) {
      if (!present.has(item)) {
        this.restore(item, state);
        this.items.delete(item);
      }
    }
    for (const item of present) {
      if (item.classList.contains("cr-pin")) continue;
      let state = this.items.get(item);
      if (!state) {
        const classes = item.getAttribute("data-tooltip-classes");
        state = {
          labelAttribute: item.getAttribute("data-cr-label"),
          title: item.getAttribute("title"),
          tooltipClasses: classes,
          hadTooltipClass: classes?.split(/\s+/).includes(TOOLTIP_CLASS) ?? false,
          injectedAria: false,
          originalAria: null,
          fallback: null,
          fallbackLabel: null,
        };
        this.items.set(item, state);
      }
      const references = (item.getAttribute("aria-labelledby")?.trim().split(/\s+/) ?? [])
        .map((id) => item.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
      const aria = state.injectedAria ? "" : item.getAttribute("aria-label")?.trim();
      const label = (references || aria || state.title?.trim() || item.getAttribute("data-tooltip")?.trim() || "")
        .replace(/\s+/g, " ");
      this.attribute(item, "data-cr-label", label || null);
      this.syncFallback(item, state, label);
      const classes = state.tooltipClasses ?? "";
      this.attribute(item, "data-tooltip-classes", state.hadTooltipClass ? classes : (classes + " " + TOOLTIP_CLASS).trim());
      if (expanded && state.title !== null) {
        if (!references && !aria) {
          if (!state.injectedAria) state.originalAria = item.getAttribute("aria-label");
          state.injectedAria = true;
          this.attribute(item, "aria-label", label || null);
        }
        this.attribute(item, "title", null);
      } else {
        this.attribute(item, "title", state.title);
        if (state.injectedAria) {
          this.attribute(item, "aria-label", state.originalAria);
          state.injectedAria = false;
        }
      }
    }
  }

  private syncFallback(item: HTMLElement, state: ItemState, label: string): void {
    const empty = Array.from(item.childNodes).every((node) =>
      node === state.fallback || (node.nodeType === 3 && !node.textContent?.trim()));
    if (!empty) {
      state.fallback?.remove();
      state.fallback = null;
      state.fallbackLabel = null;
      return;
    }
    if (!state.fallback || state.fallback.parentElement !== item) {
      state.fallback = item.ownerDocument.createElement("span");
      state.fallback.className = "cr-fallback-icon";
      state.fallback.setAttribute("aria-hidden", "true");
      item.prepend(state.fallback);
      state.fallbackLabel = null;
    }
    if (state.fallbackLabel !== label) {
      this.renderFallback(state.fallback, label);
      state.fallbackLabel = label;
    }
  }

  private attribute(item: HTMLElement, name: string, value: string | null): void {
    if (item.getAttribute(name) === value) return;
    if (value === null) item.removeAttribute(name);
    else item.setAttribute(name, value);
  }

  private restore(item: HTMLElement, state: ItemState): void {
    state.fallback?.remove();
    this.attribute(item, "data-cr-label", state.labelAttribute);
    this.attribute(item, "data-tooltip-classes", state.tooltipClasses);
    this.attribute(item, "title", state.title);
    if (state.injectedAria) this.attribute(item, "aria-label", state.originalAria);
  }

  destroy(): void {
    for (const [item, state] of this.items) this.restore(item, state);
    this.items.clear();
  }
}