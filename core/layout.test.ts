import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { programsUnder } from './engine.js';
import { circleAt, enclose, foreignInside, layoutMap } from './layout.js';
import type { MapDoc } from './model.js';

const map: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const { layout: stored, ...bare } = map;
const layout = layoutMap(bare as MapDoc);
const nodes = Object.values(layout.nodes);
const circle = (id: string) => layout.circles.find((c) => c.id === id)!;

describe('US-020: degrees and programs as enclosing circles', () => {
  it('places every subject once and draws a circle for every degree and program', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(Object.keys(map.subjects).sort());
    for (const d of Object.keys(map.degrees)) expect(circle(d)?.kind, d).toBe('degree');
    for (const p of Object.keys(map.programs)) expect(circle(p)?.kind, p).toBe('program');
  });

  it('puts every subject inside every circle that lists it', () => {
    const outside: string[] = [];
    for (const c of layout.circles) {
      for (const m of c.members) {
        const n = layout.nodes[m];
        if (Math.hypot(n.x - c.x, n.y - c.y) + n.r > c.r + 0.5) outside.push(`${m} outside ${c.id}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('puts every program circle inside the circle of each degree that offers it', () => {
    const outside: string[] = [];
    for (const d of Object.keys(map.degrees)) {
      const dc = circle(d);
      for (const p of programsUnder(map, map.degrees[d].structure)) {
        const pc = circle(p);
        if (Math.hypot(pc.x - dc.x, pc.y - dc.y) + pc.r > dc.r + 0.5) outside.push(`${p} outside ${d}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('leaves no two subjects overlapping', () => {
    const overlaps: string[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < nodes[i].r + nodes[j].r) overlaps.push(`${nodes[i].id}/${nodes[j].id}`);
    expect(overlaps).toEqual([]);
  });

  it('draws requisite links, marking OR alternatives separately', () => {
    const into = layout.edges.filter((e) => e.to === '31272');
    expect(into.find((e) => e.from === '31269')?.kind).toBe('req');
    expect(into.find((e) => e.from === '31265')?.kind).toBe('alt');
  });

  it('lists circles largest first, so smaller ones are drawn on top and win clicks', () => {
    const radii = layout.circles.map((c) => c.r);
    expect([...radii].sort((a, b) => b - a)).toEqual(radii);
  });

  it('is deterministic, and matches the layout stored with the map', () => {
    expect(JSON.stringify(layoutMap(bare as MapDoc))).toBe(JSON.stringify(layout));
    expect(JSON.stringify(stored)).toBe(JSON.stringify(layout));
  });

  it('keeps subjects inside circles that do not list them within a regression budget', () => {
    // Overlapping circles inevitably cover some non-members. This is a quality measure, not a
    // correctness rule: the budget is set from the first real layout and should only go down.
    const foreign = foreignInside(layout).length;
    console.log(`subject-in-foreign-circle cases: ${foreign}`);
    expect(foreign).toBeLessThanOrEqual(FOREIGN_BUDGET);
  });
});

describe('circleAt (US-020: clicking empty space picks the smallest circle there)', () => {
  const c = (id: string, x: number, y: number, r: number) => ({ id, kind: 'program' as const, title: id, x, y, r, members: [] });
  const L = { nodes: {}, edges: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, circles: [c('big', 0, 0, 100), c('a', -10, 0, 40), c('b', 10, 0, 40)] };

  it('picks the smallest circle containing the point', () => {
    expect(circleAt(L, 0, 80)?.id).toBe('big');
    expect(circleAt(L, -45, 0)?.id).toBe('a');
  });

  it('breaks a tie between equal circles by the nearest centre, so neither is ever hidden', () => {
    expect(circleAt(L, -3, 0)?.id).toBe('a');
    expect(circleAt(L, 3, 0)?.id).toBe('b');
  });

  it('returns nothing outside every circle', () => {
    expect(circleAt(L, 500, 500)).toBeNull();
  });

  it('prefers the nearest outline when the point is on a rim', () => {
    expect(circleAt(L, 0, 95, 10)?.id).toBe('big'); // inside big's rim band
    expect(circleAt(L, -48, 0, 10)?.id).toBe('a'); // a's rim, even though big also contains it
  });

  it('gives every circle on the real map a spot that resolves to it (rim of 12 world units)', () => {
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

describe('enclose', () => {
  it('finds the smallest circle around two circles', () => {
    const c = enclose([
      { x: 0, y: 0, r: 10 },
      { x: 100, y: 0, r: 10 },
    ]);
    expect(c.x).toBeCloseTo(50, 0);
    expect(c.y).toBeCloseTo(0, 0);
    expect(c.r).toBeCloseTo(60, 0);
  });

  it('covers every input circle exactly', () => {
    const cs = [
      { x: 0, y: 0, r: 5 },
      { x: 40, y: 30, r: 25 },
      { x: -20, y: 60, r: 8 },
    ];
    const c = enclose(cs);
    for (const k of cs) expect(Math.hypot(k.x - c.x, k.y - c.y) + k.r).toBeLessThanOrEqual(c.r + 1e-6);
  });
});

// First four-degree layout, 24 Sep 2026: 2069. Raised to 2087 the same day, deliberately: twin
// programs (identical circles) are now grown apart so both stay selectable. See the test above.
const FOREIGN_BUDGET = 2087;
