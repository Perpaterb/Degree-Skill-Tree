import type { Container, Degree, MapDoc, Rule, Subject } from './model.js';

/** A student's plan. Codes only, so it serialises into a URL. */
export interface Plan {
  completed: string[];
  planned: string[];
  /** Chosen majors / sub-majors / streams. */
  programs: string[];
  /** The degree being worked towards, if any. */
  degree: string | null;
}

export const emptyPlan = (): Plan => ({ completed: [], planned: [], programs: [], degree: null });

export type NodeState =
  | 'completed'
  | 'planned'
  | 'available' // requisites met by completed subjects
  | 'reachable' // requisites met once planned subjects are done
  | 'locked'
  | 'excluded' // anti-requisite of something completed or planned
  | 'legacy'; // not in this handbook year

export interface Ctx {
  map: MapDoc;
  have: Set<string>;
  haveCp: number;
  /** The degree the student is enrolled in (the selected one), or null for "any degree on the map". */
  enrolled: string | null;
}

export function makeCtx(map: MapDoc, codes: Iterable<string>, enrolled: string | null = null): Ctx {
  const have = new Set(codes);
  let haveCp = 0;
  for (const c of have) haveCp += map.subjects[c]?.creditPoints ?? 0;
  return { map, have, haveCp, enrolled };
}

/**
 * Whether a rule is satisfied.
 * - Course conditions are met by the selected degree; with none selected, by any degree on the map
 *   (the student could enrol in it).
 * - Credit-point conditions are scoped to a course type/faculty at the source; within one institution's
 *   map they are checked against credit points held.
 * - Free-text conditions cannot be evaluated and count as met; the UI shows them as notes.
 */
export function ruleMet(rule: Rule | null, ctx: Ctx): boolean {
  if (!rule) return true;
  if ('op' in rule) return rule.op === 'and' ? rule.args.every((r) => ruleMet(r, ctx)) : rule.args.some((r) => ruleMet(r, ctx));
  if ('subject' in rule) return ctx.have.has(rule.subject);
  if ('course' in rule) return ctx.enrolled ? rule.course === ctx.enrolled : !!ctx.map.degrees[rule.course];
  if ('creditPoints' in rule) return ctx.haveCp >= rule.creditPoints;
  return true;
}

export function clashes(subject: Subject, taken: Set<string>, map: MapDoc): boolean {
  if (subject.antiRequisites.some((c) => taken.has(c))) return true;
  // Anti-requisites are not always listed in both directions.
  for (const c of taken) if (map.subjects[c]?.antiRequisites.includes(subject.code)) return true;
  return false;
}

export function computeStates(map: MapDoc, plan: Plan): Map<string, NodeState> {
  const completed = new Set(plan.completed);
  const planned = new Set(plan.planned.filter((c) => !completed.has(c)));
  const now = makeCtx(map, completed, plan.degree);
  const later = makeCtx(map, [...completed, ...planned], plan.degree);
  const taken = new Set([...completed, ...planned]);
  const states = new Map<string, NodeState>();
  for (const s of Object.values(map.subjects)) {
    let state: NodeState;
    if (completed.has(s.code)) state = 'completed';
    else if (planned.has(s.code)) state = 'planned';
    else if (s.legacy) state = 'legacy';
    else if (clashes(s, taken, map)) state = 'excluded';
    else if (ruleMet(s.requisite, now)) state = 'available';
    else if (ruleMet(s.requisite, later)) state = 'reachable';
    else state = 'locked';
    states.set(s.code, state);
  }
  return states;
}

export interface Missing {
  /** Subjects to add, in an order that respects their own requisites (deepest first). */
  subjects: string[];
  creditPoints: number;
  /** Conditions that cannot be satisfied by picking subjects (credit-point totals, free text). */
  notes: string[];
}

/**
 * The cheapest set of subjects that would unlock `code`, given what the student has.
 * OR branches pick the one needing the fewest extra credit points; ties go to the first listed.
 * Legacy subjects are never suggested when a current alternative exists.
 */
