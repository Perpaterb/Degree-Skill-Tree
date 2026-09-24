import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { circleAt, layoutMap, type LayoutCircle } from './layout.js';
import { linkQuality } from './linkQuality.js';
import type { MapDoc } from './model.js';

const map: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const { layout: stored, ...bare } = map;
const layout = layoutMap(bare as MapDoc);
const nodes = Object.values(layout.nodes);
const circle = (id: string) => layout.circles.find((c) => c.id === id)!;
const inside = (x: number, y: number, r: number, c: LayoutCircle) => Math.hypot(x - c.x, y - c.y) + r <= c.r + 0.5;

describe('US-020: circles that never overlap, with linked copies', () => {
  it('draws a circle for every degree and program', () => {
    for (const d of Object.keys(map.degrees)) expect(circle(d)?.kind, d).toBe('degree');
    for (const p of Object.keys(map.programs)) expect(circle(p)?.kind, p).toBe('program');
  });

  it('gives every circle a copy of each subject it lists, inside it', () => {
    const missing: string[] = [];
    for (const c of layout.circles) {
      for (const m of c.members) {
        const n = layout.nodes[`${c.id}/${m}`];
        if (!n || !inside(n.x, n.y, n.r, c)) missing.push(`${m} in ${c.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never lets two circles partly overlap: they are apart, or one contains the other as its parent chain says', () => {
    const bad: string[] = [];
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let p = circle(id).parent; p; p = circle(p).parent) out.push(p);
      return out;
    };
    for (let i = 0; i < layout.circles.length; i++)
      for (let j = i + 1; j < layout.circles.length; j++) {
        const a = layout.circles[i];
        const b = layout.circles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= a.r + b.r) continue;
        const [big, small] = a.r >= b.r ? [a, b] : [b, a];
        if (!inside(small.x, small.y, small.r, big) || !ancestors(small.id).includes(big.id)) bad.push(`${a.id}/${b.id}`);
      }
    expect(bad).toEqual([]);
  });

  it('nests a program listed by one degree or program inside it, and puts one listed by several at the top level', () => {
    const listers = new Map<string, Set<string>>();
    const walk = (owner: string, c: MapDoc['degrees'][string]['structure']) => {
      for (const i of c.items) if (i.kind === 'program') (listers.get(i.code) ?? listers.set(i.code, new Set()).get(i.code)!).add(owner);
      c.children.forEach((ch) => walk(owner, ch));
    };
    for (const [id, d] of Object.entries(map.degrees)) walk(id, d.structure);
    for (const [id, p] of Object.entries(map.programs)) walk(id, p.structure);
    for (const [p, who] of listers) {
      if (who.size === 1) expect(circle(p).parent, p).toBe([...who][0]);
      else expect([circle(p).parent, !!circle(p).sharedBy?.length], p).toEqual([null, true]);
    }
  });

  it('leaves no two subject copies overlapping', () => {
    const overlaps: string[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < nodes[i].r + nodes[j].r) overlaps.push(`${nodes[i].id}/${nodes[j].id}`);
    expect(overlaps).toEqual([]);
  });

  it('lists circles largest first, so contained ones are drawn on top', () => {
    const radii = layout.circles.map((c) => c.r);
    expect([...radii].sort((a, b) => b - a)).toEqual(radii);
  });

  it('is deterministic, and matches the layout stored with the map', () => {
    expect(JSON.stringify(layoutMap(bare as MapDoc))).toBe(JSON.stringify(layout));
    expect(JSON.stringify(stored)).toBe(JSON.stringify(layout));
  });
});

describe('US-020: rings by prerequisite depth', () => {
  it('runs a link outward to a further ring, except loop links in the source data, which run sideways along one ring', () => {
    // A loop: each subject accepts the other (directly or via a chain) as a prerequisite alternative.
    const inLoop = (from: string, to: string) => {
      const seen = new Set<string>();
      const stack = [from];
      while (stack.length) {
        const c = stack.pop()!;
        if (c === to && seen.size) return true;
        if (seen.has(c)) continue;
        seen.add(c);
        const reqs = JSON.stringify(map.subjects[c]?.requisite ?? null).match(/"subject":"([^"]+)"/g) ?? [];
        stack.push(...reqs.map((r) => r.slice(11, -1)));
      }
      return false;
    };
    const wrong: string[] = [];
    let loops = 0;
    for (const e of layout.edges) {
      const arc = e.path.find((c) => c[0] === 'A');
      if (!arc) continue;
      const [, cx, cy] = arc;
      const ra = Math.hypot(layout.nodes[e.from].x - cx, layout.nodes[e.from].y - cy);
      const rb = Math.hypot(layout.nodes[e.to].x - cx, layout.nodes[e.to].y - cy);
      if (rb > ra + 1) continue;
      // Every subject in a loop shares a ring, so its links never cut across other rings.
      if (inLoop(e.fromCode, e.toCode) && Math.abs(rb - ra) < 1) loops++;
      else wrong.push(`${e.from} -> ${e.toCode} (ring ${ra.toFixed(0)} to ${rb.toFixed(0)})`);
    }
    expect(wrong).toEqual([]);
    // The Japanese subjects 97207 to 97210 each accept any of the others; the Chinese 97109 and 97112 too.
    expect(loops).toBeGreaterThan(0);
  });
});

describe('US-024: railway-style links', () => {
  it('keeps every link inside one circle, using entry copies for prerequisites from elsewhere', () => {
    const crossing = layout.edges.filter((e) => layout.nodes[e.from].circle !== layout.nodes[e.to].circle);
    expect(crossing).toEqual([]);
    const entries = nodes.filter((n) => n.entry);
    for (const n of entries) expect(circle(n.circle).members, n.id).not.toContain(n.code);
  });

  it('draws links as spokes and ring-following arcs with rounded corners', () => {
    const kinds = new Set(layout.edges.flatMap((e) => e.path.map((c) => c[0])));
    expect([...kinds].sort()).toEqual(['A', 'L', 'M', 'Q']);
  });

  it('crosses only at 45 to 135 degrees, never runs two links together, and never passes over a subject', () => {
    expect(linkQuality(layout)).toMatchObject({ shallowCrossings: 0, runningTogether: 0, throughSubjects: 0 });
  });
});

describe('circleAt (US-020: clicking picks the circle under the pointer)', () => {
  const c = (id: string, x: number, y: number, r: number): LayoutCircle => ({ id, kind: 'program', title: id, x, y, r, members: [], parent: null });
  const L = { circles: [c('big', 0, 0, 100), c('a', -10, 0, 40), c('b', 10, 0, 40)] };

  it('picks the smallest circle containing the point', () => {
    expect(circleAt(L, 0, 80)?.id).toBe('big');
    expect(circleAt(L, -45, 0)?.id).toBe('a');
  });

  it('breaks a tie between equal circles by the nearest centre', () => {
    expect(circleAt(L, -3, 0)?.id).toBe('a');
    expect(circleAt(L, 3, 0)?.id).toBe('b');
  });

  it('prefers the nearest outline when the point is on a rim', () => {
    expect(circleAt(L, 0, 95, 10)?.id).toBe('big');
    expect(circleAt(L, -48, 0, 10)?.id).toBe('a');
  });

  it('returns nothing outside every circle', () => {
    expect(circleAt(L, 500, 500)).toBeNull();
  });

  it('gives every circle on the real map a spot that resolves to it', () => {
    const hidden = layout.circles.filter((k) => {
      for (const f of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99])
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const r = f === 0.99 ? k.r - 5 : k.r * f;
          if (circleAt(layout, k.x + r * Math.cos(a), k.y + r * Math.sin(a), 12) === k) return false;
        }
      return true;
    });
    expect(hidden.map((k) => k.id)).toEqual([]);
  });
});
