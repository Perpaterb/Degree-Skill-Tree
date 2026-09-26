import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awayArea, circleAt, facultiesOf, facultyOrder, layoutMap, type LayoutCircle } from './layout.js';
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
    // Every pair: about 123 million on the whole-handbook map (US-043).
  }, 120_000);

  it('lists circles largest first, so contained ones are drawn on top', () => {
    const radii = layout.circles.map((c) => c.r);
    expect([...radii].sort((a, b) => b - a)).toEqual(radii);
  });

  it('is deterministic, and matches the layout stored with the map', () => {
    expect(JSON.stringify(layoutMap(bare as MapDoc))).toBe(JSON.stringify(layout));
    expect(JSON.stringify(stored)).toBe(JSON.stringify(layout));
    // A second full layout: about 30 s on the whole-handbook map (US-043).
  }, 180_000);
});

describe('US-020: circle titles above their circles', () => {
  // Nearest point of an axis-aligned box to (x, y).
  const gap = (b: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
    Math.hypot(x - Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2)), y - Math.max(b.y, Math.min(y, b.y + b.h)));
  const ancestors = (id: string) => {
    const out = new Set<string>();
    for (let p = circle(id).parent; p; p = circle(p).parent) out.add(p);
    return out;
  };

  it('puts every title above its own circle, centred on it', () => {
    for (const c of layout.circles) {
      expect(c.label.y + c.label.h, c.id).toBeLessThan(c.y - c.r);
      expect(Math.abs(c.label.x - c.x), c.id).toBeLessThan(1);
      expect(c.label.lines.join(' '), c.id).toBe(c.title.trim().replace(/\s+/g, ' '));
    }
  });

  it('keeps every title clear of other circles, other titles and subjects, and inside the circles around it', () => {
    const bad: string[] = [];
    for (const c of layout.circles) {
      const b = c.label;
      const up = ancestors(c.id);
      for (const o of layout.circles) {
        if (o.id === c.id) continue;
        if (up.has(o.id)) {
          // Every corner of the title inside the enclosing circle.
          for (const [x, y] of [[b.x - b.w / 2, b.y], [b.x + b.w / 2, b.y], [b.x - b.w / 2, b.y + b.h], [b.x + b.w / 2, b.y + b.h]])
            if (Math.hypot(x - o.x, y - o.y) > o.r) bad.push(`${c.id} title leaves ${o.id}`);
        } else if (gap(b, o.x, o.y) < o.r) bad.push(`${c.id} title touches circle ${o.id}`);
        const q = o.label;
        if (Math.abs(b.x - q.x) * 2 < b.w + q.w && b.y < q.y + q.h && q.y < b.y + b.h) bad.push(`${c.id} title touches title ${o.id}`);
      }
      for (const n of nodes) if (gap(b, n.x, n.y) < n.r) bad.push(`${c.id} title touches subject ${n.id}`);
    }
    expect([...new Set(bad)]).toEqual([]);
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
  }, 120_000);
});

describe('US-042: faculty neighbourhoods', () => {
  const top = layout.circles.filter((c) => !c.parent);
  const b = layout.bounds;
  const width = b.maxX - b.minX;
  const single = (f: string) => top.filter((c) => c.kind === 'degree' && facultiesOf(map, c.id).length === 1 && facultiesOf(map, c.id)[0] === f);
  const meanX = (cs: LayoutCircle[]) => cs.reduce((t, c) => t + c.x, 0) / cs.length;

  it('spreads the map sideways: at least 1.5 times wider than tall', () => {
    expect(width / (b.maxY - b.minY)).toBeGreaterThanOrEqual(1.5);
  });

  it("puts the faculty with the most degrees in the middle, and the others out sideways in order of size", () => {
    const order = facultyOrder(map).filter((o) => single(o.faculty).length);
    const centre = (b.minX + b.maxX) / 2;
    const distance = order.map((o) => Math.abs(meanX(single(o.faculty)) - centre));
    expect(distance[0] / width).toBeLessThan(0.1);
    // Each of the next faculties sits no nearer the middle than the biggest.
    for (let i = 1; i < order.length; i++) expect(distance[i], order[i].faculty).toBeGreaterThan(distance[0]);
  });

  it('puts a program shared by two faculties between them', () => {
    const means = new Map(facultyOrder(map).filter((o) => single(o.faculty).length).map((o) => [o.faculty, meanX(single(o.faculty))]));
    const two = top.filter((c) => c.sharedBy && new Set(c.sharedBy.flatMap((d) => facultiesOf(map, d))).size === 2);
    expect(two.length).toBeGreaterThan(0);
    const outside = two.filter((c) => {
      const fs = [...new Set(c.sharedBy!.flatMap((d) => facultiesOf(map, d)))].filter((f) => means.has(f));
      if (fs.length < 2) return false;
      const [lo, hi] = fs.map((f) => means.get(f)!).sort((p, q) => p - q);
      // Between the faculties' middles, give or take the program's own size.
      return c.x < lo - c.r || c.x > hi + c.r;
    });
    expect(outside.map((c) => c.id)).toEqual([]);
  });

  it('pulls programs shared by more faculties closer to the middle', () => {
    const centre = (b.minX + b.maxX) / 2;
    const by = new Map<number, number[]>();
    for (const c of top.filter((c) => c.sharedBy)) {
      const n = new Set(c.sharedBy!.flatMap((d) => facultiesOf(map, d))).size;
      (by.get(n) ?? by.set(n, []).get(n)!).push(Math.abs(c.x - centre));
    }
    const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
    // Shared by one faculty against shared by three or more.
    const narrow = by.get(1) ?? [];
    const wide = [...by].filter(([n]) => n >= 3).flatMap(([, xs]) => xs);
    if (narrow.length && wide.length) expect(avg(wide)).toBeLessThan(avg(narrow));
  });
});

