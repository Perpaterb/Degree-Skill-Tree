import { samplePath, type Layout } from './layout.js';

// How well the railway-style links read (US-024). Used by the layout tests and the build output,
// so both report the same numbers.

export interface LinkQuality {
  crossings: number;
  /** Crossings at under 45 degrees (the criterion asks for 45 to 135). */
  shallowCrossings: number;
  medianCrossingAngle: number;
  /** Pairs of links with no subject in common that run within 2px of each other at under 5 degrees. */
  runningTogether: number;
  /** Links whose path passes over a subject that is not one of their ends. */
  throughSubjects: number;
}

type Seg = [number, number, number, number];

/** Distance from a point to a segment. */
function pointGap(x: number, y: number, s: Seg): number {
  const vx = s[2] - s[0];
  const vy = s[3] - s[1];
  const t = Math.max(0, Math.min(1, ((x - s[0]) * vx + (y - s[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(x - s[0] - t * vx, y - s[1] - t * vy);
}

/** Shortest distance between two segments that do not cross. Measured between the segments
 * themselves, not their extended lines: two short pieces in line but far apart are not together. */
export function segmentGap(a: Seg, b: Seg): number {
  return Math.min(pointGap(a[0], a[1], b), pointGap(a[2], a[3], b), pointGap(b[0], b[1], a), pointGap(b[2], b[3], a));
}

export function linkQuality(layout: Layout, step = 4): LinkQuality {
  const segs: { e: number; s: Seg }[] = [];
  layout.edges.forEach((e, i) => {
    const p = samplePath(e.path, step);
    for (let k = 1; k < p.length; k++) segs.push({ e: i, s: [p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]] });
  });
  const cell = 12;
  const grid = new Map<string, number[]>();
  segs.forEach((g, i) => {
    const key = `${Math.floor(g.s[0] / cell)},${Math.floor(g.s[1] / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  const neighbours = (i: number) => {
    const [x, y] = segs[i].s;
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(grid.get(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy}`) ?? []));
    return out;
  };
  const cross = (a: Seg, b: Seg) => {
    const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
    const u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
  };
  const angles: number[] = [];
  const together = new Set<string>();
  // Each segment sits in exactly one grid cell and the nine cells around it are distinct, so every
  // pair (i < j) is visited once: no record of visited pairs is needed (at 444 degrees there are
  // more pairs than a Set can hold).
  for (let i = 0; i < segs.length; i++) {
    for (const j of neighbours(i)) {
      if (j <= i) continue;
      const A = segs[i];
      const B = segs[j];
      if (A.e === B.e) continue;
      const ea = layout.edges[A.e];
      const eb = layout.edges[B.e];
      // Lines meeting at the same subject touch there by design, like lines at a station.
      if (ea.from === eb.from || ea.to === eb.to || ea.from === eb.to || ea.to === eb.from) continue;
      const va = [A.s[2] - A.s[0], A.s[3] - A.s[1]];
      const vb = [B.s[2] - B.s[0], B.s[3] - B.s[1]];
      const cos = Math.abs(va[0] * vb[0] + va[1] * vb[1]) / (Math.hypot(va[0], va[1]) * Math.hypot(vb[0], vb[1]));
      const deg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
      if (cross(A.s, B.s)) angles.push(deg);
      else if (deg < 5 && segmentGap(A.s, B.s) < 2) together.add(A.e < B.e ? `${A.e}|${B.e}` : `${B.e}|${A.e}`);
    }
  }
  angles.sort((a, b) => a - b);

  const byCircle = new Map<string, { id: string; x: number; y: number; r: number }[]>();
  for (const n of Object.values(layout.nodes)) (byCircle.get(n.circle) ?? byCircle.set(n.circle, []).get(n.circle)!).push(n);
  let through = 0;
  for (const e of layout.edges) {
    const pts = samplePath(e.path, step);
    const circle = layout.nodes[e.from].circle;
    if ((byCircle.get(circle) ?? []).some((n) => n.id !== e.from && n.id !== e.to && pts.some(([x, y]) => Math.hypot(x - n.x, y - n.y) < n.r - 2))) through++;
  }

  return {
    crossings: angles.length,
    shallowCrossings: angles.filter((a) => a < 45).length,
    medianCrossingAngle: angles.length ? angles[Math.floor(angles.length / 2)] : 90,
    runningTogether: together.size,
    throughSubjects: through,
  };
}
