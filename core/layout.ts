import { packEnclose, packSiblings } from 'd3-hierarchy';
import type { Container, MapDoc, Rule } from './model.js';

// Railway-map layout. Degrees and programs are circles that never overlap (one may only contain
// another). A subject listed by several circles appears as a copy in each; copies share one state.
// Inside a circle, subjects sit on rings by prerequisite depth, and requisite links are routed like
// railway lines: out along a spoke, round a ring-following track, out along a spoke, with rounded
// corners. Tracks never share an arc, so every crossing is spoke against track: close to 90 degrees.
// A prerequisite missing from a circle appears inside it as an "entry" copy, so links stay local.
// Deterministic: same map in, same layout out.

export type PathCmd =
  | ['M', number, number]
  | ['L', number, number]
  | ['Q', number, number, number, number] // control x, y, end x, y
  | ['A', number, number, number, number, number, boolean]; // centre x, y, radius, from, to, anticlockwise

export interface LayoutNode {
  id: string; // copy id: "<circle>/<code>"
  code: string;
  circle: string;
  x: number;
  y: number;
  r: number;
  /** A prerequisite shown here only so its links stay inside the circle; not listed by it. */
  entry?: boolean;
}

export interface LayoutCircle {
  id: string; // degree or program code
  kind: 'degree' | 'program';
  title: string;
  x: number;
  y: number;
  r: number;
  /** Subjects the structure lists directly (each has a copy inside this circle). */
  members: string[];
  /** The circle this one sits inside, if any. */
  parent: string | null;
  /** For a program placed outside every degree: the degrees that offer it. */
  sharedBy?: string[];
}

export type EdgeKind =
  | 'req' // must-have requisite
  | 'alt'; // one of several alternatives (under an OR)

export interface LayoutEdge {
  from: string; // copy id
  to: string; // copy id
  fromCode: string;
  toCode: string;
  kind: EdgeKind;
  path: PathCmd[];
}

