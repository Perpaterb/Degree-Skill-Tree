import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Container, MapDoc } from '../../core/model.js';
import { toRule } from '../src/normalize.js';
import { parseAccessConditions } from '../src/access.js';

// US-003: checks run against the committed normalised output, so they need no network or raw cache.
const map: MapDoc = JSON.parse(readFileSync(new URL('../../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const bit = map.degrees.C10148;

function allItems(c: Container, out: Container['items'] = []): Container['items'] {
  out.push(...c.items);
  c.children.forEach((ch) => allItems(ch, out));
  return out;
}

describe('US-019: several degrees on one map', () => {
  it('holds the four 2027 degrees', () => {
    expect(Object.keys(map.degrees).sort()).toEqual(['C10026', 'C10148', 'C10471', 'C10476']);
  });

  it('shares programs and subjects between degrees rather than duplicating them', () => {
    // Subjects are keyed by code, so each exists once; check that sharing actually happens.
    const inDegrees = new Map<string, number>();
    for (const d of Object.values(map.degrees)) {
      const seen = new Set(allItems(d.structure).map((i) => i.code));
      for (const c of seen) inDegrees.set(c, (inDegrees.get(c) ?? 0) + 1);
    }
    expect([...inDegrees.values()].some((n) => n > 1)).toBe(true);
  });
});

describe('US-003: C10148 Bachelor of IT (2027) normalised', () => {
  it('has a 144cp structure made of Core, Major and Options at 48cp each', () => {
    const s = bit.structure;
    expect(bit.creditPoints).toBe(144);
    expect(s.creditPoints).toBe(144);
    expect(s.children.map((c) => [c.title, c.creditPoints])).toEqual([
      ['Core - Information Technology', 48],
      ['Major - Information Technology', 48],
      ['Options', 48],
    ]);
  });

  it('keeps "select N cp" semantics: 42cp compulsory + 6cp choice of 2 programming subjects', () => {
    const core = bit.structure.children[0];
    const compulsory = core.children.find((c) => c.title === 'Compulsory')!;
    const options = core.children.find((c) => c.title === 'Options')!;
    expect(compulsory.creditPoints).toBe(42);
    expect(compulsory.items).toHaveLength(7);
    expect(options.creditPoints).toBe(6);
    expect(options.items.map((i) => i.code).sort()).toEqual(['41039', '48023']);
  });

  it('gives every structure container on the map a real id of its own', () => {
    const ids: string[] = [];
    const walk = (c: Container) => (ids.push(c.id), c.children.forEach(walk));
    for (const d of Object.values(map.degrees)) walk(d.structure);
    for (const p of Object.values(map.programs)) walk(p.structure);
    expect(ids.filter((id) => !id || id.includes('[object'))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks free-elective containers as free', () => {
    const free = bit.structure.children[2].children.filter((c) => c.kind === 'free');
    expect(free.length).toBeGreaterThan(0);
  });

  it('resolves every structure item to a subject or program in the tree', () => {
    const items = [...Object.values(map.degrees), ...Object.values(map.programs)].flatMap((x) => allItems(x.structure));
    for (const i of items) {
      if (i.kind === 'subject') expect(map.subjects[i.code], i.code).toBeDefined();
      else expect(map.programs[i.code], i.code).toBeDefined();
    }
  });

  it('keeps missing handbook items as legacy rather than dropping them', () => {
    expect(map.programs.SMJ10196?.legacy).toBe(true);
    for (const code of ['48033', '21129', '31256']) expect(map.subjects[code]?.legacy, code).toBe(true);
  });

  it('carries requisite rules with no unresolved refs', () => {
    const r = map.subjects['31272'].requisite;
    expect(r).toMatchObject({ op: 'and' });
    expect(JSON.stringify(r)).not.toContain('"ref"');
  });

  it('keeps study plans as ordered year/session periods', () => {
    const plan = bit.studyPlans[0];
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
