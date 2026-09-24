import { ruleSubjects } from './engine.js';
import type { Container, Rule, TreeDoc } from './model.js';

export type LayoutNodeKind = 'degree' | 'program' | 'subject';

export interface LayoutNode {
  id: string; // subject/program code, or the degree code
  kind: LayoutNodeKind;
  x: number;
  y: number;
  r: number;
  cluster: string;
}

export type EdgeKind =
  | 'req' // must-have requisite
  | 'alt' // one of several alternatives (under an OR)
  | 'member' // program centre to its entry subjects
  | 'trunk'; // degree hub to a program

export interface LayoutEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface LayoutCluster {
  id: string;
  title: string;
  x: number;
  y: number;
  radius: number;
  ring: number;
}

export interface Layout {
  nodes: Record<string, LayoutNode>;
  edges: LayoutEdge[];
  clusters: LayoutCluster[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const SUBJECT_R = 22;
const PROGRAM_R = 40;
const DEGREE_R = 64;
const NODE_GAP = 26; // along an orbit
const ORBIT_GAP = 78; // between orbits
const CLUSTER_GAP = 120;

/** Programs listed directly under a container, in order, with the ring they belong on. */
function programsIn(c: Container, ring: number, out: { code: string; ring: number }[] = []) {
  for (const i of c.items) if (i.kind === 'program') out.push({ code: i.code, ring });
  for (const ch of c.children) programsIn(ch, ring, out);
  return out;
}

function subjectsIn(c: Container, out: string[] = []): string[] {
  for (const i of c.items) if (i.kind === 'subject' && !out.includes(i.code)) out.push(i.code);
  for (const ch of c.children) subjectsIn(ch, out);
  return out;
}

/** Requisite depth: 0 for no in-tree requisites, else 1 + the deepest current requisite. */
function depths(tree: TreeDoc): Map<string, number> {
  const memo = new Map<string, number>();
  const visit = (code: string, stack: Set<string>): number => {
    if (memo.has(code)) return memo.get(code)!;
    if (stack.has(code)) return 0;
    stack.add(code);
    const reqs = ruleSubjects(tree.subjects[code]?.requisite ?? null).filter((c) => tree.subjects[c] && !tree.subjects[c].legacy);
    const d = reqs.length ? 1 + Math.max(...reqs.map((c) => visit(c, stack))) : 0;
    stack.delete(code);
    memo.set(code, d);
    return d;
  };
  for (const code of Object.keys(tree.subjects)) visit(code, new Set());
  return memo;
}

/** Place codes on concentric orbits around (cx, cy), inner orbit first. Returns the outer radius used. */
function placeOrbits(
  codes: string[],
  depth: Map<string, number>,
  cx: number,
  cy: number,
  innerR: number,
  angle0: number,
  place: (code: string, x: number, y: number) => void,
): number {
  const byDepth = new Map<number, string[]>();
  for (const c of codes) {
    const d = depth.get(c) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), c]);
  }
  let r = innerR;
  let outer = innerR;
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    let pending = byDepth.get(d)!.sort();
    while (pending.length) {
      const capacity = Math.max(1, Math.floor((2 * Math.PI * r) / (SUBJECT_R * 2 + NODE_GAP)));
      const ring = pending.slice(0, capacity);
      pending = pending.slice(capacity);
      ring.forEach((code, i) => {
        const a = angle0 + (2 * Math.PI * i) / ring.length;
        place(code, cx + r * Math.cos(a), cy + r * Math.sin(a));
      });
      outer = r;
      r += ORBIT_GAP;
    }
  }
  return outer + SUBJECT_R;
}

function ruleEdges(to: string, rule: Rule | null, inOr: boolean, out: LayoutEdge[]) {
  if (!rule) return;
  if ('op' in rule) {
    const or = rule.op === 'or' && rule.args.length > 1;
    for (const a of rule.args) ruleEdges(to, a, inOr || or, out);
  } else if ('subject' in rule) {
    out.push({ from: rule.subject, to, kind: inOr ? 'alt' : 'req' });
  }
}


/**
 * Which cluster each subject is drawn in. Structure subjects belong to the degree core or the
 * first program (inner rings first) that lists them. Subjects that are only requisites join the
 * cluster where most of the subjects needing them live, so their links stay local.
 */
function clusterMembers(tree: TreeDoc, rings: Map<number, string[]>): Map<string, string[]> {
  const owner = new Map<string, string>();
  const deg = tree.degree.code;
  for (const s of subjectsIn(tree.degree.structure)) owner.set(s, deg);
  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    for (const p of rings.get(ring)!) for (const s of subjectsIn(tree.programs[p].structure)) if (!owner.has(s)) owner.set(s, p);
  }
  const dependents = new Map<string, string[]>();
  for (const s of Object.values(tree.subjects)) {
    for (const req of ruleSubjects(s.requisite)) dependents.set(req, [...(dependents.get(req) ?? []), s.code]);
  }
  // Requisite chains can be several subjects long; repeat until nothing new can be assigned.
  for (let changed = true; changed; ) {
    changed = false;
    for (const code of Object.keys(tree.subjects).sort()) {
      if (owner.has(code)) continue;
      const votes = new Map<string, number>();
      for (const d of dependents.get(code) ?? []) {
        const o = owner.get(d);
        if (o) votes.set(o, (votes.get(o) ?? 0) + 1);
      }
      if (!votes.size) continue;
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      owner.set(code, best);
      changed = true;
    }
  }
  // Anything still unowned (no route to the degree at all) goes to the core.
  for (const code of Object.keys(tree.subjects)) if (!owner.has(code)) owner.set(code, deg);
  const out = new Map<string, string[]>();
  for (const [code, cluster] of owner) out.set(cluster, [...(out.get(cluster) ?? []), code]);
  return out;
}

