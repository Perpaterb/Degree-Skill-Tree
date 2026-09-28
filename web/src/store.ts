import { create } from 'zustand';
import {
  compatibility,
  computeStates,
  decodePlan,
  emptyPlan,
  encodePlan,
  programLocks,
  programProgress,
  progress,
  progressStatus,
  titleCp,
  type Fit,
  type Lock,
  type NodeState,
  type Plan,
  type Status,
  type TitleCp,
} from '../../core/engine';
import { layoutMap, type Layout } from '../../core/layout';
import { chosenDegrees, degreeLocks, pairingLocks } from '../../core/pairs';
import type { MapDoc } from '../../core/model';
import { track } from './analytics';
import { setThemeColours } from './theme';
import { loadMode, loadTheme, loadView, saveMode, saveTheme, saveView, type MapMode, type ThemeName, type ViewSettings } from './view';

export interface MapIndexEntry {
  id: string;
  institution: string;
  year: string;
  degrees: { code: string; title: string }[];
}

type Mark = 'completed' | 'planned' | 'none';

interface AppState {
  index: MapIndexEntry[];
  map: MapDoc | null;
  layout: Layout | null;
  plan: Plan;
  states: Map<string, NodeState>;
  fits: Map<string, Fit>;
  /** How far each degree and program circle has got, for its glow (US-026). */
  finish: Map<string, Status>;
  /** Credit points on each degree and program circle's title (US-028). */
  titles: Map<string, TitleCp>;
  /** Majors and sub-majors that can no longer count towards the selected degree, and why (US-037, US-048). */
  locks: Map<string, Lock>;
  /** Degrees that cannot be chosen with the current choice, and why (US-047, US-049). */
  degreeLocks: Map<string, string>;
  view: ViewSettings;
  theme: ThemeName;
  /** Static or Dynamic map (US-053). */
  mode: MapMode;
  /** The degree, half or program chosen most recently: the centre in Dynamic mode (US-055). */
  last: string | null;
  /** The subject, program or degree shown in the detail panel. */
  selected: string | null;
  /**
   * The copy of a subject clicked on the map, or flown to ("<circle>/<code>"): the circles it sits in
   * are the layers above the detail card (US-052).
   */
  copy: string | null;
  hovered: string | null;
  hoveredCircle: string | null;
  /** Circles and subjects to glow, e.g. while a progress row is hovered. */
  glow: string[];
  search: string;
  matches: string[];
  loadError: string | null;
  /** Bumped when the camera should fly to `selected`. */
  flyTo: number;

  loadIndex(): Promise<void>;
  loadMap(id: string, plan?: Plan): Promise<void>;
  select(code: string | null, fly?: boolean): void;
  hover(code: string | null): void;
  hoverCircle(id: string | null): void;
  setGlow(ids: string[]): void;
  selectDegree(code: string | null): void;
  mark(code: string, mark: Mark): void;
  toggleProgram(code: string): void;
  setSearch(q: string): void;
  resetPlan(): void;
  setView(patch: Partial<ViewSettings>): void;
  setTheme(t: ThemeName): void;
  setMode(m: MapMode): void;
}

const base = import.meta.env.BASE_URL;
const storageKey = (mapId: string) => `dst.plan.${mapId}`;
export const DEFAULT_MAP = 'uts-2027';

/** Links made before the multi-degree map named one degree's tree, e.g. "uts-2027-C10148". */
export function resolveMapId(id: string): { mapId: string; degree: string | null } {
  const m = id.match(/^([a-z]+-\d{4})-([A-Z]\d{5})$/);
  return m ? { mapId: m[1], degree: m[2] } : { mapId: id, degree: null };
}

