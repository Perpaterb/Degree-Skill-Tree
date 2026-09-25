import { describe, expect, it } from 'vitest';
import {
  compatibility,
  computeStates,
  decodePlan,
  emptyPlan,
  encodePlan,
  makeCtx,
  missingFor,
  prerequisiteGap,
  progress,
  ruleMet,
  unlockedBy,
  type Plan,
} from './engine.js';
import type { Container, Degree, MapDoc, Subject } from './model.js';

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

// Degree X1: core {A, B}, major M {A, G, C}, 12cp free electives.
// Degree X2: core {F} (compulsory), no free electives.
// A: no requisites. B needs A. C needs (A AND B). D needs (L OR B) where L is legacy.
// E needs 12cp and enrolment in X1. F is an anti-requisite of A.
const degree = (code: string, structure: Container): Degree => ({
  code,
  title: `Bachelor of ${code}`,
  creditPoints: structure.creditPoints,
  level: 'Undergraduate',
  faculty: '',
  url: '',
  studyPlans: [],
  structure,
});

const tree: MapDoc = {
  schema: 2,
  id: 't',
  institution: 'Test',
  year: '2027',
  source: { name: '', url: '', fetchedAt: '' },
  degrees: {
    X1: degree(
      'X1',
      box('root', 36, [], [box('core', 12, [s('A'), s('B')]), box('major', 12, [{ kind: 'program', code: 'M' }]), box('free', 12, [], [], 'free')]),
    ),
    X2: degree('X2', box('root2', 6, [], [box('core2', 6, [s('F')])])),
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
    H: subject('H'),
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

  it('meets a course condition with any degree on the map until a degree is selected, then only that one', () => {
    const rule = { course: 'X1', title: '' };
    expect(ruleMet(rule, makeCtx(tree, [], null))).toBe(true);
    expect(ruleMet(rule, makeCtx(tree, [], 'X1'))).toBe(true);
    expect(ruleMet(rule, makeCtx(tree, [], 'X2'))).toBe(false);
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

  it('leaves out a credit-point condition that is already met', () => {
    expect(missingFor(tree, 'E', new Set(['A', 'B'])).notes).toEqual([]);
  });
});

describe('prerequisiteGap (US-025)', () => {
  it('is null when the completed subjects meet the rule, or there is no rule', () => {
    expect(prerequisiteGap(tree, 'C', ['A', 'B'])).toBeNull();
    expect(prerequisiteGap(tree, 'A', [])).toBeNull();
  });

  it('lists what must be completed first, deepest first', () => {
    expect(prerequisiteGap(tree, 'C', [])).toMatchObject({ subjects: ['A', 'B'], alternatives: false });
    expect(prerequisiteGap(tree, 'C', ['A'])).toMatchObject({ subjects: ['B'] });
  });

  it('says when other combinations would also work', () => {
    expect(prerequisiteGap(tree, 'D', [])).toMatchObject({ subjects: ['A', 'B'], alternatives: true });
  });

  it('reports a credit-point condition that is not met as a note', () => {
    expect(prerequisiteGap(tree, 'E', [])).toMatchObject({ subjects: [], notes: ['at least 12cp completed'] });
  });
});

describe('unlockedBy', () => {
  it('lists subjects that mention a code', () => {
    expect(unlockedBy(tree, 'B').sort()).toEqual(['C', 'D']);
  });
});

describe('progress', () => {
  it('counts core, the chosen major, and puts leftovers in free electives without double counting', () => {
    const p = progress(tree, 'X1', plan({ completed: ['A', 'B', 'G', 'F'], planned: ['C'], programs: ['M'] }));
    const [core, major, free] = p.children;
    expect([core.done, core.planned]).toEqual([12, 0]);
    expect([major.done, major.planned]).toEqual([6, 6]);
    expect([free.done, free.planned]).toEqual([6, 0]);
    expect([p.done, p.planned, p.required]).toEqual([24, 6, 36]);
  });

  it('records what each requirement names, for highlighting', () => {
    const p = progress(tree, 'X1', plan({}));
    expect(p.children[1].refs).toEqual(['M']);
    expect(p.children[0].refs).toEqual(['A', 'B']);
  });

  it('does not count a major that has not been chosen', () => {
    // With a second major beside M, "major" is a real choice. (A requirement naming one program only counts it unchosen.)
    const choice: MapDoc = {
      ...tree,
      degrees: {
        X1: degree(
          'X1',
          box('root', 36, [], [box('core', 12, [s('A'), s('B')]), box('major', 12, [{ kind: 'program', code: 'M' }, { kind: 'program', code: 'N' }]), box('free', 12, [], [], 'free')]),
        ),
      },
      programs: { ...tree.programs, N: { code: 'N', title: 'Major N', kind: 'major', creditPoints: 12, url: '', structure: box('n', 12, [s('F')]) } },
    };
    const p = progress(choice, 'X1', plan({ completed: ['G'] }));
    expect(p.children[1].done).toBe(0);
    expect(p.children[2].done).toBe(6); // G falls to free electives instead
  });
});

describe('compatibility (US-023)', () => {
  it('counts everything when completed subjects all belong to the degree', () => {
    const f = compatibility(tree, 'X1', plan({ completed: ['A', 'G'] }));
    expect([f.countingCp, f.completedCp, f.grey, f.impossible]).toEqual([12, 12, 0, false]);
  });

  it('lets free electives absorb outside subjects, then greys in proportion to the rest', () => {
    // D, E, H are not in X1's structure: 12cp of free electives take two, the third is wasted.
    const f = compatibility(tree, 'X1', plan({ completed: ['A', 'D', 'E', 'H'] }));
    expect(f.countingCp).toBe(18);
    expect(f.wasted.map((w) => w.code)).toEqual(['H']);
    expect(f.grey).toBeCloseTo(6 / 24);
  });

  it('wastes everything outside a degree with no free electives', () => {
    const f = compatibility(tree, 'X2', plan({ completed: ['G'] }));
    expect(f.wasted).toEqual([{ code: 'G', reason: 'not part of this degree, which has no free electives' }]);
    expect(f.grey).toBe(1);
  });

  it('is impossible when a completed subject rules out a compulsory one', () => {
    // A is an anti-requisite of F, which X2 requires.
    const f = compatibility(tree, 'X2', plan({ completed: ['A'] }));
    expect(f.impossible).toBe(true);
    expect(f.grey).toBe(1);
    expect(f.wasted[0].reason).toContain('F');
  });

  it('is untouched when nothing is completed', () => {
    expect(compatibility(tree, 'X2', plan({})).grey).toBe(0);
  });
});

describe('plan URL encoding', () => {
  it('round-trips', () => {
    const p = plan({ completed: ['31251', '31268'], planned: ['41039'], programs: ['MAJ03444'], degree: 'C10148' });
    expect(encodePlan(p)).toBe('d=C10148&c=31251.31268&p=41039&m=MAJ03444');
    expect(decodePlan('#' + encodePlan(p))).toEqual(p);
  });

  it('drops junk and duplicates between completed and planned', () => {
    expect(decodePlan('c=A.<script>&p=A.B')).toEqual(plan({ completed: ['A'], planned: ['B'] }));
  });
});