export function missingFor(map: MapDoc, code: string, have: Set<string>, enrolled: string | null = null): Missing {
  const memo = new Map<string, Missing | null>();
  const haveCp = makeCtx(map, have).haveCp;

  const merge = (parts: Missing[]): Missing => {
    const subjects: string[] = [];
    const notes: string[] = [];
    for (const p of parts) {
      for (const s of p.subjects) if (!subjects.includes(s)) subjects.push(s);
      for (const n of p.notes) if (!notes.includes(n)) notes.push(n);
    }
    return { subjects, notes, creditPoints: subjects.reduce((t, s) => t + (map.subjects[s]?.creditPoints ?? 6), 0) };
  };

  const cost = (m: Missing | null) =>
    m === null ? Infinity : m.creditPoints + m.subjects.filter((s) => map.subjects[s]?.legacy || !map.subjects[s]).length * 1000;

  function forRule(rule: Rule | null, stack: string[]): Missing | null {
    if (!rule) return { subjects: [], notes: [], creditPoints: 0 };
    if ('op' in rule) {
      const parts = rule.args.map((r) => forRule(r, stack));
      if (rule.op === 'and') return parts.some((p) => p === null) ? null : merge(parts as Missing[]);
      let best: Missing | null = null;
      for (const p of parts) if (cost(p) < cost(best)) best = p;
      return best;
    }
    if ('subject' in rule) return forSubject(rule.subject, stack);
    if ('course' in rule) return (enrolled ? rule.course === enrolled : !!map.degrees[rule.course]) ? merge([]) : null;
    if ('creditPoints' in rule)
      return merge(haveCp >= rule.creditPoints ? [] : [{ subjects: [], creditPoints: 0, notes: [`at least ${rule.creditPoints}cp completed`] }]);
    return merge([{ subjects: [], creditPoints: 0, notes: [rule.text] }]);
  }

  function forSubject(c: string, stack: string[]): Missing | null {
    if (have.has(c)) return merge([]);
    if (stack.includes(c)) return null; // cycle in source data
    if (memo.has(c)) return memo.get(c)!;
    const subject = map.subjects[c];
    // Outside this map: suggest it, but we cannot see its own requisites.
    const inner = subject ? forRule(subject.requisite, [...stack, c]) : merge([]);
    const result = inner === null ? null : merge([inner, { subjects: [c], notes: [], creditPoints: 0 }]);
    memo.set(c, result);
    return result;
  }

  const target = map.subjects[code];
  return forRule(target?.requisite ?? null, [code]) ?? { subjects: [], creditPoints: 0, notes: ['no route found on this map'] };
}

export interface PrerequisiteGap extends Missing {
  /** The rule offers alternatives, so other combinations than `subjects` would also work. */
  alternatives: boolean;
}

/**
 * What must be completed before `code` counts as having its prerequisites (US-025), or null when
 * the completed subjects already meet its requisite rule. Planned subjects do not count.
 */
export function prerequisiteGap(map: MapDoc, code: string, completed: Iterable<string>, enrolled: string | null = null): PrerequisiteGap | null {
  const subject = map.subjects[code];
  const have = new Set(completed);
  if (!subject || ruleMet(subject.requisite, makeCtx(map, have, enrolled))) return null;
  const hasOr = (rule: Rule | null): boolean => !!rule && 'op' in rule && ((rule.op === 'or' && rule.args.length > 1) || rule.args.some(hasOr));
  return { ...missingFor(map, code, have, enrolled), alternatives: hasOr(subject.requisite) };
}

/** Subjects whose requisite rule mentions `code` anywhere. */
export function unlockedBy(map: MapDoc, code: string): string[] {
  const mentions = (r: Rule | null): boolean => !!r && ('op' in r ? r.args.some(mentions) : 'subject' in r && r.subject === code);
  return Object.values(map.subjects)
    .filter((s) => mentions(s.requisite))
    .map((s) => s.code);
}

/** Every subject code a rule mentions. */
export function ruleSubjects(r: Rule | null, out: string[] = []): string[] {
  if (!r) return out;
  if ('op' in r) r.args.forEach((a) => ruleSubjects(a, out));
  else if ('subject' in r && !out.includes(r.subject)) out.push(r.subject);
  return out;
}