describe('US-050: courses offered only in another location are laid out apart', () => {
  const areas = layout.areas ?? [];
  const area = (id: string) => areas.find((a) => a.id === id)!;
  // Read from each course's locations, not a list of codes.
  const away = Object.keys(map.degrees).filter((d) => awayArea(map, d));
  const within = (c: LayoutCircle, a: { x: number; y: number; w: number; h: number }) =>
    c.x - c.r >= a.x && c.x + c.r <= a.x + a.w && c.y - c.r >= a.y && c.y + c.r <= a.y + a.h;

  it('finds the 7 China and 2 Vietnam courses from their locations', () => {
    expect(away.filter((d) => awayArea(map, d) === 'China')).toHaveLength(7);
    expect(away.filter((d) => awayArea(map, d) === 'Vietnam')).toHaveLength(2);
    expect(awayArea(map, 'C10148')).toBeNull();
    expect(areas.map((a) => [a.id, a.title])).toEqual([
      ['China', 'Offered only in China'],
      ['Vietnam', 'Offered only in Ho Chi Minh City, Vietnam'],
    ]);
  });

  it('puts every offshore-only course, with its title, inside its own area', () => {
    const out = away.filter((d) => {
      const c = circle(d);
      const a = area(awayArea(map, d)!);
      return !within(c, a) || c.label.x - c.label.w / 2 < a.x || c.label.x + c.label.w / 2 > a.x + a.w || c.label.y < a.y;
    });
    expect(out).toEqual([]);
  });

  it('puts majors and subjects used only by offshore courses inside their area too', () => {
    const at = (c: LayoutCircle): string | null => (c.parent ? at(circle(c.parent)) : map.degrees[c.id] ? awayArea(map, c.id) : null);
    // Programs whose circle sits under an offshore course, and subject copies drawn there.
    const offshorePrograms = layout.circles.filter((c) => map.programs[c.id] && at(c));
    expect(offshorePrograms.length).toBeGreaterThanOrEqual(5);
    const outside = offshorePrograms.filter((c) => !within(c, area(at(c)!)));
    expect(outside.map((c) => c.id)).toEqual([]);
    const copies = nodes.filter((n) => at(circle(n.circle)));
    expect(copies.length).toBeGreaterThan(100);
    expect(copies.filter((n) => !within({ ...circle(n.circle), x: n.x, y: n.y, r: n.r }, area(at(circle(n.circle))!))).map((n) => n.id)).toEqual([]);
  });

  it('keeps every other circle out of the areas, and the areas to the right of the main map', () => {
    expect(areas).toHaveLength(2);
    const intruders = layout.circles.filter((c) => !c.parent && !away.includes(c.id) && areas.some((a) => c.x + c.r > a.x && c.x - c.r < a.x + a.w && c.y + c.r > a.y && c.y - c.r < a.y + a.h));
    expect(intruders.map((c) => c.id)).toEqual([]);
    const mainRight = Math.max(...layout.circles.filter((c) => !c.parent && !away.includes(c.id)).map((c) => c.x + c.r));
    for (const a of areas) expect(a.x, a.id).toBeGreaterThan(mainRight);
    // Titles sit above their frame.
    for (const a of areas) expect(a.label.y + a.label.h, a.id).toBeLessThanOrEqual(a.y);
  });
});

describe('circleAt (US-020: clicking picks the circle under the pointer)', () => {
  const c = (id: string, x: number, y: number, r: number): LayoutCircle => ({
    id,
    kind: 'program',
    title: id,
    x,
    y,
    r,
    members: [],
    parent: null,
    label: { lines: [id], size: 28, x, y: y - r - 40, w: 40, h: 34 },
  });
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
