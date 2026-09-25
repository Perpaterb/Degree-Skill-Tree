import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyPlan, parseWays, programProgress, progress, progressStatus, type Plan } from './engine.js';
import type { Container, MapDoc, Program, Subject } from './model.js';

// Counting numbered ways and "one of the following" choices (US-022), and the statuses the degree
// outline and circle glows read (US-026, US-027).

const real: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));

const subject = (code: string): Subject => ({
  code,
  title: code,
  creditPoints: 6,
  level: '',
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
});
const box = (id: string, creditPoints: number, items: Container['items'], children: Container[] = [], description = '', kind: Container['kind'] = 'group'): Container => ({
  id,
  title: id,
  description,
  creditPoints,
  kind,
  children,
  items,
});
const subj = (...codes: string[]) => codes.map((code) => ({ kind: 'subject' as const, code }));
const prog = (...codes: string[]) => codes.map((code) => ({ kind: 'program' as const, code }));
const program = (code: string, kind: Program['kind'], creditPoints: number, structure: Container): Program => ({ code, title: code, kind, creditPoints, url: '', structure });

// Options (24cp) can be one sub-major, or two 12cp "minors" (sub-majors here), or electives.
const WAYS = 'Select 24 credit points. Options can be taken in three ways: 1. one sub-major (24cp); 2. two sub-majors (2 x 12cp); 3. electives (24cp).';
const map: MapDoc = {
  schema: 2,
  id: 't',
  institution: 'Test',
  year: '2027',
  source: { name: '', url: '', fetchedAt: '' },
  degrees: {
    Y: {
      code: 'Y',
      title: 'Bachelor of Y',
      creditPoints: 36,
      level: '',
      faculty: '',
      url: '',
      studyPlans: [],
      structure: box('root', 36, [], [
        box('core', 12, subj('A', 'B')),
        // As in the handbook, the Sub-Majors heading is worth one (smaller) sub-major's credit points.
        box('options', 24, [], [box('subs', 12, prog('BIG', 'P', 'Q')), box('free', 24, [], [], '', 'free')], WAYS),
      ]),
    },
  },
  programs: {
    BIG: program('BIG', 'sub_major', 24, box('big', 24, subj('W', 'X', 'Y1', 'Z'))),
    P: program('P', 'sub_major', 12, box('p', 12, subj('P1', 'P2'))),
    Q: program('Q', 'sub_major', 12, box('q', 12, subj('Q1', 'Q2'))),
    // Choose one language: Italian or German, 12cp each.
    L: program('L', 'sub_major', 12, box('l', 12, [], [box('it', 12, subj('I1', 'I2')), box('de', 12, subj('G1', 'G2'))], 'Select one of the following options:')),
  },
  subjects: Object.fromEntries(['A', 'B', 'W', 'X', 'Y1', 'Z', 'P1', 'P2', 'Q1', 'Q2', 'I1', 'I2', 'G1', 'G2', 'E1', 'E2', 'E3', 'E4'].map((c) => [c, subject(c)])),
};
const plan = (p: Partial<Plan>): Plan => ({ ...emptyPlan(), degree: 'Y', ...p });
const options = (p: Plan) => progress(map, 'Y', p).children[1];

describe('parseWays (US-022, US-027)', () => {
  it('reads the Bachelor of IT options text into four ways', () => {
    const text = real.degrees.C10148.structure.children.find((c) => c.title === 'Options')!.description;
    expect(parseWays(text)).toEqual([
      { text: 'one major (48cp)', parts: [{ what: 'major', count: 1, cp: 48 }] },
      { text: 'two sub-majors (2 x 24cp)', parts: [{ what: 'sub_major', count: 2, cp: 48 }] },
      { text: 'one sub-major (24cp) and four electives (24cp)', parts: [{ what: 'sub_major', count: 1, cp: 24 }, { what: 'electives', count: 4, cp: 24 }] },
      {
        text: 'one transdisciplinary elective (6cp) and seven electives (42cp)',
        parts: [{ what: 'stream', count: 1, cp: 6 }, { what: 'electives', count: 7, cp: 42 }],
      },
    ]);
  });

  it('reads the Bachelor of Business options text into four ways', () => {
    const text = real.degrees.C10026.structure.children.find((c) => c.title === 'Options')!.description;
    expect(parseWays(text).map((w) => [w.text, w.parts])).toEqual([
      ['One major (48cp)', [{ what: 'major', count: 1, cp: 48 }]],
      ['Two sub-majors (24cp for each sub-major)', [{ what: 'sub_major', count: 2, cp: 48 }]],
      ['One sub-major (24cp) plus electives (24cp)', [{ what: 'sub_major', count: 1, cp: 24 }, { what: 'electives', count: 1, cp: 24 }]],
      ['Electives (48cp)', [{ what: 'electives', count: 1, cp: 48 }]],
    ]);
  });

  it('keeps a way it cannot read, marked as not understood', () => {
    expect(parseWays('Either: 1. a double major (96cp); 2. something else entirely')).toEqual([
      { text: 'a double major (96cp)', parts: null },
      { text: 'something else entirely', parts: null },
    ]);
  });

  it('finds no ways in ordinary text', () => {
    expect(parseWays('Complete all of the following subjects:')).toEqual([]);
  });
});

