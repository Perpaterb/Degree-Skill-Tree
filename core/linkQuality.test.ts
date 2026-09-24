import { describe, expect, it } from 'vitest';
import type { Layout, LayoutEdge, PathCmd } from './layout.js';
import { linkQuality } from './linkQuality.js';

// The link measures back the US-024 layout test, so each is shown to fire on a known bad case.

const node = (id: string, x: number, y: number) => ({ id, code: id, circle: 'C', x, y, r: 22 });
const edge = (from: string, to: string, path: PathCmd[]): LayoutEdge => ({ from, to, fromCode: from, toCode: to, kind: 'req', path });
const layoutOf = (nodes: ReturnType<typeof node>[], edges: LayoutEdge[]): Layout => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  circles: [],
  edges,
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
});
// Four subjects far from every path below, so no link passes over one.
const far = ['a', 'b', 'c', 'd'].map((id, i) => node(id, 1000 + i * 100, 1000));

describe('linkQuality (US-024 measures)', () => {
  it('counts two links running side by side, 1 unit apart', () => {
    const q = linkQuality(layoutOf(far, [edge('a', 'b', [['M', 0, 0], ['L', 100, 0]]), edge('c', 'd', [['M', 0, 1], ['L', 100, 1]])]));
    expect(q.runningTogether).toBe(1);
  });

  it('does not count two links in line with each other but 15 units apart', () => {
    const q = linkQuality(layoutOf(far, [edge('a', 'b', [['M', 0, 0], ['L', 100, 0]]), edge('c', 'd', [['M', 115, 0], ['L', 215, 0]])]));
    expect(q.runningTogether).toBe(0);
  });

  it('counts a crossing under 45 degrees as shallow, and a square one as fine', () => {
    const shallow = linkQuality(layoutOf(far, [edge('a', 'b', [['M', 0, 0], ['L', 100, 0]]), edge('c', 'd', [['M', 0, -18], ['L', 100, 18]])]));
    expect(shallow).toMatchObject({ crossings: 1, shallowCrossings: 1 });
    const square = linkQuality(layoutOf(far, [edge('a', 'b', [['M', 0, 0], ['L', 100, 0]]), edge('c', 'd', [['M', 50, -50], ['L', 50, 50]])]));
    expect(square).toMatchObject({ crossings: 1, shallowCrossings: 0 });
  });

  it('counts a link that passes over a subject that is not one of its ends', () => {
    const q = linkQuality(layoutOf([...far, node('x', 50, 0)], [edge('a', 'b', [['M', 0, 0], ['L', 100, 0]])]));
    expect(q.throughSubjects).toBe(1);
  });
});
