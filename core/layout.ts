import { programsUnder, subjectsUnder } from './engine.js';
import type { MapDoc, Rule } from './model.js';

// Euler-diagram layout: degrees and programs are circles enclosing their subjects. Circles at
// the same level overlap where they share subjects. Deterministic: same map in, same layout out.

export interface LayoutNode {
  id: string; // subject code
  x: number;
  y: number;
  r: number;
}

export interface LayoutCircle {
  id: string; // degree or program code
  kind: 'degree' | 'program';
  title: string;
  x: number;
  y: number;
  r: number;
  /** Every subject the structure lists (programs include nested programs). */
  members: string[];
}

export type EdgeKind =
  | 'req' // must-have requisite
  | 'alt'; // one of several alternatives (under an OR)

export interface LayoutEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface Layout {
  nodes: Record<string, LayoutNode>;
  /** Largest first, so drawing in order puts smaller circles on top. */
  circles: LayoutCircle[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const SUBJECT_R = 22;
const GAP = 16; // between subject rims
const SPACING = SUBJECT_R * 2 + GAP;
const PROGRAM_PAD = 26; // circle rim beyond its outermost subject
const DEGREE_PAD = 60; // degree rim beyond its outermost program circle
const TWIN_GAP = 24; // between the outlines of programs that would otherwise coincide
export const TUNING = { iterations: 600, pull: 0.5 };

/** Stable pseudo-random number in [0, 1) from a string. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

interface Group {
  id: string;
  kind: 'degree' | 'program';
  members: string[];
  weight: number;
  cx: number;
  cy: number;
  /** Rough radius from member count, for pushing unrelated groups apart. */
  estR: number;
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

export function layoutMap(map: MapDoc): Layout {
  const degreeCodes = Object.keys(map.degrees).sort();
  const subjectCodes = Object.keys(map.subjects).sort();

  // Groups and memberships.
  const groups: Group[] = [];
  const groupsOf = new Map<string, Group[]>(subjectCodes.map((c) => [c, []]));
  const programDegrees = new Map<string, string[]>();
  for (const d of degreeCodes) {
    const members = [...subjectsUnder(map, map.degrees[d].structure)].filter((c) => map.subjects[c]).sort();
    groups.push({ id: d, kind: 'degree', members, weight: 0.25, cx: 0, cy: 0, estR: 0 });
    for (const p of programsUnder(map, map.degrees[d].structure)) programDegrees.set(p, [...(programDegrees.get(p) ?? []), d]);
  }
  for (const p of Object.keys(map.programs).sort()) {
    const members = [...subjectsUnder(map, map.programs[p].structure)].filter((c) => map.subjects[c]).sort();
    groups.push({ id: p, kind: 'program', members, weight: 1, cx: 0, cy: 0, estR: 0 });
  }
  for (const g of groups) {
    g.estR = Math.sqrt(g.members.length) * SPACING * 0.62 + PROGRAM_PAD;
    for (const m of g.members) groupsOf.get(m)!.push(g);
  }
  const byId = new Map(groups.map((g) => [g.id, g]));

  // Degree anchors on a ring, so each degree has a home region.
  const ringR = 900 + 450 * degreeCodes.length;
  const anchor = new Map(
    degreeCodes.map((d, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / degreeCodes.length;
      return [d, { x: degreeCodes.length > 1 ? ringR * Math.cos(a) : 0, y: degreeCodes.length > 1 ? ringR * Math.sin(a) : 0 }];
    }),
  );

  // Requisite links, and who is linked to whom (for subjects that belong to no group).
  const edges: LayoutEdge[] = [];
  for (const s of Object.values(map.subjects)) ruleEdges(s.code, s.requisite, false, edges);
  const linked = edges.filter((e) => map.subjects[e.from] && map.subjects[e.to] && e.from !== e.to);
  const neighbours = new Map<string, string[]>(subjectCodes.map((c) => [c, []]));
  for (const e of linked) {
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
  }

  // Initial positions: around the anchors of the degrees a subject belongs to.
  const pos = new Map<string, { x: number; y: number }>();
  const degreesOf = (c: string) => groupsOf.get(c)!.filter((g) => g.kind === 'degree').map((g) => g.id);
  const place = (c: string, ds: string[]) => {
    const ax = ds.length ? ds.reduce((t, d) => t + anchor.get(d)!.x, 0) / ds.length : 0;
    const ay = ds.length ? ds.reduce((t, d) => t + anchor.get(d)!.y, 0) / ds.length : 0;
    const a = hash(c) * Math.PI * 2;
    const r = 200 + hash(c + '#') * 600;
    pos.set(c, { x: ax + r * Math.cos(a), y: ay + r * Math.sin(a) });
  };
  for (const c of subjectCodes) if (degreesOf(c).length) place(c, degreesOf(c));
  // Loose subjects (requisites only) start near the degrees of their neighbours.
  for (let pass = 0; pass < 4; pass++) {
    for (const c of subjectCodes) {
      if (pos.has(c)) continue;
      const near = neighbours.get(c)!.filter((n) => pos.has(n));
      if (!near.length && pass < 3) continue;
      place(c, [...new Set(near.flatMap(degreesOf))]);
    }
  }

  const centre = (g: Group) => {
    if (!g.members.length) return;
    let x = 0;
    let y = 0;
    for (const m of g.members) (x += pos.get(m)!.x), (y += pos.get(m)!.y);
    g.cx = x / g.members.length;
    g.cy = y / g.members.length;
  };

  // Program pairs that share nothing should not overlap.
  const programGroups = groups.filter((g) => g.kind === 'program' && g.members.length);
  const disjoint: [Group, Group][] = [];
  for (let i = 0; i < programGroups.length; i++) {
    const a = new Set(programGroups[i].members);
    for (let j = i + 1; j < programGroups.length; j++) {
      if (!programGroups[j].members.some((m) => a.has(m))) disjoint.push([programGroups[i], programGroups[j]]);
    }
  }

  for (let it = 0; it < TUNING.iterations; it++) {
    const alpha = 1 - it / TUNING.iterations;
    groups.forEach(centre);

    // Pull each subject towards every group it belongs to.
    for (const c of subjectCodes) {
      const p = pos.get(c)!;
      const gs = groupsOf.get(c)!;
      if (gs.length) {
        let fx = 0;
        let fy = 0;
        let w = 0;
        for (const g of gs) (fx += (g.cx - p.x) * g.weight), (fy += (g.cy - p.y) * g.weight), (w += g.weight);
        p.x += (fx / w) * TUNING.pull * alpha;
        p.y += (fy / w) * TUNING.pull * alpha;
      } else {
        // Loose subjects follow the subjects they are linked to.
        const ns = neighbours.get(c)!;
        if (ns.length) {
          let x = 0;
          let y = 0;
          for (const n of ns) (x += pos.get(n)!.x), (y += pos.get(n)!.y);
          p.x += (x / ns.length - p.x) * 0.1 * alpha;
          p.y += (y / ns.length - p.y) * 0.1 * alpha;
        }
      }
    }

    // Keep each degree near its anchor.
    for (const d of degreeCodes) {
      const g = byId.get(d)!;
      if (!g.members.length) continue;
      const a = anchor.get(d)!;
      const dx = (a.x - g.cx) * 0.05 * alpha;
      const dy = (a.y - g.cy) * 0.05 * alpha;
      // Only subjects exclusive to this degree are anchored: shared ones must be free to sit
      // between degrees, or every group they belong to gets stretched.
      for (const m of g.members) {
        if (degreesOf(m).length !== 1) continue;
        const p = pos.get(m)!;
        p.x += dx;
        p.y += dy;
      }
    }

    // Push apart programs that share no subjects.
    for (const [a, b] of disjoint) {
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const d = Math.hypot(dx, dy) || 1;
      const overlap = a.estR + b.estR + GAP - d;
      if (overlap <= 0) continue;
      const push = overlap * 0.25 * (0.3 + alpha);
      const ux = dx / d;
      const uy = dy / d;
      for (const m of a.members) {
        if (groupsOf.get(m)!.includes(b)) continue;
        const p = pos.get(m)!;
        p.x -= (ux * push) / 2;
        p.y -= (uy * push) / 2;
      }
      for (const m of b.members) {
        if (groupsOf.get(m)!.includes(a)) continue;
        const p = pos.get(m)!;
        p.x += (ux * push) / 2;
        p.y += (uy * push) / 2;
      }
    }

    collide(subjectCodes, pos);
  }
  // Settle any remaining overlaps without further pulling.
  for (let k = 0; k < 30; k++) if (!collide(subjectCodes, pos)) break;

  // Circles: programs enclose their subjects (and nested programs); degrees also enclose their programs.
  const nodes: Record<string, LayoutNode> = {};
  for (const c of subjectCodes) nodes[c] = { id: c, x: round(pos.get(c)!.x), y: round(pos.get(c)!.y), r: SUBJECT_R };
  const circles: LayoutCircle[] = [];
  const programCircle = new Map<string, LayoutCircle>();
  // Fewest members first, so a parent program can enclose its children.
  const programOrder = Object.keys(map.programs).sort((a, b) => byId.get(a)!.members.length - byId.get(b)!.members.length || a.localeCompare(b));
  for (const p of programOrder) {
    const g = byId.get(p)!;
    const children = [...programsUnder(map, map.programs[p].structure)].map((c) => programCircle.get(c)).filter(Boolean) as LayoutCircle[];
    let circle: Circle;
    if (g.members.length) {
      circle = enclose([...g.members.map((m) => ({ x: nodes[m].x, y: nodes[m].y, r: SUBJECT_R + PROGRAM_PAD })), ...children.map((c) => ({ x: c.x, y: c.y, r: c.r + 14 }))]);
    } else {
      // Nothing published for this program (legacy): a small marker in its degree's region.
      const ds = programDegrees.get(p) ?? degreeCodes.slice(0, 1);
      const cs = ds.map((d) => byId.get(d)!);
      const a = hash(p) * Math.PI * 2;
      circle = { x: cs.reduce((t, g) => t + g.cx, 0) / cs.length + 120 * Math.cos(a), y: cs.reduce((t, g) => t + g.cy, 0) / cs.length + 120 * Math.sin(a), r: 70 };
    }
    // Two programs can enclose exactly the same area; grow this one so both outlines show.
    for (const other of programCircle.values()) {
      if (Math.hypot(other.x - circle.x, other.y - circle.y) < 4 && Math.abs(other.r - circle.r) < TWIN_GAP) circle.r = other.r + TWIN_GAP;
    }
    const lc: LayoutCircle = { id: p, kind: 'program', title: map.programs[p].title, x: round(circle.x), y: round(circle.y), r: Math.ceil(circle.r), members: g.members };
    programCircle.set(p, lc);
    circles.push(lc);
  }
  for (const d of degreeCodes) {
    const g = byId.get(d)!;
    const progs = [...programsUnder(map, map.degrees[d].structure)].map((p) => programCircle.get(p)!).filter(Boolean);
    const c = enclose([
      ...g.members.map((m) => ({ x: nodes[m].x, y: nodes[m].y, r: SUBJECT_R + PROGRAM_PAD })),
      ...progs.map((p) => ({ x: p.x, y: p.y, r: p.r + DEGREE_PAD })),
    ]);
    circles.push({ id: d, kind: 'degree', title: map.degrees[d].title, x: round(c.x), y: round(c.y), r: Math.ceil(c.r), members: g.members });
  }
  circles.sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));

