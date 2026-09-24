import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutTree } from './layout.js';
import type { TreeDoc } from './model.js';

const tree: TreeDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027-C10148.json', import.meta.url), 'utf8'));
const layout = layoutTree(tree);
const nodes = Object.values(layout.nodes);

describe('US-004: automatic layout of C10148', () => {
  it('places the degree hub, every program and every subject exactly once', () => {
    expect(layout.nodes[tree.degree.code].kind).toBe('degree');
    for (const code of Object.keys(tree.programs)) expect(layout.nodes[code]?.kind, code).toBe('program');
    for (const code of Object.keys(tree.subjects)) expect(layout.nodes[code]?.kind, code).toBe('subject');
    expect(nodes).toHaveLength(1 + Object.keys(tree.programs).length + Object.keys(tree.subjects).length);
  });

  it('leaves no two nodes overlapping', () => {
    const overlaps: string[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) overlaps.push(`${a.id}/${b.id}`);
      }
    expect(overlaps).toEqual([]);
  });

  it('keeps every subject inside its cluster halo', () => {
    const clusters = new Map(layout.clusters.map((c) => [c.id, c]));
    const outside = nodes
      .filter((n) => n.kind === 'subject')
      .filter((n) => {
        const c = clusters.get(n.cluster)!;
        return Math.hypot(n.x - c.x, n.y - c.y) > c.radius + 5;
      })
      .map((n) => n.id);
    expect(outside).toEqual([]);
  });

  it('keeps clusters apart', () => {
    const cs = layout.clusters;
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        expect(Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y), `${cs[i].id}/${cs[j].id}`).toBeGreaterThan(cs[i].radius + cs[j].radius);
  });

  it('draws requisite links, marking OR alternatives separately', () => {
    const into31272 = layout.edges.filter((e) => e.to === '31272');
    expect(into31272.find((e) => e.from === '31269')?.kind).toBe('req');
    expect(into31272.find((e) => e.from === '31265')?.kind).toBe('alt');
  });

  it('puts subjects with deeper requisite chains further from their cluster centre', () => {
    const hub = layout.nodes[tree.degree.code];
    const dist = (c: string) => Math.hypot(layout.nodes[c].x - hub.x, layout.nodes[c].y - hub.y);
    // 31272 needs 31269; both are core.
    expect(dist('31272')).toBeGreaterThan(dist('31269'));
  });

  it('is deterministic', () => {
    expect(JSON.stringify(layoutTree(tree))).toBe(JSON.stringify(layout));
  });
});
