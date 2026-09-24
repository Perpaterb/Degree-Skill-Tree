import { create } from 'zustand';
import { computeStates, decodePlan, emptyPlan, encodePlan, type NodeState, type Plan } from '../../core/engine';
import { layoutTree, type Layout } from '../../core/layout';
import type { TreeDoc } from '../../core/model';
import { track } from './analytics';

export interface TreeIndexEntry {
  id: string;
  title: string;
  code: string;
  year: string;
  institution: string;
}

type Mark = 'completed' | 'planned' | 'none';

interface AppState {
  index: TreeIndexEntry[];
  tree: TreeDoc | null;
  layout: Layout | null;
  plan: Plan;
  states: Map<string, NodeState>;
  selected: string | null;
  hovered: string | null;
  search: string;
  matches: string[];
  loadError: string | null;
  /** Bumped when the camera should fly to `selected`. */
  flyTo: number;

  loadIndex(): Promise<void>;
  loadTree(id: string, plan?: Plan): Promise<void>;
  select(code: string | null, fly?: boolean): void;
  hover(code: string | null): void;
  mark(code: string, mark: Mark): void;
  toggleProgram(code: string): void;
  setSearch(q: string): void;
  resetPlan(): void;
}

const base = import.meta.env.BASE_URL;
const storageKey = (treeId: string) => `dst.plan.${treeId}`;

function savePlan(treeId: string, plan: Plan) {
  try {
    localStorage.setItem(storageKey(treeId), encodePlan(plan));
  } catch {
    // Private mode or storage disabled: the URL still carries the plan.
  }
  const hash = `#t=${treeId}${encodePlan(plan) ? '&' + encodePlan(plan) : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

export function readStoredPlan(treeId: string): Plan | null {
  try {
    const s = localStorage.getItem(storageKey(treeId));
    return s === null ? null : decodePlan(s);
  } catch {
    return null;
  }
}

function matchesFor(tree: TreeDoc, q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').toLowerCase();
  const hits = Object.values(tree.subjects).filter(
    (s) => s.code.toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle) || strip(s.description).includes(needle),
  );
  const progs = Object.values(tree.programs).filter((p) => p.code.toLowerCase().includes(needle) || p.title.toLowerCase().includes(needle));
  // Code and title matches first, then description-only matches.
  const strong = (t: string, c: string) => c.toLowerCase().includes(needle) || t.toLowerCase().includes(needle);
  return [...progs.map((p) => p.code), ...hits.sort((a, b) => Number(strong(b.title, b.code)) - Number(strong(a.title, a.code))).map((s) => s.code)];
}

export const useApp = create<AppState>((set, get) => ({
  index: [],
  tree: null,
  layout: null,
  plan: emptyPlan(),
  states: new Map(),
  selected: null,
  hovered: null,
  search: '',
  matches: [],
  loadError: null,
  flyTo: 0,

  async loadIndex() {
    const res = await fetch(`${base}trees/index.json`);
    set({ index: await res.json() });
  },

  async loadTree(id, plan) {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return set({ loadError: `Unknown tree "${id}"` });
    try {
      const res = await fetch(`${base}trees/${id}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tree: TreeDoc = await res.json();
      const p = plan ?? readStoredPlan(id) ?? emptyPlan();
      // Codes that are not in this tree cannot be shown or evaluated; drop them.
      p.completed = p.completed.filter((c) => tree.subjects[c]);
      p.planned = p.planned.filter((c) => tree.subjects[c]);
      p.programs = p.programs.filter((c) => tree.programs[c]);
      set({ tree, layout: layoutTree(tree), plan: p, states: computeStates(tree, p), selected: null, loadError: null });
      savePlan(id, p);
      track('course_opened', { tree: id });
    } catch (e) {
      set({ loadError: `Could not load ${id}: ${(e as Error).message}` });
    }
  },

  select(code, fly = false) {
    set((s) => ({ selected: code, flyTo: fly ? s.flyTo + 1 : s.flyTo }));
    if (code) track('node_inspected', { code });
  },

  hover(code) {
    if (get().hovered !== code) set({ hovered: code });
  },

  mark(code, mark) {
    const { tree, plan } = get();
    if (!tree) return;
    const next: Plan = {
      completed: plan.completed.filter((c) => c !== code),
      planned: plan.planned.filter((c) => c !== code),
      programs: plan.programs,
    };
    if (mark === 'completed') next.completed.push(code);
    if (mark === 'planned') next.planned.push(code);
    set({ plan: next, states: computeStates(tree, next) });
    savePlan(tree.id, next);
    track('subject_marked', { code, mark });
  },

  toggleProgram(code) {
    const { tree, plan } = get();
    if (!tree) return;
    const programs = plan.programs.includes(code) ? plan.programs.filter((c) => c !== code) : [...plan.programs, code];
    const next = { ...plan, programs };
    set({ plan: next });
    savePlan(tree.id, next);
    track('program_toggled', { code });
  },

  setSearch(q) {
    const { tree } = get();
    set({ search: q, matches: tree ? matchesFor(tree, q) : [] });
  },

  resetPlan() {
    const { tree } = get();
    if (!tree) return;
    const p = emptyPlan();
    set({ plan: p, states: computeStates(tree, p) });
    savePlan(tree.id, p);
  },
}));
