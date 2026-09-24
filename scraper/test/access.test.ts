import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyItem, parseAccessConditions, parseRule } from '../src/access.js';

const fixture = (code: string) => readFileSync(new URL(`./fixtures/ac_${code}.html`, import.meta.url), 'utf8');

describe('parseRule', () => {
  it('parses a single reference', () => {
    expect(parseRule('(1)')).toEqual({ ref: '1' });
  });

  it('parses nested AND/OR groups with lettered alternatives', () => {
    expect(parseRule('(1 AND (2 OR 2a) AND 3)')).toEqual({
      op: 'and',
      args: [{ ref: '1' }, { op: 'or', args: [{ ref: '2' }, { ref: '2a' }] }, { ref: '3' }],
    });
  });

  it('binds AND tighter than OR when brackets are missing', () => {
    expect(parseRule('1 OR 2 AND 3')).toEqual({
      op: 'or',
      args: [{ ref: '1' }, { op: 'and', args: [{ ref: '2' }, { ref: '3' }] }],
    });
  });

  it('rejects malformed rules instead of guessing', () => {
    expect(() => parseRule('(1 AND 2')).toThrow(/unbalanced/);
    expect(() => parseRule('1 AND')).toThrow(/unexpected end/);
    expect(() => parseRule('1 2')).toThrow(/trailing/);
  });
});

describe('classifyItem', () => {
  it('recognises subjects, courses and credit-point conditions', () => {
    expect(classifyItem('1', 'Academic requisite', '48024 Programming 2')).toMatchObject({ kind: 'subject', code: '48024' });
    expect(classifyItem('1', 'Admission requisite', 'C10148 Bachelor of Information Technology')).toMatchObject({
      kind: 'course',
      code: 'C10148',
    });
    expect(
      classifyItem('3', 'Academic requisite', "Must have completed at least 72 credit points in  Bachelor's Degree owned by FEIT"),
    ).toMatchObject({ kind: 'credit_points', min: 72, scope: "Bachelor's Degree owned by FEIT" });
  });

  it('keeps anything unrecognised as text rather than dropping it', () => {
    expect(classifyItem('1', 'Other requisite', 'Permission of the subject coordinator')).toMatchObject({ kind: 'text' });
  });
});

describe('parseAccessConditions (real UTS pages)', () => {
  it('31272: requisites mixing subjects and credit-point conditions, plus anti-requisites', () => {
    const ac = parseAccessConditions(fixture('31272'));
    expect(ac.antiRequisites?.items.map((i) => (i.kind === 'subject' ? i.code : i.kind))).toEqual(['319272', '32541', '48260']);
    expect(ac.requisites?.ruleText).toBe('(1 AND (2 OR 2a OR 2b) AND (3 OR 3a OR 3b OR 3c OR 3d OR 3e))');
    expect(ac.requisites?.items).toHaveLength(10);
    expect(ac.requisites?.items[0]).toMatchObject({ id: '1', kind: 'subject', code: '31269' });
    expect(ac.requisites?.items[4]).toMatchObject({ id: '3', kind: 'credit_points', min: 72 });
    // Every ref in the rule must resolve to a listed item.
    const ids = new Set(ac.requisites!.items.map((i) => i.id));
    const refs = JSON.stringify(ac.requisites!.rule).match(/"ref":"([^"]+)"/g)!.map((r) => r.slice(7, -1));
    expect(refs.every((r) => ids.has(r))).toBe(true);
  });

  it('41039: anti-requisite only, no prerequisites', () => {
    const ac = parseAccessConditions(fixture('41039'));
    expect(ac.requisites).toBeNull();
    expect(ac.antiRequisites?.rule).toEqual({ ref: '1' });
    expect(ac.antiRequisites?.items[0]).toMatchObject({ kind: 'subject', code: '48023' });
  });

  it('48024: an OR-group wrapped in double brackets', () => {
    const ac = parseAccessConditions(fixture('48024'));
    expect(ac.requisites?.rule).toMatchObject({ op: 'or' });
    expect(ac.requisites?.items).toHaveLength(5);
  });

  it('41004: a subject with no conditions at all', () => {
    const ac = parseAccessConditions(fixture('41004'));
    expect(ac.requisites).toBeNull();
    expect(ac.antiRequisites).toBeNull();
  });
});
