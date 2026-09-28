import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { centreOf, hiddenCircles, topOf } from './dynamic.js';
import { emptyPlan, type Plan } from './engine.js';
import type { MapDoc } from './model.js';
import { degreeLocks, pairingLocks } from './pairs.js';

const map: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const layout = map.layout!;
const hiddenFor = (plan: Plan) => hiddenCircles(layout, pairingLocks(map, plan), degreeLocks(map, plan.degree));
const shownTop = (plan: Plan) => {
  const hidden = hiddenFor(plan);
  return layout.circles.filter((c) => !c.parent && !hidden.has(c.id));
};

describe('US-054: Dynamic mode shows only what is not locked', () => {
  it('with the Bachelor of Science chosen, shows it, its partners and the programs they offer: 114 top-level circles', () => {
    const top = shownTop({ ...emptyPlan(), degree: 'C10242' });
    expect(top.filter((c) => c.kind === 'degree')).toHaveLength(9);
    expect(top).toHaveLength(114);
    expect(top.map((c) => c.id)).toContain('C10242');
    expect(top.map((c) => c.id)).not.toContain('C10148');
  });

  it('hides everything inside a hidden circle', () => {
    const hidden = hiddenFor({ ...emptyPlan(), degree: 'C10242' });
    for (const c of layout.circles) if (c.parent && hidden.has(c.parent)) expect(hidden.has(c.id), c.id).toBe(true);
  });

  it('hides a shared program once no degree offering it is shown, and keeps one a shown degree offers', () => {
    const plan = { ...emptyPlan(), degree: 'C10242' };
    const hidden = hiddenFor(plan);
    const locked = pairingLocks(map, plan);
    const shared = layout.circles.filter((c) => !c.parent && c.sharedBy?.length);
    // Hidden when locked itself, or when every degree offering it is hidden.
    for (const c of shared) expect(hidden.has(c.id), c.id).toBe(locked.has(c.id) || c.sharedBy!.every((d) => hidden.has(d)));
    expect(shared.some((c) => !hidden.has(c.id))).toBe(true);
    expect(shared.some((c) => !locked.has(c.id) && hidden.has(c.id))).toBe(true);
  });

  it('with nothing chosen, hides only the add-on halves and what only a double offers', () => {
    expect(shownTop(emptyPlan())).toHaveLength(558);
    expect(shownTop({ ...emptyPlan(), degree: 'C10219' })).toHaveLength(63);
  });
});

describe('US-055: the centre is the last chosen thing', () => {
  it('is the last chosen degree or program while it is chosen, else what is still chosen', () => {
    const plan = { ...emptyPlan(), degree: 'C10219', programs: ['MAJ08966'] };
    expect(centreOf(map, layout, plan, 'MAJ08966')).toBe('MAJ08966');
    expect(centreOf(map, layout, plan, 'C10026')).toBe('C10026');
    // Unchosen: back to the last program still chosen, then a chosen degree.
    expect(centreOf(map, layout, plan, 'C10476')).toBe('MAJ08966');
    expect(centreOf(map, layout, { ...plan, programs: [] }, 'MAJ08966')).toBe('C10148');
    expect(centreOf(map, layout, emptyPlan(), null)).toBeNull();
  });

  it('finds the top-level circle a program sits in', () => {
    expect(topOf(layout, 'MAJ08966')).toBe('C10148');
    expect(topOf(layout, 'C10148')).toBe('C10148');
  });
});
