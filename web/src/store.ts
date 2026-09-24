import { create } from 'zustand';
import { compatibility, computeStates, decodePlan, emptyPlan, encodePlan, type Fit, type NodeState, type Plan } from '../../core/engine';
import { layoutMap, type Layout } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { track } from './analytics';

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
  /** The subject, program or degree shown in the detail panel. */
  selected: string | null;
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
  return { states: computeStates(map, plan), fits };
}

export const useApp = create<AppState>((set, get) => ({
  index: [],
  map: null,
  layout: null,
  plan: emptyPlan(),
  states: new Map(),
  fits: new Map(),
  selected: null,
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
    set({ plan: next, ...derive(map, next), glow: [] });
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
    const programs = plan.programs.includes(code) ? plan.programs.filter((c) => c !== code) : [...plan.programs, code];
    const next = { ...plan, programs };
    set({ plan: next });
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
}));
