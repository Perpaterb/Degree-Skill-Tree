import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Container, TreeDoc } from '../../core/model.js';
import { toRule } from '../src/normalize.js';
import { parseAccessConditions } from '../src/access.js';

// US-003: checks run against the committed normalised output, so they need no network or raw cache.
const tree: TreeDoc = JSON.parse(readFileSync(new URL('../../web/public/trees/uts-2027-C10148.json', import.meta.url), 'utf8'));

function allItems(c: Container, out: Container['items'] = []): Container['items'] {
  out.push(...c.items);
  c.children.forEach((ch) => allItems(ch, out));
  return out;
}

describe('US-003: C10148 Bachelor of IT (2027) normalised', () => {
  it('has a 144cp structure made of Core, Major and Options at 48cp each', () => {
    const s = tree.degree.structure;
    expect(tree.degree.creditPoints).toBe(144);
    expect(s.creditPoints).toBe(144);
    expect(s.children.map((c) => [c.title, c.creditPoints])).toEqual([
      ['Core - Information Technology', 48],
      ['Major - Information Technology', 48],
      ['Options', 48],
    ]);
  });

  it('keeps "select N cp" semantics: 42cp compulsory + 6cp choice of 2 programming subjects', () => {
    const core = tree.degree.structure.children[0];
    const compulsory = core.children.find((c) => c.title === 'Compulsory')!;
    const options = core.children.find((c) => c.title === 'Options')!;
    expect(compulsory.creditPoints).toBe(42);
    expect(compulsory.items).toHaveLength(7);
    expect(options.creditPoints).toBe(6);
    expect(options.items.map((i) => i.code).sort()).toEqual(['41039', '48023']);
  });

  it('marks free-elective containers as free', () => {
    const free = tree.degree.structure.children[2].children.filter((c) => c.kind === 'free');
    expect(free.length).toBeGreaterThan(0);
  });

  it('resolves every structure item to a subject or program in the tree', () => {
    const items = [tree.degree.structure, ...Object.values(tree.programs).map((p) => p.structure)].flatMap((c) => allItems(c));
    for (const i of items) {
      if (i.kind === 'subject') expect(tree.subjects[i.code], i.code).toBeDefined();
      else expect(tree.programs[i.code], i.code).toBeDefined();
    }
  });

  it('keeps missing handbook items as legacy rather than dropping them', () => {
    expect(tree.programs.SMJ10196?.legacy).toBe(true);
    for (const code of ['48033', '21129', '31256']) expect(tree.subjects[code]?.legacy, code).toBe(true);
  });

  it('carries requisite rules with no unresolved refs', () => {
    const r = tree.subjects['31272'].requisite;
    expect(r).toMatchObject({ op: 'and' });
    expect(JSON.stringify(r)).not.toContain('"ref"');
  });

  it('keeps study plans as ordered year/session periods', () => {
    const plan = tree.degree.studyPlans[0];
    expect(plan.periods[0].name).toBe('Year 1 / Autumn session');
    expect(plan.periods.length).toBeGreaterThanOrEqual(6);
  });
});

describe('toRule', () => {
  it('replaces refs with their items', () => {
    const html = readFileSync(new URL('./fixtures/ac_31272.html', import.meta.url), 'utf8');
    const rule = toRule(parseAccessConditions(html).requisites);
    expect(rule).toMatchObject({ op: 'and', args: [{ subject: '31269' }, { op: 'or' }, { op: 'or' }] });
    expect(JSON.stringify(rule)).toContain('"creditPoints":72');
  });
});