/** Subjects listed anywhere inside a container, including inside the programs it names. */
export function subjectsUnder(map: MapDoc, c: Container, out = new Set<string>(), seen = new Set<string>()): Set<string> {
  for (const i of c.items) {
    if (i.kind === 'subject') out.add(i.code);
    else if (!seen.has(i.code) && map.programs[i.code]) {
      seen.add(i.code);
      subjectsUnder(map, map.programs[i.code].structure, out, seen);
    }
  }
  for (const ch of c.children) subjectsUnder(map, ch, out, seen);
  return out;
}

/** Programs named anywhere inside a container, including programs named by those programs. */
export function programsUnder(map: MapDoc, c: Container, out = new Set<string>()): Set<string> {
  for (const i of c.items) {
    if (i.kind === 'program' && !out.has(i.code)) {
      out.add(i.code);
      if (map.programs[i.code]) programsUnder(map, map.programs[i.code].structure, out);
    }
  }
  for (const ch of c.children) programsUnder(map, ch, out);
  return out;
}

export interface Progress {
  id: string;
  title: string;
  description: string;
  required: number;
  done: number;
  planned: number;
  children: Progress[];
  /** Programs and subjects this requirement names directly, for highlighting on the map. */
  refs: string[];
}

/**
 * Credit points towards each structure container of one degree. Subjects are claimed by the
 * first container (in structure order) that lists them, so nothing counts twice; free-elective
 * containers take whatever is left over.
 */
export function progress(map: MapDoc, degreeCode: string, plan: Plan): Progress {
  const degree = map.degrees[degreeCode];
  const completed = new Set(plan.completed);
  const planned = new Set(plan.planned.filter((c) => !completed.has(c)));
  const chosen = new Set(plan.programs);
  const claimed = new Set<string>();
  const free: Progress[] = [];
  const cp = (c: string) => map.subjects[c]?.creditPoints ?? 0;

  function walk(container: Container, idPrefix = ''): Progress {
    const node: Progress = {
      id: idPrefix + container.id,
      title: container.title,
      description: container.description,
      required: container.creditPoints,
      done: 0,
      planned: 0,
      children: [],
      refs: container.items.map((i) => i.code),
    };
    if (container.kind === 'free') {
      free.push(node);
      return node;
    }
    for (const item of container.items) {
      if (item.kind === 'subject') {
        if (claimed.has(item.code)) continue;
        if (completed.has(item.code)) (node.done += cp(item.code)), claimed.add(item.code);
        else if (planned.has(item.code)) (node.planned += cp(item.code)), claimed.add(item.code);
      } else if (chosen.has(item.code)) {
        const program = map.programs[item.code];
        if (!program) continue;
        const sub = walk(program.structure, item.code + ':');
        sub.title = program.title;
        sub.required = program.creditPoints || sub.required;
        sub.refs = [item.code];
        node.children.push(sub);
      }
    }
    for (const child of container.children) node.children.push(walk(child, idPrefix));
    return node;
  }

  const root = walk(degree.structure);
  for (const node of free) {
    for (const c of [...completed].filter((c) => !claimed.has(c))) {
      if (node.done >= node.required) break;
      node.done += cp(c);
      claimed.add(c);
    }
    for (const c of [...planned].filter((c) => !claimed.has(c))) {
      if (node.done + node.planned >= node.required) break;
      node.planned += cp(c);
      claimed.add(c);
    }
  }

  // Roll up: each node counts its children, capped at its own requirement.
  const roll = (n: Progress): void => {
    n.children.forEach(roll);
    n.done += n.children.reduce((t, c) => t + c.done, 0);
    n.planned += n.children.reduce((t, c) => t + c.planned, 0);
    if (n.required > 0) {
      n.done = Math.min(n.done, n.required);
      n.planned = Math.min(n.planned, n.required - n.done);
    }
  };
  roll(root);
  root.title = degree.title;
  return root;
}

