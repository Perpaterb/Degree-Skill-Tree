import { readFile } from 'node:fs/promises';
import type {
  Container,
  ContainerItem,
  Offering,
  Program,
  ProgramKind,
  Rule,
  Degree,
  MapDoc,
  StudyPlan,
  Subject,
} from '../../core/model.js';
import { parseAccessConditions, type RequisiteBlock, type RuleNode } from './access.js';
import { HANDBOOK } from './handbook.js';

type Json = Record<string, any>;

const num = (v: unknown) => Number(v) || 0;
const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
/** Container descriptions often start with an internal code, e.g. "(CBK90781) Select one of...". */
const stripCode = (s: string) => s.replace(/^\([A-Z]{2,4}\d{4,6}\)\s*/, '');

async function readJson(path: string): Promise<Json | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Convert a parsed access-conditions block into a self-contained rule (refs replaced by their items). */
export function toRule(block: RequisiteBlock | null): Rule | null {
  if (!block?.rule) return null;
  const byId = new Map(block.items.map((i) => [i.id, i]));
  const convert = (n: RuleNode): Rule => {
    if ('op' in n) return { op: n.op, args: n.args.map(convert) };
    const item = byId.get(n.ref);
    if (!item) throw new Error(`rule ref ${n.ref} has no item (${block.ruleText})`);
    switch (item.kind) {
      case 'subject':
        return { subject: item.code };
      case 'course':
        return { course: item.code, title: item.title };
      case 'credit_points':
        return { creditPoints: item.min, scope: item.scope };
      default:
        return { text: item.text };
    }
  };
  return convert(block.rule);
}

function programKind(type: unknown): ProgramKind {
  const t = String(type ?? '').toLowerCase();
  if (t === 'major') return 'major';
  if (t === 'sub-major') return 'sub_major';
  if (t === 'stream') return 'stream';
  return 'other';
}

interface Referenced {
  subjects: Map<string, string>; // code -> title as named by the referrer
  programs: Map<string, string>;
}

function toContainer(n: Json, refs: Referenced): Container {
  const items: ContainerItem[] = [];
  for (const r of n.relationship ?? []) {
    const code = r.academic_item_code;
    const type = r.academic_item_type?.value;
    if (!code) continue;
    if (type === 'subject') {
      items.push({ kind: 'subject', code });
      refs.subjects.set(code, clean(r.academic_item_name));
    } else {
      items.push({ kind: 'program', code });
      refs.programs.set(code, clean(r.academic_item_name));
    }
  }
  return {
    // A structure's root carries its id as an object ({ value, cl_id, key }); containers as a string.
    id: String(typeof n.cl_id === 'object' && n.cl_id ? (n.structure_cl_id ?? n.cl_id.cl_id ?? '') : (n.cl_id ?? '')),
    title: clean(n.title) || 'Structure',
    description: stripCode(clean(n.description)),
    creditPoints: num(n.credit_points),
    kind: n.vertical_grouping?.value === 'free_electives' ? 'free' : 'group',
    children: (n.container ?? []).map((c: Json) => toContainer(c, refs)),
    items,
  };
}

function studyPlans(raw: Json[] | undefined): StudyPlan[] {
  const byOrder = (a: Json, b: Json) => num(a.order) - num(b.order);
  return (raw ?? [])
    .filter((p) => p.published_in_handbook !== 'false')
    .map((p) => {
      const periods: StudyPlan['periods'] = [];
      const walk = (n: Json, prefix: string) => {
        for (const c of [...(n.container ?? [])].sort(byOrder)) {
          const name = prefix ? `${prefix} / ${clean(c.name)}` : clean(c.name);
          const codes = [...(c.relationship ?? [])]
            .sort(byOrder)
            .map((r: Json) => r.ai_details?.code ?? clean(r.child_record?.value).replace(/^Custom Academic Item:\s*/, 'option:'))
            .filter(Boolean);
          if (codes.length) periods.push({ name, codes });
          walk(c, name);
        }
      };
      walk(p, '');
      return { title: clean(p.title), periods };
    });
}

function offerings(raw: Json[] | undefined): Offering[] {
  const seen = new Set<string>();
  const out: Offering[] = [];
  for (const o of raw ?? []) {
    if (o.publish === 'false' || o.offered === 'false') continue;
    const off = { session: clean(o.teaching_period), location: clean(o.location), mode: clean(o.mode) };
    const key = JSON.stringify(off);
    if (!seen.has(key)) seen.add(key), out.push(off);
  }
  return out;
}

