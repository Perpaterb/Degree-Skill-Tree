import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyPlan, programLocks, programsFit, progress, type Plan } from './engine.js';
import type { MapDoc } from './model.js';

// Majors and sub-majors that can no longer count towards the selected degree (US-037, US-038),
// on the real 2027 data.

const real: MapDoc = JSON.parse(readFileSync(new URL('../web/public/trees/uts-2027.json', import.meta.url), 'utf8'));
const plan = (degree: string, p: Partial<Plan> = {}): Plan => ({ ...emptyPlan(), degree, ...p });

// Bachelor of IT: majors listed under both "Major - Information Technology" and Options.
const DA = 'MAJ02081'; // Data Analytics (major)
const ID = 'MAJ02092'; // Interaction Design
const ESD = 'MAJ03444'; // Enterprise Software Development
const DA_SUB = 'SMJ02065'; // Data Analytics (sub-major)
const ADV = 'SMJ08198'; // Advertising Principles
const INN = 'SMJ10156'; // Innovation and Entrepreneurship
const GAMES = 'SMJ02066';

describe('how many programs a degree holds, read from its structure (US-037)', () => {
  it('Bachelor of IT: 2 majors, or 1 major and 2 sub-majors', () => {
    expect(programsFit(real, 'C10148', [DA, ID])).toBe(true);
    expect(programsFit(real, 'C10148', [DA, ID, ESD])).toBe(false);
    expect(programsFit(real, 'C10148', [DA, ADV, INN])).toBe(true);
    expect(programsFit(real, 'C10148', [DA, ID, ADV])).toBe(false);
    expect(programsFit(real, 'C10148', [DA, ADV, INN, GAMES])).toBe(false);
  });

  it('Bachelor of Business: 2 majors, or 1 major and 2 sub-majors', () => {
    const [m1, m2, m3] = ['MAJ08437', 'MAJ08981', 'MAJ08997'];
    const [s1, s2, s3] = ['SMJ08131', 'SMJ08137', 'SMJ10159'];
    expect(programsFit(real, 'C10026', [m1, m2])).toBe(true);
    expect(programsFit(real, 'C10026', [m1, m2, m3])).toBe(false);
    expect(programsFit(real, 'C10026', [m1, s1, s2])).toBe(true);
    expect(programsFit(real, 'C10026', [m1, m2, s1])).toBe(false);
    expect(programsFit(real, 'C10026', [m1, s1, s2, s3])).toBe(false);
  });

  it('Computing Science: 2 sub-majors, one from its own list and one under Options', () => {
    const own = ['SMJ02070', 'SMJ02064'];
    const options = ['SMJ03069', 'SMJ10157'];
    expect(programsFit(real, 'C10476', [own[0], options[0]])).toBe(true);
    expect(programsFit(real, 'C10476', own)).toBe(false);
    expect(programsFit(real, 'C10476', options)).toBe(false);
    expect(programsFit(real, 'C10476', [own[0], ...options])).toBe(false);
  });

  it('Cybersecurity: 1 sub-major', () => {
    expect(programsFit(real, 'C10471', ['SMJ03069'])).toBe(true);
    expect(programsFit(real, 'C10471', ['SMJ03069', 'SMJ10157'])).toBe(false);
  });

  it('a program the degree does not list does not fit it', () => {
    expect(programsFit(real, 'C10471', [DA])).toBe(false);
  });
});