/** Subjects a degree requires outright: every item of a subjects-only container whose items add up to exactly its credit points. */
export function compulsorySubjects(map: MapDoc, c: Container, out = new Set<string>()): Set<string> {
  const subjects = c.items.filter((i) => i.kind === 'subject');
  const total = subjects.reduce((t, i) => t + (map.subjects[i.code]?.creditPoints ?? 0), 0);
  if (c.kind === 'group' && subjects.length && subjects.length === c.items.length && total === c.creditPoints) {
    subjects.forEach((i) => out.add(i.code));
  }
  for (const ch of c.children) compulsorySubjects(map, ch, out);
  return out;
}

export interface Fit {
  degree: string;
  completedCp: number;
  /** Completed credit points that can count toward the degree. */
  countingCp: number;
  wasted: { code: string; reason: string }[];
  /** A completed subject rules out one of the degree's compulsory subjects. */
  impossible: boolean;
  /** 0 = everything counts, 1 = nothing counts or the degree cannot be completed. */
  grey: number;
}

/**
 * How well completed subjects fit a degree (US-023). A completed subject counts if the degree
 * (or any program it offers) lists it, or while free-elective room remains. This ignores the caps
 * of option groups inside a program, so it can overstate what counts; it never understates.
 */
export function compatibility(map: MapDoc, degreeCode: string, plan: Plan): Fit {
  const degree: Degree = map.degrees[degreeCode];
  const listed = subjectsUnder(map, degree.structure);
  const freeRoom = (function sum(c: Container): number {
    return (c.kind === 'free' ? c.creditPoints : 0) + c.children.reduce((t, ch) => t + sum(ch), 0);
  })(degree.structure);
  const compulsory = compulsorySubjects(map, degree.structure);
  const cp = (c: string) => map.subjects[c]?.creditPoints ?? 0;

  let room = freeRoom;
  let counting = 0;
  let completedCp = 0;
  const wasted: Fit['wasted'] = [];
  let impossible = false;
  // Listed subjects first, so they never use up free-elective room.
  const ordered = [...plan.completed].sort((a, b) => Number(listed.has(b)) - Number(listed.has(a)) || a.localeCompare(b));
  const taken = new Set(plan.completed);
  for (const code of ordered) {
    completedCp += cp(code);
    const s = map.subjects[code];
    const blocks = [...compulsory].filter((req) => !taken.has(req) && map.subjects[req] && s && clashes(map.subjects[req], new Set([code]), map));
    if (blocks.length) {
      impossible = true;
      wasted.push({ code, reason: `cannot be taken with ${blocks.join(', ')}, which this degree requires` });
      continue;
    }
    if (listed.has(code)) counting += cp(code);
    else if (room >= cp(code) && cp(code) > 0) {
      room -= cp(code);
      counting += cp(code);
    } else wasted.push({ code, reason: freeRoom ? `not part of this degree, and its ${freeRoom}cp of free electives are used up` : 'not part of this degree, which has no free electives' });
  }
  const wastedCp = completedCp - counting;
  const grey = impossible ? 1 : completedCp ? wastedCp / completedCp : 0;
  return { degree: degreeCode, completedCp, countingCp: counting, wasted, impossible, grey };
}

// URL form: "d=C10148&c=31251.31268&p=41039&m=MAJ03444". Readable, short, and stable.
export function encodePlan(plan: Plan): string {
  const parts: string[] = [];
  if (plan.degree) parts.push('d=' + plan.degree);
  if (plan.completed.length) parts.push('c=' + plan.completed.join('.'));
  if (plan.planned.length) parts.push('p=' + plan.planned.join('.'));
  if (plan.programs.length) parts.push('m=' + plan.programs.join('.'));
  return parts.join('&');
}

export function decodePlan(s: string): Plan {
  const plan = emptyPlan();
  const params = new URLSearchParams(s.replace(/^[#?]/, ''));
  const list = (k: string) => (params.get(k) ?? '').split('.').filter((x) => /^[A-Za-z0-9]+$/.test(x));
  plan.completed = list('c');
  plan.planned = list('p').filter((c) => !plan.completed.includes(c));
  plan.programs = list('m');
  plan.degree = list('d')[0] ?? null;
  return plan;
}
