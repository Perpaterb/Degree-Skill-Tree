import { describe, expect, it } from 'vitest';
import {
  computeStates,
  decodePlan,
  emptyPlan,
  encodePlan,
  makeCtx,
  missingFor,
  progress,
  ruleMet,
  unlockedBy,
  type Plan,
} from './engine.js';
import type { Container, Subject, TreeDoc } from './model.js';

function subject(code: string, extra: Partial<Subject> = {}): Subject {
  return {
    code,
    title: `Subject ${code}`,
    creditPoints: 6,
    level: 'Undergraduate',
    faculty: '',
    school: '',
    description: '',
    learningOutcomes: [],
    offerings: [],
    requisite: null,
    requisiteText: '',
    antiRequisites: [],
    recommended: '',
    url: '',
    ...extra,
  };
}

const box = (id: string, creditPoints: number, items: Container['items'], children: Container[] = [], kind: Container['kind'] = 'group'): Container => ({
  id,
  title: id,
  description: '',
  creditPoints,
  kind,
  children,
  items,
});

const s = (code: string) => ({ kind: 'subject' as const, code });

// A: no requisites. B needs A. C needs (A AND B). D needs (B OR L) where L is legacy.
// E needs 12cp and course X1. F is an anti-requisite of A. M is a major containing A (also core), G and C.
const tree: TreeDoc = {
  schema: 1,
  id: 't',
  institution: 'Test',
  year: '2027',
  source: { name: '', url: '', fetchedAt: '' },
  degree: {
    code: 'X1',
    title: 'Bachelor of Test',
    creditPoints: 36,
    level: 'Undergraduate',
    faculty: '',
    url: '',
    studyPlans: [],
    structure: box('root', 36, [], [
      box('core', 12, [s('A'), s('B')]),
      box('major', 12, [{ kind: 'program', code: 'M' }]),
      box('free', 12, [], [], 'free'),
    ]),
  },
  programs: {
    M: { code: 'M', title: 'Major M', kind: 'major', creditPoints: 12, url: '', structure: box('m', 12, [s('A'), s('G'), s('C')]) },
  },
  subjects: {
    A: subject('A', { antiRequisites: ['F'] }),
    B: subject('B', { requisite: { subject: 'A' } }),
    C: subject('C', { requisite: { op: 'and', args: [{ subject: 'A' }, { subject: 'B' }] } }),
    D: subject('D', { requisite: { op: 'or', args: [{ subject: 'L' }, { subject: 'B' }] } }),
    E: subject('E', { requisite: { op: 'and', args: [{ creditPoints: 12, scope: 'x' }, { course: 'X1', title: '' }] } }),
    F: subject('F'),
    G: subject('G'),
    L: subject('L', { legacy: true, creditPoints: 0 }),
  },
};

const plan = (p: Partial<Plan>): Plan => ({ ...emptyPlan(), ...p });

describe('ruleMet', () => {
  it('evaluates AND/OR, course and credit-point conditions', () => {
    expect(ruleMet(tree.subjects.C.requisite, makeCtx(tree, ['A']))).toBe(false);
    expect(ruleMet(tree.subjects.C.requisite, makeCtx(tree, ['A', 'B']))).toBe(true);
    expect(ruleMet(tree.subjects.D.requisite, makeCtx(tree, ['L']))).toBe(true);
    expect(ruleMet(tree.subjects.E.requisite, makeCtx(tree, ['A']))).toBe(false);
    expect(ruleMet(tree.subjects.E.requisite, makeCtx(tree, ['A', 'G']))).toBe(true);
    expect(ruleMet({ course: 'OTHER', title: '' }, makeCtx(tree, []))).toBe(false);
  });
});

describe('computeStates', () => {
  it('distinguishes completed, planned, available, reachable, locked, excluded and legacy', () => {
    const st = computeStates(tree, plan({ completed: ['A'], planned: ['B'] }));
    expect(st.get('A')).toBe('completed');
    expect(st.get('B')).toBe('planned');
    expect(st.get('G')).toBe('available');
    expect(st.get('C')).toBe('reachable'); // needs B, which is only planned
    expect(st.get('E')).toBe('reachable'); // 12cp once B is done
    expect(st.get('F')).toBe('excluded'); // anti-requisite of A
    expect(st.get('L')).toBe('legacy');
  });

  it('treats anti-requisites as symmetric even when listed one way', () => {
    expect(computeStates(tree, plan({ completed: ['F'] })).get('A')).toBe('excluded');
  });

  it('locks a subject whose requisites are not even planned', () => {
    expect(computeStates(tree, emptyPlan()).get('C')).toBe('locked');
  });
});

describe('missingFor', () => {
  it('returns the chain in dependency order', () => {
    expect(missingFor(tree, 'C', new Set()).subjects).toEqual(['A', 'B']);
  });

  it('prefers current subjects over legacy ones in OR branches', () => {
    expect(missingFor(tree, 'D', new Set()).subjects).toEqual(['A', 'B']);
  });

  it('reports credit-point conditions as notes, not subjects', () => {
    expect(missingFor(tree, 'E', new Set()).notes).toEqual(['at least 12cp completed']);
  });

  it('is empty once requisites are held', () => {
    expect(missingFor(tree, 'C', new Set(['A', 'B'])).subjects).toEqual([]);
  });
});

describe('unlockedBy', () => {
  it('lists subjects that mention a code', () => {
    expect(unlockedBy(tree, 'B').sort()).toEqual(['C', 'D']);
  });
});

describe('progress', () => {
  it('counts core, the chosen major, and puts leftovers in free electives without double counting', () => {
    const p = progress(tree, plan({ completed: ['A', 'B', 'G', 'F'], planned: ['C'], programs: ['M'] }));
    const [core, major, free] = p.children;
    expect([core.done, core.planned]).toEqual([12, 0]);
    expect([major.done, major.planned]).toEqual([6, 6]);
    expect([free.done, free.planned]).toEqual([6, 0]);
    expect([p.done, p.planned, p.required]).toEqual([24, 6, 36]);
  });

  it('does not count a major that has not been chosen', () => {
    const p = progress(tree, plan({ completed: ['G'] }));
    expect(p.children[1].done).toBe(0);
    expect(p.children[2].done).toBe(6); // G falls to free electives instead
  });
});

describe('plan URL encoding', () => {
  it('round-trips', () => {
    const p = plan({ completed: ['31251', '31268'], planned: ['41039'], programs: ['MAJ03444'] });
    expect(encodePlan(p)).toBe('c=31251.31268&p=41039&m=MAJ03444');
    expect(decodePlan('#' + encodePlan(p))).toEqual(p);
  });

  it('drops junk and duplicates between completed and planned', () => {
    expect(decodePlan('c=A.<script>&p=A.B')).toEqual(plan({ completed: ['A'], planned: ['B'] }));
  });
});
