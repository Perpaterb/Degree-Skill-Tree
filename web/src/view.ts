// View settings (US-029) and the light / dark theme (US-030). Kept in this browser only, never in
// the plan link.

export interface ViewSettings {
  /** Map text scales with zoom, between a minimum and maximum on-screen size. */
  grow: boolean;
  /** Relative text size, 0.5 to 2 (shown as 50% to 200%). */
  textSize: number;
  /** Credit points after circle titles (US-028). */
  showCp: boolean;
}

export type ThemeName = 'dark' | 'light';

export const defaultView: ViewSettings = { grow: true, textSize: 1, showCp: true };
export const TEXT_SIZE_MIN = 0.5;
export const TEXT_SIZE_MAX = 2;

export type TextKind = 'area' | 'degree' | 'program' | 'subject';

/** On-screen font sizes in CSS pixels, at 100%: the bounds while growing with zoom, and the size when not. */
export const TEXT_PX: Record<TextKind, { min: number; max: number; fixed: number }> = {
  area: { min: 22, max: 110, fixed: 30 },
  degree: { min: 16, max: 72, fixed: 26 },
  program: { min: 10, max: 34, fixed: 15 },
  subject: { min: 6, max: 22, fixed: 12 },
};

/**
 * The on-screen size for map text whose natural size (its world font size times the zoom) is
 * `natural` pixels. Growing: the natural size, kept within the bounds, times the text size. Not
 * growing: one size at every zoom, times the text size.
 */
export function textPx(kind: TextKind, natural: number, view: ViewSettings): number {
  const b = TEXT_PX[kind];
  const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, view.textSize));
  return (view.grow ? Math.min(b.max, Math.max(b.min, natural)) : b.fixed) * size;
}

const VIEW_KEY = 'dst.view';
const THEME_KEY = 'dst.theme';

export function loadView(): ViewSettings {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return { ...defaultView };
    const v = JSON.parse(raw) as Partial<ViewSettings>;
    return {
      grow: typeof v.grow === 'boolean' ? v.grow : defaultView.grow,
      textSize: typeof v.textSize === 'number' && Number.isFinite(v.textSize) ? Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, v.textSize)) : defaultView.textSize,
      showCp: typeof v.showCp === 'boolean' ? v.showCp : defaultView.showCp,
    };
  } catch {
    return { ...defaultView };
  }
}

export function saveView(v: ViewSettings) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked: the settings last for this visit only.
  }
}

/** The remembered theme, else the operating system's. index.html runs the same check before first paint. */
export function loadTheme(): ThemeName {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // fall through to the system setting
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function saveTheme(t: ThemeName) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}