export interface Layout {
  nodes: Record<string, LayoutNode>;
  /** Largest first, so drawing in order puts contained circles on top. */
  circles: LayoutCircle[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const SUBJECT_R = 22;
const ARC = SUBJECT_R * 2 + 24; // arc length each subject needs along its ring (room for a corridor between)
const BASE_GAP = 26; // between the rims of neighbouring rings, before tracks
const TRACK = 7; // between parallel tracks
const FILLET = 9; // corner rounding
const SPREAD = 5; // between parallel spokes leaving or entering one subject
const PAD = 34; // circle rim beyond its contents
const CHILD_GAP = 26; // between packed circles
const TOP_GAP = 140; // between top-level circles

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
/** Signed shortest turn from a to b, in (-PI, PI]. */
const turn = (a: number, b: number) => {
  const d = norm(b - a);
  return d > Math.PI ? d - TAU : d;
};
const round = (n: number) => Math.round(n * 10) / 10;
/** Clamp angle a into [lo, hi], treating angles as the same modulo a full turn. */
const clampAngle = (a: number, lo: number, hi: number) => {
  const mid = (lo + hi) / 2;
  const t = mid + turn(mid, a);
  return Math.min(hi, Math.max(lo, t));
};

function directSubjects(map: MapDoc, c: Container, out = new Set<string>()): Set<string> {
  for (const i of c.items) if (i.kind === 'subject' && map.subjects[i.code]) out.add(i.code);
  for (const ch of c.children) directSubjects(map, ch, out);
  return out;
}

function directPrograms(map: MapDoc, c: Container, out = new Set<string>()): Set<string> {
  for (const i of c.items) if (i.kind === 'program' && map.programs[i.code]) out.add(i.code);
  for (const ch of c.children) directPrograms(map, ch, out);
  return out;
}

function ruleKinds(rule: Rule | null, inOr: boolean, out: Map<string, EdgeKind>) {
  if (!rule) return;
  if ('op' in rule) {
    const or = rule.op === 'or' && rule.args.length > 1;
    for (const a of rule.args) ruleKinds(a, inOr || or, out);
  } else if ('subject' in rule && !out.has(rule.subject)) out.set(rule.subject, inOr ? 'alt' : 'req');
}

/** Rings of one circle, in the circle's own coordinates (centre at 0, 0). */
interface Disc {
  r: number;
  nodes: { code: string; entry: boolean; x: number; y: number }[];
  edges: { from: string; to: string; kind: EdgeKind; path: PathCmd[] }[];
}

function buildDisc(map: MapDoc, members: Set<string>): Disc {
  // Entry copies: current prerequisites of members that the circle does not list.
  const reqs = new Map<string, Map<string, EdgeKind>>();
  const entries = new Set<string>();
  for (const code of members) {
    const kinds = new Map<string, EdgeKind>();
    ruleKinds(map.subjects[code].requisite, false, kinds);
    for (const r of [...kinds.keys()]) {
      const s = map.subjects[r];
      if (!s || r === code || (s.legacy && !members.has(r))) kinds.delete(r);
      else if (!members.has(r)) entries.add(r);
    }
    reqs.set(code, kinds);
  }
  const all = [...members, ...entries].sort();
  if (!all.length) return { r: SUBJECT_R * 2, nodes: [], edges: [] };

  // Requisites can loop in the source data (e.g. four language subjects that each accept any of the
  // others as an alternative). Subjects in one loop (a strongly connected group, found with Tarjan's
  // algorithm) share a ring, so links inside the loop run sideways along that ring's track instead of
  // stacking the loop into a chain of rings that its own links then cut across.
  const loopOf = new Map<string, number>();
  {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    let next = 0;
    let groups = 0;
    const connect = (c: string) => {
      index.set(c, next);
      low.set(c, next++);
      stack.push(c);
      for (const r of [...(reqs.get(c)?.keys() ?? [])].sort()) {
        if (!index.has(r)) {
          connect(r);
          low.set(c, Math.min(low.get(c)!, low.get(r)!));
        } else if (!loopOf.has(r)) low.set(c, Math.min(low.get(c)!, index.get(r)!));
      }
      if (low.get(c) === index.get(c)) {
        let m: string;
        do loopOf.set((m = stack.pop()!), groups);
        while (m !== c);
        groups++;
      }
    };
    for (const c of all) if (!index.has(c)) connect(c);
  }
  const looped = (r: string, c: string) => loopOf.get(r) === loopOf.get(c);
  // Depth inside this circle: entries are 0; a member is one ring beyond its deepest prerequisite
  // outside its own loop, and every subject in a loop takes the loop's deepest.
  const depth = new Map<string, number>();
  const visitGroup = new Map<number, number>();
  const visit = (c: string): number => {
    if (entries.has(c)) return 0;
    const g = loopOf.get(c)!;
    if (visitGroup.has(g)) return visitGroup.get(g)!;
    visitGroup.set(g, 0);
    const ins = all.filter((m) => loopOf.get(m) === g).flatMap((m) => [...(reqs.get(m)?.keys() ?? [])].filter((r) => !looped(r, m)));
    const d = ins.length ? 1 + Math.max(...ins.map(visit)) : 0;
    visitGroup.set(g, d);
    return d;
  };
  for (const c of all) depth.set(c, visit(c));
  const rings: string[][] = [];
  for (const c of all) (rings[depth.get(c)!] ??= []).push(c);
  for (let i = 0; i < rings.length; i++) rings[i] ??= [];

  // A route is a railway line: spoke out of its source, one or two ring-following legs, spoke in.
  // A leg runs on a track in the gap just outside ring `gap`, from one angle to another.
  type Leg = { gap: number; from: number; to: number; track: number };
  type Route = { from: string; to: string; kind: EdgeKind; dep: number; arr: number; legs: Leg[] };
  const routes: Route[] = [];
  for (const t of all) for (const [f, kind] of reqs.get(t) ?? []) routes.push({ from: f, to: t, kind, dep: 0, arr: 0, legs: [] });
  routes.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // Angles: ring 0 evenly; outer rings aim at their prerequisites (circular mean).
  const angle = new Map<string, number>();
  rings[0].forEach((c, i) => angle.set(c, (TAU * i) / Math.max(1, rings[0].length) - Math.PI / 2));
  for (let k = 1; k < rings.length; k++) {
    const want = rings[k].map((c) => {
      const ins = [...(reqs.get(c)?.keys() ?? [])].filter((r) => angle.has(r));
      const x = ins.reduce((t, r) => t + Math.cos(angle.get(r)!), 0);
      const y = ins.reduce((t, r) => t + Math.sin(angle.get(r)!), 0);
      return { c, a: ins.length ? norm(Math.atan2(y, x)) : 0 };
    });
    want.sort((p, q) => p.a - q.a || p.c.localeCompare(q.c));
    want.forEach((w) => angle.set(w.c, w.a));
    rings[k] = want.map((w) => w.c);
  }

  // Keep neighbours on a ring at least one slot apart, moving each as little as possible.
  const radius: number[] = [];
  const spread = (k: number) => {
    const n = rings[k].length;
    const r = radius[k];
    if (n < 2 || r <= 0) return;
    const min = ARC / r;
    const order = [...rings[k]].sort((p, q) => angle.get(p)! - angle.get(q)! || p.localeCompare(q));
    if (n * min >= TAU - 1e-6) {
      const a0 = angle.get(order[0])!;
      order.forEach((c, i) => angle.set(c, a0 + (TAU * i) / n));
      rings[k] = order;
      return;
    }
    // Cut the circle at its widest natural gap, so no cluster is split across the seam.
    const want = order.map((c) => angle.get(c)!);
    let cut = 0;
    let widest = -1;
    for (let i = 0; i < n; i++) {
      const g = norm(want[(i + 1) % n] - want[i]) || TAU;
      if (g > widest) (widest = g), (cut = (i + 1) % n);
    }
    const seq = [...order.slice(cut), ...order.slice(0, cut)];
    const w = seq.map((c) => angle.get(c)!);
    for (let i = 1; i < n; i++) while (w[i] < w[i - 1]) w[i] += TAU;
    // A forward pass enforces spacing; a backward pass keeps the last subject a slot short of wrapping
    // round onto the first (always possible here, since n * min < TAU); then shift back by the mean push.
    const got = [...w];
    for (let i = 1; i < n; i++) got[i] = Math.max(got[i], got[i - 1] + min);
    got[n - 1] = Math.min(got[n - 1], got[0] + TAU - min);
    for (let i = n - 2; i >= 1; i--) got[i] = Math.min(got[i], got[i + 1] - min);
    const shiftBy = got.reduce((t, g, i) => t + (g - w[i]), 0) / n;
    seq.forEach((c, i) => angle.set(c, norm(got[i] - shiftBy)));
    rings[k] = seq;
  };

  // A leg needs a ring-following arc only if its turn is longer than two rounded corners.
  const trackR = (k: number, track: number) => radius[k] + SUBJECT_R + BASE_GAP / 2 + track * TRACK;
  const needsArc = (leg: Leg) => Math.abs(turn(leg.from, leg.to)) * trackR(leg.gap, leg.track) >= 4;

  // Tracks per gap: interval scheduling, shortest arcs innermost; no two arcs on a track overlap.
  const assignTracks = () => {
    const byGap = new Map<number, Leg[]>();
    for (const r of routes) for (const l of r.legs) (byGap.get(l.gap) ?? byGap.set(l.gap, []).get(l.gap)!).push(l);
    const count = rings.map(() => 0);
    const overlaps = (x: [number, number], y: [number, number]) => norm(y[0] - x[0]) <= x[1] + 0.03 || norm(x[0] - y[0]) <= y[1] + 0.03;
    for (const [k, legs] of byGap) {
      legs.sort((a, b) => Math.abs(turn(a.from, a.to)) - Math.abs(turn(b.from, b.to)) || a.from - b.from);
      const used: [number, number][][] = [];
      for (const l of legs) {
        l.track = 0;
        if (!needsArc(l)) continue;
        const d = turn(l.from, l.to);
        const span: [number, number] = [norm(d >= 0 ? l.from : l.from + d), Math.abs(d)];
        let t = 0;
        while ((used[t] ?? []).some((u) => overlaps(u, span))) t++;
        (used[t] ??= []).push(span);
        l.track = t;
      }
      count[k] = used.length;
    }
    return count;
  };

  // Spokes: several links leaving (or entering) one subject run side by side, ordered so they do not cross.
  const group = (key: (r: Route) => string) => {
    const m = new Map<string, Route[]>();
    for (const r of routes) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const fan = (list: Route[], anchor: string, other: (r: Route) => string, set: (r: Route, a: number) => void) => {
    const a = angle.get(anchor)!;
    const ring = radius[depth.get(anchor)!];
    list.sort((p, q) => turn(a, angle.get(other(p))!) - turn(a, angle.get(other(q))!) || other(p).localeCompare(other(q)));
    list.forEach((r, i) => set(r, a + (ring > 0 ? ((i - (list.length - 1) / 2) * SPREAD) / ring : 0)));
  };

  // A link that skips rings runs outward through a corridor: a gap between the subjects on every ring
  // it crosses, as close as possible to its target, and apart from other corridors.
  // Spokes crossing one gap (lines leaving ring k and lines arriving at ring k + 1) must not run on
  // top of each other: subjects directly outward of one another would otherwise share angles.
  // Space them at least SPREAD apart, keeping each within its own subject's outline.
  const separateSpokes = () => {
    for (let k = 0; k + 1 < rings.length; k++) {
      const mid = (radius[k] + radius[k + 1]) / 2;
      if (mid <= 0) continue;
      type Spoke = { a: number; lo: number; hi: number; set: (a: number) => void };
      const spokes: Spoke[] = [];
      const bounds = (node: string) => {
        const r = radius[depth.get(node)!];
        const w = r > 0 ? (SUBJECT_R - 6) / r : Math.PI;
        return [angle.get(node)! - w, angle.get(node)! + w];
      };
      for (const r of routes) {
        if (depth.get(r.from) === k && radius[k] > 0) {
          const [lo, hi] = bounds(r.from);
          spokes.push({ a: r.dep, lo, hi, set: (a) => (r.dep = a) });
        }
        const lateral = depth.get(r.to)! <= depth.get(r.from)!;
        if (lateral ? depth.get(r.to) === k : depth.get(r.to) === k + 1) {
          const [lo, hi] = bounds(r.to);
          spokes.push({ a: r.arr, lo, hi, set: (a) => (r.arr = a) });
        }
      }
      if (spokes.length < 2) continue;
      const min = (SPREAD + 1) / mid;
      for (let pass = 0; pass < 40; pass++) {
        spokes.sort((p, q) => norm(p.a) - norm(q.a));
        let moved = false;
        for (let i = 0; i < spokes.length; i++) {
          const p = spokes[i];
          const q = spokes[(i + 1) % spokes.length];
          const gap = norm(q.a - p.a);
          if (gap >= min || (spokes.length === 2 && i === 1)) continue;
          const push = (min - gap) / 2;
          p.a = clampAngle(p.a - push, p.lo, p.hi);
          q.a = clampAngle(q.a + push, q.lo, q.hi);
          moved = true;
        }
        if (!moved) break;
      }
      for (const sp of spokes) sp.set(sp.a);
    }
  };

  const planLegs = () => {
    for (const [c, list] of group((r) => r.from)) fan(list, c, (r) => r.to, (r, a) => (r.dep = a));
    for (const [c, list] of group((r) => r.to)) fan(list, c, (r) => r.from, (r, a) => (r.arr = a));
    separateSpokes();
    const corridors = rings.map(() => [] as number[]);
    const clear = (a: number, j: number) => {
      const r = radius[j];
      return (
        rings[j].every((n) => Math.abs(turn(a, angle.get(n)!)) * r >= SUBJECT_R + 5) &&
        corridors[j].every((c) => Math.abs(turn(a, c)) * r >= SPREAD + 1)
      );
    };
    // The corridor also runs through the gap outside the source's ring and the gap inside the target's,
    // where the spokes of the other subjects on those rings run: keep off those subjects too.
    const clearEnd = (a: number, j: number, own: string) =>
      radius[j] <= 0 || rings[j].every((n) => n === own || Math.abs(turn(a, angle.get(n)!)) * radius[j] >= SUBJECT_R + 5);
    const ordered = [...routes].sort((a, b) => depth.get(b.to)! - depth.get(b.from)! - (depth.get(a.to)! - depth.get(a.from)!) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    for (const r of ordered) {
      const k = depth.get(r.from)!;
      const t = depth.get(r.to)!;
      if (t <= k) {
        // A loop link (see `loopOf`): out to a track outside the source's ring, along it, back in.
        r.legs = [{ gap: k, from: r.dep, to: r.arr, track: 0 }];
        continue;
      }
      if (t === k + 1) {
        r.legs = radius[k] > 0 ? [{ gap: k, from: r.dep, to: r.arr, track: 0 }] : [];
        continue;
      }
      let corridor = r.arr;
      for (let step = 0; step <= 720; step++) {
        const a = r.arr + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (Math.PI / 720);
        let ok = clearEnd(a, k, r.from) && clearEnd(a, t, r.to);
        for (let j = k + 1; j < t && ok; j++) ok = clear(a, j);
        if (ok) {
          corridor = a;
          break;
        }
      }
      for (let j = k + 1; j < t; j++) corridors[j].push(corridor);
      const first: Leg[] = radius[k] > 0 ? [{ gap: k, from: r.dep, to: corridor, track: 0 }] : [];
      r.legs = [...first, { gap: t - 1, from: corridor, to: r.arr, track: 0 }];
    }
  };

  // Radii, corridors and tracks depend on each other: settle over a few passes.
  let tracks: number[] = rings.map(() => 0);
  const ringGap = (k: number) => SUBJECT_R * 2 + BASE_GAP + tracks[k] * TRACK;
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 0; k < rings.length; k++) {
      const fit = (rings[k].length * ARC) / TAU;
      radius[k] = k === 0 ? (rings[0].length > 1 ? Math.max(fit, SUBJECT_R * 1.6) : 0) : Math.max(fit, radius[k - 1] + ringGap(k - 1));
      spread(k);
    }
    planLegs();
    tracks = assignTracks();
  }
  for (let k = 1; k < rings.length; k++) radius[k] = Math.max(radius[k], radius[k - 1] + ringGap(k - 1));
  planLegs();
  assignTracks();

  const pol = (r: number, a: number): [number, number] => [round(r * Math.cos(a)), round(r * Math.sin(a))];
  const edges: Disc['edges'] = routes.map((rt) => {
    const rs = radius[depth.get(rt.from)!];
    const lateral = depth.get(rt.to)! <= depth.get(rt.from)!;
    // Normal links arrive from inside the target's ring; loop links come back in from outside it.
    const end = radius[depth.get(rt.to)!] + (lateral ? SUBJECT_R : -SUBJECT_R);
    const startAngle = rs > 0 ? rt.dep : (rt.legs[0]?.from ?? rt.arr);
    const path: PathCmd[] = [['M', ...pol(rs > 0 ? rs + SUBJECT_R : SUBJECT_R, startAngle)]];
    for (const leg of rt.legs) {
      const rT = trackR(leg.gap, leg.track);
      if (!needsArc(leg)) {
        // A tiny sideways step: a short jog on the track, so the long runs either side stay radial.
        path.push(['L', ...pol(rT - FILLET, leg.from)], ['L', ...pol(lateral ? rT - FILLET : rT + FILLET, leg.to)]);
        continue;
      }
      const d = turn(leg.from, leg.to);
      const dir = Math.sign(d);
      // Short turns get smaller corners, so every turn is spoke, corner, arc, corner, spoke.
      const f = Math.min(FILLET, (Math.abs(d) * rT) / 2 - 0.5);
      const da = f / rT;
      const a0 = leg.from + dir * da;
      // Derive the end from the start and the (short) turn, so the arc can never go the long way round.
      const a1 = a0 + dir * (Math.abs(d) - 2 * da);
      path.push(['L', ...pol(rT - f, leg.from)]);
      path.push(['Q', ...pol(rT, leg.from), ...pol(rT, a0)]);
      path.push(['A', 0, 0, round(rT), Math.round(a0 * 1e4) / 1e4, Math.round(a1 * 1e4) / 1e4, dir < 0]);
      path.push(['Q', ...pol(rT, leg.to), ...pol(lateral ? rT - f : rT + f, leg.to)]);
    }
    path.push(["L", ...pol(end, rt.arr)]);
    return { from: rt.from, to: rt.to, kind: rt.kind, path };
  });

  const nodes = all.map((c) => {
    const [x, y] = pol(radius[depth.get(c)!], angle.get(c)!);
    return { code: c, entry: entries.has(c), x, y };
  });
  return { r: radius[rings.length - 1] + SUBJECT_R, nodes, edges };
}

/** A circle's contents: its rings plus the circles nested inside it, packed without overlap. */
interface Box {
  id: string;
  kind: 'degree' | 'program';
  r: number;
  disc: Disc;
  discAt: { x: number; y: number };
  children: { box: Box; x: number; y: number }[];
  sharedBy?: string[];
}

type Packed = { r: number; x: number; y: number };

export function layoutMap(map: MapDoc): Layout {
  const degreeCodes = Object.keys(map.degrees).sort();

  // Who lists each program directly. One lister: nest inside it. Several: place it at the top level.
  const parents = new Map<string, string[]>();
  const listers: [string, Container][] = [
    ...degreeCodes.map((d) => [d, map.degrees[d].structure] as [string, Container]),
    ...Object.keys(map.programs)
      .sort()
      .map((p) => [p, map.programs[p].structure] as [string, Container]),
  ];
  for (const [id, c] of listers) for (const p of directPrograms(map, c)) if (p !== id) parents.set(p, [...(parents.get(p) ?? []), id]);
  const offeredBy = new Map<string, Set<string>>();
  const offer = (p: string, d: string, seen: Set<string>) => {
    if (seen.has(p)) return;
    seen.add(p);
    (offeredBy.get(p) ?? offeredBy.set(p, new Set()).get(p)!).add(d);
    for (const q of directPrograms(map, map.programs[p].structure)) offer(q, d, seen);
  };
  for (const d of degreeCodes) for (const p of directPrograms(map, map.degrees[d].structure)) offer(p, d, new Set());

  const topLevel = new Set(Object.keys(map.programs).filter((p) => (parents.get(p)?.length ?? 0) !== 1));
  const built = new Set<string>();

  function build(id: string, kind: 'degree' | 'program', stack: string[]): Box {
    built.add(id);
    const structure = kind === 'degree' ? map.degrees[id].structure : map.programs[id].structure;
    const disc = buildDisc(map, directSubjects(map, structure));
    const kids = [...directPrograms(map, structure)]
      .filter((p) => !topLevel.has(p) && !stack.includes(p) && !built.has(p))
      .sort()
      .map((p) => build(p, 'program', [...stack, id]));
    const items: (Packed & { box?: Box })[] = [{ r: disc.r + CHILD_GAP / 2, x: 0, y: 0 }, ...kids.map((b) => ({ r: b.r + CHILD_GAP / 2, x: 0, y: 0, box: b }))];
    packSiblings(items);
    const e = packEnclose(items)!;
    return {
      id,
      kind,
      r: e.r + PAD,
      disc,
      discAt: { x: items[0].x - e.x, y: items[0].y - e.y },
      children: items.slice(1).map((it) => ({ box: it.box!, x: it.x - e.x, y: it.y - e.y })),
    };
  }

  const tops: Box[] = degreeCodes.map((d) => build(d, 'degree', []));
  for (const p of [...topLevel].sort()) {
    if (built.has(p)) continue;
    const b = build(p, 'program', []);
    b.sharedBy = [...(offeredBy.get(p) ?? [])].sort();
    tops.push(b);
  }
  const placed = tops.map((b) => ({ r: b.r + TOP_GAP / 2, box: b, x: 0, y: 0 }));
  // Degrees first and largest first, so they settle in the middle with shared programs around them.
  placed.sort((a, b) => Number(b.box.kind === 'degree') - Number(a.box.kind === 'degree') || b.r - a.r || a.box.id.localeCompare(b.box.id));
  packSiblings(placed);

  const nodes: Record<string, LayoutNode> = {};
  const circles: LayoutCircle[] = [];
  const edges: LayoutEdge[] = [];
  const emit = (b: Box, x: number, y: number, parent: string | null) => {
    const structure = b.kind === 'degree' ? map.degrees[b.id].structure : map.programs[b.id].structure;
    circles.push({
      id: b.id,
      kind: b.kind,
      title: b.kind === 'degree' ? map.degrees[b.id].title : map.programs[b.id].title,
      x: round(x),
      y: round(y),
      r: Math.ceil(b.r),
      members: [...directSubjects(map, structure)].sort(),
      parent,
      ...(b.sharedBy ? { sharedBy: b.sharedBy } : {}),
    });
    const cx = x + b.discAt.x;
    const cy = y + b.discAt.y;
    const id = (code: string) => `${b.id}/${code}`;
    for (const n of b.disc.nodes) {
      nodes[id(n.code)] = { id: id(n.code), code: n.code, circle: b.id, x: round(cx + n.x), y: round(cy + n.y), r: SUBJECT_R, ...(n.entry ? { entry: true } : {}) };
    }
    for (const e of b.disc.edges) {
      edges.push({ from: id(e.from), to: id(e.to), fromCode: e.from, toCode: e.to, kind: e.kind, path: e.path.map((c) => shift(c, cx, cy)) });
    }
    for (const ch of b.children) emit(ch.box, x + ch.x, y + ch.y, b.id);
  };
  for (const p of placed) emit(p.box, p.x, p.y, null);
  circles.sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));

