import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyPlan, programsUnder } from './engine.js';
import type { MapDoc } from './model.js';
import { addOnCode, chosenDegrees, combinedOf, degreeLocks, pairingLocks, partnersOf } from './pairs.js';

// Real 2027 data, as built (pairDegrees runs in the map build).
const map: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const layout = map.layout!;
const BSE = addOnCode('Bachelor of Sustainability and Environment');
const BCII = addOnCode('Bachelor of Creative Intelligence and Innovation');
const BIS = addOnCode('Bachelor of International Studies (Honours)');
const doubles = Object.values(map.degrees).filter((d) => d.titleParts?.length === 2);

describe('US-048: double degrees from two halves', () => {
  it('gives every double its two halves except Education Futures, which has none', () => {
    expect(doubles).toHaveLength(92);
    expect(doubles.filter((d) => !d.halves).map((d) => d.code)).toEqual(['C10480']);
  });

  it('pairs two stand-alone degrees in either order', () => {
    expect(map.degrees.C10219.halves).toEqual(['C10148', 'C10026']);
    expect(combinedOf(map, 'C10148', 'C10026')).toBe('C10219');
    expect(combinedOf(map, 'C10026', 'C10148')).toBe('C10219');
    expect(combinedOf(map, 'C10148', 'C10476')).toBeNull();
    expect(chosenDegrees(map, 'C10219')).toEqual(['C10148', 'C10026']);
    expect(chosenDegrees(map, 'C10148')).toEqual(['C10148']);
  });

  it('finds the Bachelor of Business its 13 partners', () => {
    expect(partnersOf(map, 'C10026').size).toBe(13);
    expect(partnersOf(map, 'C10026').get(BSE)).toBe('C10411');
  });

  it('draws no circle for a double built from halves, and draws each half', () => {
    const ids = new Set(layout.circles.map((c) => c.id));
    expect(doubles.filter((d) => d.halves && ids.has(d.code)).map((d) => d.code)).toEqual([]);
    expect(ids.has('C10480')).toBe(true);
    for (const d of doubles) for (const h of d.halves ?? []) expect(ids.has(h), h).toBe(true);
  });

  it('puts what a double adds inside the half it belongs to, in a group for those doubles', () => {
    const groups = Object.values(map.programs).filter((p) => p.onlyWith);
    expect(groups.length).toBeGreaterThan(20);
    for (const g of groups) {
      const c = layout.circles.find((k) => k.id === g.code)!;
      expect(c.parent, g.code).toBe(g.onlyWith!.half);
      for (const dc of g.onlyWith!.combined) expect(map.degrees[dc].halves, dc).toContain(g.onlyWith!.half);
      // Nothing in a group is already in either half on its own.
      for (const dc of g.onlyWith!.combined)
        for (const h of map.degrees[dc].halves!) for (const i of g.structure.items) if (i.kind === 'program') expect(programsUnder(map, map.degrees[h].structure).has(i.code), `${i.code} in ${h}`).toBe(false);
    }
  });
});

describe('US-049: add-on halves', () => {
  it('makes one degree per add-on half, from the section its doubles share', () => {
    expect(map.degrees[BCII].addOn!.combined).toHaveLength(26);
    expect(map.degrees[BIS].addOn!.combined).toHaveLength(10);
    expect(map.degrees[BSE].addOn!.combined).toHaveLength(7);
    expect(map.degrees.C10411.halves).toEqual(['C10026', BSE]);
    // Sustainability and Environment's partner-specific streams are groups inside it.
    expect(map.degrees[BSE].extras?.length).toBeGreaterThan(0);
  });
});

describe('US-047 / US-049: degrees locked by the current choice', () => {
  it('with nothing chosen, locks only the add-on halves', () => {
    expect([...degreeLocks(map, null).keys()].sort()).toEqual([BCII, BIS, BSE].sort());
  });

  it('with the Bachelor of Science chosen, locks every degree it cannot pair with, master\'s and PhDs included, but not its partners', () => {
    const locks = degreeLocks(map, 'C10242');
    for (const shut of ['C10148', 'C10476', 'C04295', 'C02090']) expect(locks.get(shut), shut).toMatch(/not connected to your chosen degree.*unchoose Bachelor of Science/);
    // Partners, a master's among them, stay open; and so does the chosen degree.
    for (const open of ['C10242', 'C10026', 'C09066', 'C04255', BSE, BCII, BIS]) expect(locks.has(open), open).toBe(false);
    const courses = Object.values(map.degrees).filter((d) => !d.halves);
    expect(locks.size).toBe(courses.length - 1 - partnersOf(map, 'C10242').size);
  });

  it('with a double chosen, locks every other degree but not its halves', () => {
    const locks = degreeLocks(map, 'C10219');
    expect(locks.has('C10148') || locks.has('C10026')).toBe(false);
    for (const shut of ['C10476', BSE, 'C04295', 'C02090']) expect(locks.has(shut), shut).toBe(true);
  });

  it('with a master\'s chosen, locks the rest the same way', () => {
    const locks = degreeLocks(map, 'C04295');
    expect(locks.has('C04295')).toBe(false);
    for (const shut of ['C10242', 'C02090', BSE]) expect(locks.has(shut), shut).toBe(true);
  });
});

describe('US-048: what a double adds stays locked until that double is chosen', () => {
  it('locks every group and what it holds until one of its doubles is chosen', () => {
    const group = Object.values(map.programs).find((p) => p.onlyWith && p.structure.items.some((i) => i.kind === 'program'))!;
    const inner = group.structure.items.find((i) => i.kind === 'program')!.code;
    const none = pairingLocks(map, emptyPlan());
    expect(none.get(group.code)?.why).toBe('pairing');
    expect(none.has(inner)).toBe(true);
    const chosen = pairingLocks(map, { ...emptyPlan(), degree: group.onlyWith!.combined[0] });
    expect(chosen.has(group.code)).toBe(false);
    expect(chosen.has(inner)).toBe(false);
  });

  it('never locks a program a stand-alone degree also offers, even when a double adds it too', () => {
    const alone = new Set<string>();
    for (const d of Object.values(map.degrees)) if (!d.halves) for (const c of programsUnder(map, d.structure)) alone.add(c);
    const shared = Object.values(map.programs)
      .filter((p) => p.onlyWith)
      .flatMap((p) => [...programsUnder(map, p.structure)])
      .filter((c) => alone.has(c));
    // Found on the 2027 data, e.g. an IT sub-major the Engineering doubles also add.
    expect(shared.length).toBeGreaterThan(0);
    const locks = pairingLocks(map, emptyPlan());
    expect(shared.filter((c) => locks.has(c))).toEqual([]);
  });

  it('locks a program chosen under one half when the chosen double does not offer it', () => {
    // MAJ09401 is a Bachelor of Business major that Engineering + Business (C09070) does not offer.
    expect(programsUnder(map, map.degrees.C10026.structure).has('MAJ09401')).toBe(true);
    expect(programsUnder(map, map.degrees.C09070.structure).has('MAJ09401')).toBe(false);
    expect(pairingLocks(map, { ...emptyPlan(), degree: 'C10026', programs: ['MAJ09401'] }).has('MAJ09401')).toBe(false);
    const locks = pairingLocks(map, { ...emptyPlan(), degree: 'C09070', programs: ['MAJ09401'] });
    expect(locks.get('MAJ09401')?.text).toMatch(/Not part of .*only Bachelor of Business on its own offers it/);
  });
});