  const unique = new Map(linked.map((e) => [`${e.from}>${e.to}`, e]));
  const all = [...circles, ...Object.values(nodes)];
  const bounds = {
    minX: Math.min(...all.map((c) => c.x - c.r)) - 40,
    minY: Math.min(...all.map((c) => c.y - c.r)) - 120,
    maxX: Math.max(...all.map((c) => c.x + c.r)) + 40,
    maxY: Math.max(...all.map((c) => c.y + c.r)) + 40,
  };
  return { nodes, circles, edges: [...unique.values()], bounds };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Push overlapping subjects apart. Returns whether anything moved. */
function collide(codes: string[], pos: Map<string, { x: number; y: number }>): boolean {
  const cell = SPACING;
  const grid = new Map<string, string[]>();
  for (const c of codes) {
    const p = pos.get(c)!;
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const list = grid.get(k);
    if (list) list.push(c);
    else grid.set(k, [c]);
  }
  let moved = false;
  for (const c of codes) {
    const a = pos.get(c)!;
    const gx = Math.floor(a.x / cell);
    const gy = Math.floor(a.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (o <= c) continue;
          const b = pos.get(o)!;
          let vx = b.x - a.x;
          let vy = b.y - a.y;
          let d = Math.hypot(vx, vy);
          if (d >= SPACING) continue;
          if (d < 0.01) {
            const ang = hash(c + o) * Math.PI * 2;
            (vx = Math.cos(ang)), (vy = Math.sin(ang)), (d = 1);
          }
          const push = (SPACING - d) / 2;
          a.x -= (vx / d) * push;
          a.y -= (vy / d) * push;
          b.x += (vx / d) * push;
          b.y += (vy / d) * push;
          moved = true;
        }
      }
    }
  }
  return moved;
}

