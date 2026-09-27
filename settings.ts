export interface RibbonSettings {
  settingsVersion: 2;
  pinned: boolean;
  expandedWidth: number;
  animate: boolean;
  showLabels: boolean;
}

export const MIN_WIDTH = 120;
export const MAX_WIDTH = 300;
export const DEFAULT_SETTINGS: RibbonSettings = {
  settingsVersion: 2,
  pinned: false,
  expandedWidth: 220,
  animate: true,
  showLabels: true,
};

export function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export function normalizeSettings(data: unknown): RibbonSettings {
  const saved = data && typeof data === "object"
    ? data as Partial<RibbonSettings> : {};
  const current = saved.settingsVersion === 2;
  return {
    settingsVersion: 2,
    pinned: current && typeof saved.pinned === "boolean" ? saved.pinned : false,
    expandedWidth: current && typeof saved.expandedWidth === "number" && Number.isFinite(saved.expandedWidth)
      ? clampWidth(saved.expandedWidth) : DEFAULT_SETTINGS.expandedWidth,
    animate: typeof saved.animate === "boolean" ? saved.animate : true,
    showLabels: typeof saved.showLabels === "boolean" ? saved.showLabels : true,
  };
}