export function layoutTree(tree: TreeDoc): Layout {
  const depth = depths(tree);
  const nodes: Record<string, LayoutNode> = {};
  const clusters: LayoutCluster[] = [];
  const edges: LayoutEdge[] = [];
  const placed = new Set<string>();
  const add = (id: string, kind: LayoutNodeKind, x: number, y: number, cluster: string) => {
    const r = kind === 'degree' ? DEGREE_R : kind === 'program' ? PROGRAM_R : SUBJECT_R;
    nodes[id] = { id, kind, x, y, r, cluster };
    if (kind === 'subject') placed.add(id);
  };

  const deg = tree.degree;
  add(deg.code, 'degree', 0, 0, deg.code);
  // Programs: the degree's named majors on ring 1, anything reached through options on ring 2,
  // and programs nested inside programs one ring further out.
  const order: { code: string; ring: number }[] = [];
  deg.structure.children.forEach((child, i) => {
    const direct = child.items.some((it) => it.kind === 'program') && child.title.toLowerCase().startsWith('major');
    programsIn(child, direct || i === 0 ? 1 : 2, order);
  });
  const seen = new Set<string>();
  const rings = new Map<number, string[]>();
  for (let i = 0; i < order.length; i++) {
    const { code, ring } = order[i];
    if (seen.has(code) || !tree.programs[code]) continue;
    seen.add(code);
    rings.set(ring, [...(rings.get(ring) ?? []), code]);
    for (const nested of programsIn(tree.programs[code].structure, ring + 1)) order.push(nested);
  }

  const members = clusterMembers(tree, rings);

  // Core: subjects listed directly in the degree structure orbit the hub.
  const coreR = placeOrbits(members.get(deg.code)!, depth, 0, 0, DEGREE_R + 90, -Math.PI / 2, (c, x, y) => add(c, 'subject', x, y, deg.code));
  clusters.push({ id: deg.code, title: deg.title, x: 0, y: 0, radius: coreR, ring: 0 });

  let ringInner = coreR + CLUSTER_GAP;
  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    const codes = rings.get(ring)!;
    const own = new Map(codes.map((c) => [c, members.get(c) ?? []]));
    // Size each cluster with a dry run of the real placement (a new orbit starts per depth).
    const radii = codes.map((c) => placeOrbits(own.get(c)!, depth, 0, 0, PROGRAM_R + 60, 0, () => {}));
    const maxR = Math.max(...radii);
    const circumference = radii.reduce((t, r) => t + 2 * r + CLUSTER_GAP, 0);
    const ringR = Math.max(ringInner + maxR, circumference / (2 * Math.PI));
    let angle = -Math.PI / 2;
    codes.forEach((code, i) => {
      const span = (2 * radii[i] + CLUSTER_GAP) / ringR;
      const a = angle + span / 2;
      angle += span;
      const cx = ringR * Math.cos(a);
      const cy = ringR * Math.sin(a);
      add(code, 'program', cx, cy, code);
      edges.push({ from: deg.code, to: code, kind: ring === 1 ? 'trunk' : 'member' });
      placeOrbits(own.get(code)!, depth, cx, cy, PROGRAM_R + 60, a + Math.PI, (s, x, y) => add(s, 'subject', x, y, code));
      clusters.push({ id: code, title: tree.programs[code].title, x: cx, y: cy, radius: radii[i], ring });
    });
    ringInner = ringR + maxR + CLUSTER_GAP;
  }

  // Requisite links, plus membership spokes from a program to its entry subjects.
  for (const s of Object.values(tree.subjects)) ruleEdges(s.code, s.requisite, false, edges);
  for (const cl of clusters) {
    if (cl.id === deg.code) continue;
    for (const n of Object.values(nodes)) {
      if (n.cluster === cl.id && n.kind === 'subject' && (depth.get(n.id) ?? 0) === 0) edges.push({ from: cl.id, to: n.id, kind: 'member' });
    }
  }
  const valid = edges.filter((e) => nodes[e.from] && nodes[e.to] && e.from !== e.to);
  const unique = new Map(valid.map((e) => [`${e.from}>${e.to}`, e]));

  // Bounds cover every halo plus the title drawn above each cluster.
  const TITLE_SPACE = 150;
  const bounds = {
    minX: Math.min(...clusters.map((c) => c.x - c.radius - 30)),
    minY: Math.min(...clusters.map((c) => c.y - c.radius - TITLE_SPACE)),
    maxX: Math.max(...clusters.map((c) => c.x + c.radius + 30)),
    maxY: Math.max(...clusters.map((c) => c.y + c.radius + 30)),
  };
  return { nodes, edges: [...unique.values()], clusters, bounds };
}