type Circle = { x: number; y: number; r: number };

/** Smallest circle enclosing a set of circles (Welzl on rim samples, then grown to cover each exactly). */
export function enclose(cs: Circle[]): Circle {
  if (!cs.length) return { x: 0, y: 0, r: 0 };
  const pts: { x: number; y: number }[] = [];
  for (const c of cs) for (let i = 0; i < 16; i++) pts.push({ x: c.x + c.r * Math.cos((i * Math.PI) / 8), y: c.y + c.r * Math.sin((i * Math.PI) / 8) });
  // A deterministic shuffle keeps Welzl's expected-linear behaviour without randomness.
  pts.sort((a, b) => hash(`${a.x},${a.y}`) - hash(`${b.x},${b.y}`));
  const best = minDisk(pts);
  // Sampling can miss a sliver of a rim; grow to cover every circle exactly.
  for (const c of cs) best.r = Math.max(best.r, Math.hypot(c.x - best.x, c.y - best.y) + c.r);
  return best;
}

function minDisk(P: { x: number; y: number }[]): Circle {
  let c: Circle = { x: P[0].x, y: P[0].y, r: 0 };
  const inside = (p: { x: number; y: number }, k: Circle) => Math.hypot(p.x - k.x, p.y - k.y) <= k.r + 1e-7;
  for (let i = 1; i < P.length; i++) {
    if (inside(P[i], c)) continue;
    c = { x: P[i].x, y: P[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(P[j], c)) continue;
      c = { x: (P[i].x + P[j].x) / 2, y: (P[i].y + P[j].y) / 2, r: Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) / 2 };
      for (let k = 0; k < j; k++) if (!inside(P[k], c)) c = circumcircle(P[i], P[j], P[k]);
    }
  }
  return c;
}