describe('progress with ways and choices (US-022)', () => {
  it('counts two completed smaller sub-majors as the whole requirement, not just one heading', () => {
    const o = options(plan({ programs: ['P', 'Q'], completed: ['P1', 'P2', 'Q1', 'Q2'] }));
    expect([o.done, o.planned, o.required]).toEqual([24, 0, 24]);
    expect(o.ways!.map((w) => [w.done, w.required])).toEqual([
      [12, 24],
      [24, 24],
      [0, 24],
    ]);
  });

  it('counts leftover subjects through the electives way', () => {
    const o = options(plan({ completed: ['E1', 'E2', 'E3', 'E4'] }));
    expect(o.done).toBe(24);
    expect(o.ways![2]).toMatchObject({ done: 24, required: 24, chosen: false });
  });

  it('adds planned subjects on top of the best way, without passing the requirement', () => {
    const o = options(plan({ programs: ['BIG'], completed: ['W', 'X'], planned: ['Y1', 'Z', 'E1'] }));
    expect([o.done, o.planned]).toEqual([12, 12]);
  });

  it('counts only the best child of a "one of the following" choice', () => {
    // Two subjects from each language: 12cp of Italian and 12cp of German is still one language done, not 24.
    const p = programProgress(map, 'L', plan({ completed: ['I1', 'I2', 'G1'] }));
    expect([p.done, p.required]).toEqual([12, 12]);
    const half = programProgress(map, 'L', plan({ completed: ['I1', 'G1'] }));
    expect(half.done).toBe(6);
  });
});

describe('two majors in the Bachelor of IT (US-022, US-027)', () => {
  // Data Analytics and Interaction Design are listed under both "Major" and "Options > Majors", and share 41759.
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const ID = ['31260', '31777', '31080', '41019', '31263', '31264', '41759', '41889'];
  const both = (extra: string[] = []) =>
    progress(real, 'C10148', { ...emptyPlan(), degree: 'C10148', programs: ['MAJ02081', 'MAJ02092'], completed: [...new Set([...DA, ...ID, ...extra])] });
  const find = (n: ReturnType<typeof progress>, title: string) => n.children.find((c) => c.title === title)!;

  it('counts the second major under Options instead of dropping it', () => {
    const root = both();
    const major = find(root, 'Major - Information Technology');
    expect(major.children.map((c) => c.program)).toEqual(['MAJ02081']);
    const options = find(root, 'Options');
    expect(find(options, 'Majors').children.map((c) => c.program)).toEqual(['MAJ02092']);
    // 41759 counts once, towards Data Analytics, so Interaction Design is 6cp short.
    expect([options.done, options.ways![0].done]).toEqual([42, 42]);
    expect(root.done).toBe(90);
  });

  it('says which shared subject counts elsewhere, and completes once it is replaced', () => {
    const id = find(find(both(), 'Options'), 'Majors').children[0];
    expect(id.children.flatMap((c) => c.elsewhere ?? [])).toEqual([{ code: '41759', by: 'Data Analytics' }]);
    const options = find(both(['31262']), 'Options');
    expect(progressStatus(options)).toBe('complete');
    expect(progressStatus(options.ways![0])).toBe('complete');
  });
});

describe('free electives (US-032)', () => {
  it('records which subjects fill a free-elective slot', () => {
    // 31061 and 32130 are not listed anywhere in the Bachelor of IT.
    const root = progress(real, 'C10148', { ...emptyPlan(), degree: 'C10148', completed: ['31061'], planned: ['32130'] });
    const fills: Record<string, string[]> = {};
    const walk = (n: typeof root) => (n.fills && (fills[n.title] = n.fills), n.children.forEach(walk));
    walk(root);
    expect(fills).toEqual({ Electives: ['31061', '32130'] });
  });
});

describe('progressStatus (US-026, US-027)', () => {
  it('is complete, planned, started or untouched', () => {
    expect(progressStatus({ required: 12, done: 12, planned: 0 })).toBe('complete');
    expect(progressStatus({ required: 12, done: 6, planned: 6 })).toBe('planned');
    expect(progressStatus({ required: 12, done: 0, planned: 6 })).toBe('started');
    expect(progressStatus({ required: 12, done: 0, planned: 0 })).toBe('none');
  });

  it('counts a chosen program as started even before any of it is done', () => {
    const o = options(plan({ programs: ['P'] }));
    expect(progressStatus(o)).toBe('started');
    // So are the ways that use it, and not the ones that do not.
    expect(o.ways!.map(progressStatus)).toEqual(['started', 'started', 'none']);
  });

  it('gives a program its own status whether or not it is chosen', () => {
    expect(progressStatus(programProgress(map, 'P', plan({ completed: ['P1', 'P2'] })))).toBe('complete');
    expect(progressStatus(programProgress(map, 'P', plan({ completed: ['P1'], planned: ['P2'] })))).toBe('planned');
  });
});