function savePlan(mapId: string, plan: Plan) {
  try {
    localStorage.setItem(storageKey(mapId), encodePlan(plan));
  } catch {
    // Private mode or storage disabled: the URL still carries the plan.
  }
  const hash = `#t=${mapId}${encodePlan(plan) ? '&' + encodePlan(plan) : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function readStoredPlan(mapId: string): Plan | null {
  try {
    const s = localStorage.getItem(storageKey(mapId));
    return s === null ? null : decodePlan(s);
  } catch {
    return null;
  }
}

function matchesFor(map: MapDoc, q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => x.toLowerCase().includes(needle));
  const degrees = Object.values(map.degrees).filter((d) => has(d.code, d.title)).map((d) => d.code);
  const programs = Object.values(map.programs).filter((p) => has(p.code, p.title)).map((p) => p.code);
  const subjects = Object.values(map.subjects).filter((s) => has(s.code, s.title) || strip(s.description).includes(needle));
  // Code and title matches first, then description-only matches.
  subjects.sort((a, b) => Number(has(b.code, b.title)) - Number(has(a.code, a.title)));
  return [...degrees, ...programs, ...subjects.map((s) => s.code)];
}

function derive(map: MapDoc, plan: Plan) {
  const fits = new Map(Object.keys(map.degrees).map((d) => [d, compatibility(map, d, plan)]));
  const locks = new Map<string, Lock>([
    ...(plan.degree && map.degrees[plan.degree] ? programLocks(map, plan.degree, plan).locks : []),
    // What a double adds to a half, until that double is chosen; programs the chosen double drops (US-048).
    ...pairingLocks(map, plan),
  ]);
  const finish = new Map<string, Status>([
    ...Object.keys(map.degrees).map((d) => [d, progressStatus(progress(map, d, plan))] as const),
    // A program locked out of the selected degree never glows, however much of it is done (US-037).
    ...Object.keys(map.programs).map((p) => [p, locks.has(p) ? 'none' : progressStatus(programProgress(map, p, plan))] as const),
  ]);
  const titles = new Map<string, TitleCp>();
  for (const id of [...Object.keys(map.degrees), ...Object.keys(map.programs)]) {
    const t = titleCp(map, id, plan);
    if (t) titles.set(id, t);
  }
  return { states: computeStates(map, plan), fits, finish, titles, locks, degreeLocks: degreeLocks(map, plan.degree) };
}

function applyTheme(t: ThemeName) {
  setThemeColours(t);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
}

const initialTheme = loadTheme();
applyTheme(initialTheme);

export const useApp = create<AppState>((set, get) => ({
  index: [],
  map: null,
  layout: null,
  plan: emptyPlan(),
  states: new Map(),
  fits: new Map(),
  finish: new Map(),
  titles: new Map(),
  locks: new Map(),
  degreeLocks: new Map(),
  view: loadView(),
  theme: initialTheme,
  mode: loadMode(),
  last: null,
  selected: null,
  copy: null,
  hovered: null,
  hoveredCircle: null,
  glow: [],
  search: '',
  matches: [],
  loadError: null,
  flyTo: 0,

  async loadIndex() {
    const res = await fetch(`${base}trees/index.json`);
    set({ index: await res.json() });
  },

  async loadMap(id, plan) {
    const { mapId, degree } = resolveMapId(id);
    if (!/^[A-Za-z0-9-]+$/.test(mapId)) return set({ loadError: `Unknown map "${id}"` });
    try {
      const res = await fetch(`${base}trees/${mapId}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map: MapDoc = await res.json();
      const p = plan ?? readStoredPlan(mapId) ?? emptyPlan();
      if (degree && !p.degree) p.degree = degree;
      // Codes that are not on this map cannot be shown or evaluated; drop them.
      p.completed = p.completed.filter((c) => map.subjects[c]);
      p.planned = p.planned.filter((c) => map.subjects[c]);
      p.programs = p.programs.filter((c) => map.programs[c]);
      if (p.degree && !map.degrees[p.degree]) p.degree = null;
      set({ map, layout: map.layout ?? layoutMap(map), plan: p, ...derive(map, p), selected: null, glow: [], loadError: null });
      savePlan(mapId, p);
      track('course_opened', { tree: mapId });
    } catch (e) {
      set({ loadError: `Could not load ${mapId}: ${(e as Error).message}` });
    }
  },

  select(code, fly = false) {
    set((s) => ({ selected: code, flyTo: fly ? s.flyTo + 1 : s.flyTo }));
    if (code) track('node_inspected', { code });
  },

  hover(code) {
    if (get().hovered !== code) set({ hovered: code });
  },

  hoverCircle(id) {
    if (get().hoveredCircle !== id) set({ hoveredCircle: id });
  },

  setGlow(ids) {
    set({ glow: ids });
  },

  selectDegree(code) {
    const { map, plan } = get();
    if (!map || plan.degree === code) return;
    const next = { ...plan, degree: code };
    // The degree just added (the second half of a double, when one is made) is the newest choice.
    const before = chosenDegrees(map, plan.degree);
    const added = chosenDegrees(map, code).filter((d) => !before.includes(d));
    set({ plan: next, ...derive(map, next), glow: [], ...(added.length ? { last: added[added.length - 1] } : {}) });
    savePlan(map.id, next);
    if (code) track('degree_selected', { code });
  },

  mark(code, mark) {
    const { map, plan } = get();
    if (!map) return;
    const next: Plan = {
      ...plan,
      completed: plan.completed.filter((c) => c !== code),
      planned: plan.planned.filter((c) => c !== code),
    };
    if (mark === 'completed') next.completed.push(code);
    if (mark === 'planned') next.planned.push(code);
    set({ plan: next, ...derive(map, next) });
    savePlan(map.id, next);
    track('subject_marked', { code, mark });
  },

  toggleProgram(code) {
    const { map, plan } = get();
    if (!map) return;
    const adding = !plan.programs.includes(code);
    const programs = adding ? [...plan.programs, code] : plan.programs.filter((c) => c !== code);
    const next = { ...plan, programs };
    // A chosen program changes how a degree's options are counted, so its glow too.
    set({ plan: next, ...derive(map, next), ...(adding ? { last: code } : {}) });
    savePlan(map.id, next);
    track('program_toggled', { code });
  },

  setSearch(q) {
    const { map } = get();
    set({ search: q, matches: map ? matchesFor(map, q) : [] });
  },

  resetPlan() {
    const { map } = get();
    if (!map) return;
    const p = emptyPlan();
    set({ plan: p, ...derive(map, p) });
    savePlan(map.id, p);
  },

  setView(patch) {
    const view = { ...get().view, ...patch };
    set({ view });
    saveView(view);
  },

  setTheme(t) {
    applyTheme(t);
    set({ theme: t });
    saveTheme(t);
  },

  setMode(m) {
    set({ mode: m });
    saveMode(m);
  },
}));