function circumcircle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) {
    // Collinear: the widest pair decides.
    const pairs: [typeof a, typeof a][] = [
      [a, b],
      [a, c],
      [b, c],
    ];
    const [p, q] = pairs.sort((u, v) => Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) - Math.hypot(u[0].x - u[1].x, u[0].y - u[1].y))[0];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, r: Math.hypot(p.x - q.x, p.y - q.y) / 2 };
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/**
 * The circle a click at world (x, y) means. Near an outline (within `rim` world units inside
 * it), the outline's circle wins, nearest outline first: that is how a circle completely covered
 * by smaller ones stays selectable. Elsewhere, the smallest circle containing the point; on a
 * tie, the nearest centre.
 */
export function circleAt(layout: Layout, x: number, y: number, rim = 0): LayoutCircle | null {
  let onRim: LayoutCircle | null = null;
  let rimGap = Infinity;
  let best: LayoutCircle | null = null;
  let bestD = Infinity;
  for (const c of layout.circles) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d > c.r) continue;
    if (c.r - d <= rim && c.r - d < rimGap) (onRim = c), (rimGap = c.r - d);
    if (!best || c.r < best.r || (c.r === best.r && d < bestD)) (best = c), (bestD = d);
  }
  return onRim ?? best;
}

/** Quality measure: subjects that sit inside a circle which does not list them. */
export function foreignInside(layout: Layout): { circle: string; subject: string }[] {
  const out: { circle: string; subject: string }[] = [];
  for (const c of layout.circles) {
    const members = new Set(c.members);
    for (const n of Object.values(layout.nodes)) {
      if (!members.has(n.id) && Math.hypot(n.x - c.x, n.y - c.y) < c.r - n.r) out.push({ circle: c.id, subject: n.id });
    }
  }
  return out;
}