  const bounds = {
    minX: Math.min(...circles.map((c) => c.x - c.r)) - 40,
    minY: Math.min(...circles.map((c) => c.y - c.r)) - 140,
    maxX: Math.max(...circles.map((c) => c.x + c.r)) + 40,
    maxY: Math.max(...circles.map((c) => c.y + c.r)) + 40,
  };
  return { nodes, circles, edges, bounds };
}

function shift(c: PathCmd, dx: number, dy: number): PathCmd {
  switch (c[0]) {
    case 'M':
    case 'L':
      return [c[0], round(c[1] + dx), round(c[2] + dy)];
    case 'Q':
      return ['Q', round(c[1] + dx), round(c[2] + dy), round(c[3] + dx), round(c[4] + dy)];
    case 'A':
      return ['A', round(c[1] + dx), round(c[2] + dy), c[3], c[4], c[5], c[6]];
  }
}

/** Points along a path, about `step` world units apart (for tests and geometry checks). */
export function samplePath(path: PathCmd[], step = 6): [number, number][] {
  const pts: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const c of path) {
    if (c[0] === 'M') {
      [x, y] = [c[1], c[2]];
      pts.push([x, y]);
    } else if (c[0] === 'L') {
      const n = Math.max(1, Math.ceil(Math.hypot(c[1] - x, c[2] - y) / step));
      for (let i = 1; i <= n; i++) pts.push([x + ((c[1] - x) * i) / n, y + ((c[2] - y) * i) / n]);
      [x, y] = [c[1], c[2]];
    } else if (c[0] === 'Q') {
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        pts.push([(1 - t) ** 2 * x + 2 * (1 - t) * t * c[1] + t * t * c[3], (1 - t) ** 2 * y + 2 * (1 - t) * t * c[2] + t * t * c[4]]);
      }
      [x, y] = [c[3], c[4]];
    } else {
      const [, cx, cy, r, a0, a1, ccw] = c;
      let sweep = a1 - a0;
      if (ccw && sweep > 0) sweep -= TAU;
      if (!ccw && sweep < 0) sweep += TAU;
      const n = Math.max(1, Math.ceil((Math.abs(sweep) * r) / step));
      for (let i = 1; i <= n; i++) pts.push([cx + r * Math.cos(a0 + (sweep * i) / n), cy + r * Math.sin(a0 + (sweep * i) / n)]);
      [x, y] = pts[pts.length - 1];
    }
  }
  return pts;
}

/**
 * The circle a click at world (x, y) means. Near an outline (within `rim` world units inside
 * it), the outline's circle wins, nearest outline first. Elsewhere, the smallest circle
 * containing the point; on a tie, the nearest centre.
 */
export function circleAt(layout: Pick<Layout, 'circles'>, x: number, y: number, rim = 0): LayoutCircle | null {
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

/** Copies of a subject on the map. */
export function copiesOf(layout: Layout, code: string): LayoutNode[] {
  return Object.values(layout.nodes).filter((n) => n.code === code);
}