function toSubject(code: string, s: Json, access: ReturnType<typeof parseAccessConditions> | null, year: string): Subject {
  const recommended = (s.additional_details_req ?? [])
    .filter((d: Json) => d.domain === 'Recommended studies')
    .flatMap((d: Json) => (d.additional_details_req ?? []).map((x: Json) => clean(x.description)))
    .join(' ');
  return {
    code,
    title: clean(s.title),
    creditPoints: num(s.credit_points),
    level: clean(s.study_level_ref),
    faculty: clean(s.parent_academic_org),
    school: clean(s.academic_org),
    description: String(s.description ?? ''),
    learningOutcomes: [...(s.unit_learning_outcomes ?? [])]
      .sort((a: Json, b: Json) => num(a.order) - num(b.order))
      .map((lo: Json) => String(lo.description ?? '')),
    offerings: offerings(s.offering),
    requisite: toRule(access?.requisites ?? null),
    requisiteText: access?.requisites?.ruleText ?? '',
    antiRequisites: (access?.antiRequisites?.items ?? []).flatMap((i) => (i.kind === 'subject' ? [i.code] : [])),
    recommended,
    url: `${HANDBOOK}/subject/${year}/${code}`,
  };
}

function legacySubject(code: string, title: string, year: string): Subject {
  return {
    code,
    title: title || code,
    creditPoints: 0,
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
    url: `${HANDBOOK}/subject/${year}/${code}`,
    legacy: true,
  };
}

/** Build one map from degrees already pulled into `rawDir`. Shared programs and subjects exist once. */
export async function buildMap(rawDir: string, year: string, courseCodes: string[]): Promise<MapDoc> {
  const refs: Referenced = { subjects: new Map(), programs: new Map() };
  const degrees: Record<string, Degree> = {};
  for (const courseCode of courseCodes) {
    const course = await readJson(`${rawDir}/course/${year}/${courseCode}.json`);
    if (!course) throw new Error(`course ${courseCode} not in ${rawDir}`);
    degrees[courseCode] = {
      code: courseCode,
      title: clean(course.title),
      creditPoints: num(course.credit_points),
      level: clean(course.study_level_ref),
      faculty: clean(course.parent_academic_org),
      url: `${HANDBOOK}/course/${year}/${courseCode}`,
      structure: toContainer(course.curriculumStructure ?? {}, refs),
      studyPlans: studyPlans(course.study_plans),
    };
  }

  // Programs, recursively (a stream can name further programs).
  const programs: Record<string, Program> = {};
  const pending = [...refs.programs.keys()];
  while (pending.length) {
    const code = pending.shift()!;
    if (programs[code]) continue;
    const raw = await readJson(`${rawDir}/aos/${year}/${code}.json`);
    const before = new Set(refs.programs.keys());
    programs[code] = raw
      ? {
          code,
          title: clean(raw.title),
          kind: programKind(raw.academic_item_type),
          creditPoints: num(raw.credit_points),
          url: `${HANDBOOK}/aos/${year}/${code}`,
          structure: toContainer(raw.curriculumStructure ?? {}, refs),
        }
      : {
          code,
          title: refs.programs.get(code) || code,
          kind: programKind(code.startsWith('MAJ') ? 'major' : code.startsWith('SMJ') ? 'sub-major' : 'stream'),
          creditPoints: 0,
          url: `${HANDBOOK}/aos/${year}/${code}`,
          structure: { id: code, title: 'Structure', description: '', creditPoints: 0, kind: 'group', children: [], items: [] },
          legacy: true,
        };
    for (const c of refs.programs.keys()) if (!before.has(c)) pending.push(c);
  }

  // Subjects named by any structure, then one hop of requisite subjects.
  const subjects: Record<string, Subject> = {};
  const accessFor = async (code: string) => {
    const html = await readFile(`${rawDir}/access/${code}.html`, 'utf8').catch(() => null);
    return html ? parseAccessConditions(html) : null;
  };
  const addSubject = async (code: string, fallbackTitle: string) => {
    if (subjects[code]) return;
    const raw = await readJson(`${rawDir}/subject/${year}/${code}.json`);
    subjects[code] = raw ? toSubject(code, raw, await accessFor(code), year) : legacySubject(code, fallbackTitle, year);
  };
  for (const [code, title] of refs.subjects) await addSubject(code, title);
  for (const code of [...refs.subjects.keys()]) {
    const access = await accessFor(code);
    for (const item of access?.requisites?.items ?? []) {
      if (item.kind === 'subject') await addSubject(item.code, item.title);
    }
  }

  return {
    schema: 2,
    id: `uts-${year}`,
    institution: 'UTS',
    year,
    source: { name: 'UTS Handbook', url: HANDBOOK, fetchedAt: new Date().toISOString().slice(0, 10) },
    degrees,
    programs,
    subjects,
  };
}