describe('locked-out programs (US-037)', () => {
  it('locks nothing when nothing is chosen, in any degree', () => {
    for (const d of ['C10148', 'C10026', 'C10476', 'C10471']) expect([d, [...programLocks(real, d, plan(d)).locks.keys()]]).toEqual([d, []]);
  });

  it('with 2 majors chosen, every other major and every sub-major has no room', () => {
    const { locks } = programLocks(real, 'C10148', plan('C10148', { programs: [DA, ID] }));
    expect(locks.get(ESD)?.why).toBe('room');
    expect(locks.get(ADV)?.why).toBe('room');
    expect(locks.get(ESD)?.blockers.sort()).toEqual([DA, ID].sort());
    expect(locks.has(DA) || locks.has(ID)).toBe(false);
    // 7 majors and 20 sub-majors listed, 2 chosen: the other 25 are out.
    expect(locks.size).toBe(25);
  });

  it('the Data Analytics sub-major cannot be completed once the Data Analytics major is chosen', () => {
    const lock = programLocks(real, 'C10148', plan('C10148', { programs: [DA] })).locks.get(DA_SUB)!;
    expect(lock.why).toBe('overlap');
    expect(lock.blockers).toEqual([DA]);
    expect(lock.text).toContain('Data Analytics (major)');
  });

  it('a gap in the handbook data alone does not lock a program', () => {
    // Taxation Law lists subjects missing from the 2027 handbook, so it falls short with nothing chosen.
    expect(programLocks(real, 'C10026', plan('C10026')).locks.has('SMJ09033')).toBe(false);
  });

  it('a program chosen for another degree takes no room in this one', () => {
    // Data Analytics (sub-major) is not in Computing Science.
    expect(programLocks(real, 'C10476', plan('C10476', { programs: [DA_SUB] })).locks.size).toBe(0);
  });

  it('with no degree, nothing is locked', () => {
    expect(programLocks(real, '', plan('', { programs: [DA, ID] })).locks.size).toBe(0);
  });
});

describe('a chosen program that cannot count (US-038)', () => {
  it('keeps programs in the order chosen and locks the later one that does not fit', () => {
    const { accepted, locks } = programLocks(real, 'C10148', plan('C10148', { programs: [DA, DA_SUB, ADV] }));
    expect(accepted).toEqual([DA, ADV]);
    expect(locks.get(DA_SUB)?.why).toBe('overlap');
  });

  it('counts nothing for it', () => {
    const DA_SUBJECTS = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
    const root = progress(real, 'C10148', plan('C10148', { programs: [DA, DA_SUB], completed: DA_SUBJECTS }));
    const programs: string[] = [];
    const walk = (n: typeof root) => (n.program && programs.push(n.program), n.children.forEach(walk));
    walk(root);
    expect(programs).not.toContain(DA_SUB);
  });
});

describe('subjects counting elsewhere are told apart by program, not title (US-037 bug fix)', () => {
  it('names the major under a sub-major of the same title when the major takes their shared subject', () => {
    const subject = (code: string) => ({ ...real.subjects['31265'], code, title: code, creditPoints: 6, antiRequisites: [], requisite: null, legacy: undefined });
    const box = (id: string, creditPoints: number, items: { kind: 'subject' | 'program'; code: string }[], description = '') =>
      ({ id, title: id, description, creditPoints, kind: 'group' as const, children: [], items });
    const same = (code: string, kind: 'major' | 'sub_major', cp: number, subjects: string[], description = '') => ({
      code,
      title: 'Same Name',
      kind,
      creditPoints: cp,
      url: '',
      structure: box(code + '-s', cp, subjects.map((c) => ({ kind: 'subject' as const, code: c })), description),
    });
    const map: MapDoc = {
      ...real,
      degrees: {
        T: {
          ...real.degrees.C10148,
          code: 'T',
          creditPoints: 24,
          structure: {
            ...box('root', 24, []),
            children: [box('major', 12, [{ kind: 'program', code: 'M' }]), box('sub', 12, [{ kind: 'program', code: 'S' }])],
          },
        },
      },
      programs: { M: same('M', 'major', 12, ['a', 'b']), S: same('S', 'sub_major', 12, ['b', 'c', 'd'], 'Select 12 credit points from the following subjects:') },
      subjects: Object.fromEntries(['a', 'b', 'c', 'd'].map((c) => [c, subject(c)])),
    };
    const root = progress(map, 'T', plan('T', { programs: ['M', 'S'], completed: ['a', 'b', 'c'] }));
    const s = root.children[1].children[0];
    expect(s.program).toBe('S');
    expect(s.children.length ? s.children.flatMap((c) => c.elsewhere ?? []) : s.elsewhere).toEqual([{ code: 'b', by: 'Same Name' }]);
  });
});
