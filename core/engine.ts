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
  /**
   * Conditions on this route the map cannot check: free text (e.g. "Admission into C04143 Master of
   * Laws"), or a course requirement when no degree is chosen. A route with fewer wins (US-045).
   */
  unchecked?: number;
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
    let unchecked = 0;
    for (const p of parts) {
      for (const s of p.subjects) if (!subjects.includes(s)) subjects.push(s);
      for (const n of p.notes) if (!notes.includes(n)) notes.push(n);
      unchecked += p.unchecked ?? 0;
    }
    return { subjects, notes, creditPoints: subjects.reduce((t, s) => t + (map.subjects[s]?.creditPoints ?? 6), 0), unchecked };
  };

  // A route through subjects beats one resting on a condition the map cannot check: an admission-only
  // alternative used to win at no cost, so the requisite lines never lit (US-045). Legacy subjects
  // cost the most, since they cannot be taken at all.
  const cost = (m: Missing | null) =>
    m === null ? Infinity : m.creditPoints + (m.unchecked ?? 0) * 500 + m.subjects.filter((s) => map.subjects[s]?.legacy || !map.subjects[s]).length * 1000;

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
    if ('course' in rule) {
      if (enrolled) return rule.course === enrolled ? merge([]) : null;
      // No degree chosen: assumed possible, but unchecked.
      return map.degrees[rule.course] ? merge([{ subjects: [], notes: [], creditPoints: 0, unchecked: 1 }]) : null;
    }
    if ('creditPoints' in rule)
      return merge(haveCp >= rule.creditPoints ? [] : [{ subjects: [], creditPoints: 0, notes: [`at least ${rule.creditPoints}cp completed`] }]);
    return merge([{ subjects: [], creditPoints: 0, notes: [rule.text], unchecked: 1 }]);
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
  /** Set on the node of a chosen program: its code. */
  program?: string;
  /** The program is counted because it is the only thing its requirement names, not because it was chosen. */
  implied?: boolean;
  /** Completed or planned subjects this requirement lists that already count somewhere else, and where. */
  elsewhere?: { code: string; by: string }[];
  /** A free-elective requirement: the completed and planned subjects filling it (US-032). */
  fills?: string[];
  /** Numbered ways to fill this requirement, when the handbook text lists them (e.g. "1. one major (48cp) ..."). */
  ways?: WayProgress[];
  /** On the root only: completed and planned subjects counted by a listing requirement, and the program code (or requirement id) counting them. */
  claims?: Map<string, string>;
}

export interface WayProgress {
  text: string;
  /** False when the text could not be read as majors, sub-majors and electives; such a way is shown but not counted. */
  understood: boolean;
  required: number;
  done: number;
  planned: number;
  /** A program this way needs (a major, a sub-major, a stream) has been chosen. */
  chosen: boolean;
  /** Each part of the way ("one sub-major (24cp)", "four electives (24cp)"), counted on its own. */
  parts: WayPartProgress[];
}

export interface WayPartProgress {
  text: string;
  what: WayPart['what'];
  required: number;
  done: number;
  planned: number;
}

/** How far a requirement (or a way) has got: met by completed subjects, met once planned ones are done, started, or untouched. */
export type Status = 'complete' | 'planned' | 'started' | 'none';

export function progressStatus(p: { required: number; done: number; planned: number; children?: Progress[]; chosen?: boolean }): Status {
  if (p.required > 0 && p.done >= p.required) return 'complete';
  if (p.required > 0 && p.done + p.planned >= p.required) return 'planned';
  if (p.done + p.planned > 0 || p.chosen || hasChosen(p.children ?? [])) return 'started';
  return 'none';
}

/** Whether a chosen program sits anywhere below. */
const hasChosen = (children: Progress[]): boolean => children.some((c) => (!!c.program && !c.implied) || hasChosen(c.children));

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export interface WayPart {
  text: string;
  what: 'major' | 'sub_major' | 'stream' | 'electives';
  count: number;
  cp: number;
}

/**
 * Split a requirement's text into its numbered ways ("... four ways: 1. one major (48cp); 2. two
 * sub-majors (2 x 24cp); ...") and read each as parts: so many majors, sub-majors, transdisciplinary
 * elective streams and elective credit points. Returns [] when the text lists no numbered ways.
 */
export function parseWays(description: string): { text: string; parts: WayPart[] | null }[] {
  const at = description.search(/\b1\.\s/);
  if (at < 0) return [];
  const pieces = description
    .slice(at)
    .split(/(?:^|\s)\d\.\s+/)
    .map((t) => t.trim().replace(/[;.]$/, '').trim())
    .filter(Boolean);
  return pieces.map((text) => {
    const parts: WayPart[] = [];
    for (const piece of text.split(/\s+(?:and|plus)\s+/i)) {
      const m = piece.match(/^(\w+)\s+(transdisciplinary electives?|electives?|sub-majors?|majors?)\s*\((.*?)\)/i) ?? piece.match(/^()(electives?)\s*\((.*?)\)/i);
      if (!m) return { text, parts: null };
      const count = m[1] ? (WORDS[m[1].toLowerCase()] ?? Number(m[1])) : 1;
      const kind = m[2].toLowerCase();
      const paren = m[3];
      const times = paren.match(/(\d+)\s*x\s*(\d+)\s*cp/i);
      const each = paren.match(/(\d+)\s*cp for each/i);
      const cp = times ? Number(times[1]) * Number(times[2]) : each ? count * Number(each[1]) : Number(paren.match(/(\d+)\s*cp/i)?.[1] ?? NaN);
      if (!count || !Number.isFinite(cp)) return { text, parts: null };
      const what = kind.startsWith('transdisciplinary') ? 'stream' : kind.startsWith('elective') ? 'electives' : kind.startsWith('sub') ? 'sub_major' : 'major';
      parts.push({ text: piece.trim(), what, count, cp });
    }
    return { text, parts };
  });
}

/** "Select one of the following ..." : only the best single child counts, not their sum. */
const chooseOne = (description: string) => /\bone of the following\b/i.test(description);

/**
 * Credit points towards each structure container of a degree or program. Subjects are claimed by
 * the first container (in structure order) that lists them, so nothing counts twice; free-elective
 * containers take whatever is left over. A container of "one of the following" counts its best
 * child; one with numbered ways counts its best way.
 */
function measure(map: MapDoc, structure: Container, plan: Plan): Progress {
  const completed = new Set(plan.completed);
  const planned = new Set(plan.planned.filter((c) => !completed.has(c)));
  const picked = new Set(plan.programs);
  // A requirement naming one program and nothing else (e.g. "Transdisciplinary Electives: select 6cp
  // from the following stream") leaves nothing to choose, so that program counts without choosing it.
  const implied = new Set<string>();
  (function only(c: Container) {
    if (c.items.length === 1 && c.items[0].kind === 'program' && !picked.has(c.items[0].code)) implied.add(c.items[0].code);
    c.children.forEach(only);
  })(structure);
  const chosen = new Set([...picked, ...implied]);
  /** Subject code -> the requirement (or program) it counts towards: `key` identifies it, `title` names it. */
  const claimed = new Map<string, { key: string; title: string }>();
  const free: Progress[] = [];
  const isFree = new Set<Progress>();
  const cp = (c: string) => map.subjects[c]?.creditPoints ?? 0;

  // A chosen program counts in one place only. The same major can be listed twice (e.g. "Major" and
  // again under "Options"), so a second chosen major must fill the second list, not the first again.
  const listings = new Map<string, number>();
  (function count(c: Container) {
    for (const i of c.items) if (i.kind === 'program' && chosen.has(i.code)) listings.set(i.code, (listings.get(i.code) ?? 0) + 1);
    c.children.forEach(count);
  })(structure);
  const placed = new Set<string>();

  function walk(container: Container, idPrefix = '', owner = { key: container.id, title: container.title }): Progress {
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
      isFree.add(node);
      return node;
    }
    for (const item of container.items) {
      if (item.kind !== 'subject' || !(completed.has(item.code) || planned.has(item.code))) continue;
      const by = claimed.get(item.code);
      if (by !== undefined) {
        // Compared by key: two programs can share a title (the Data Analytics major and sub-major).
        if (by.key !== owner.key) (node.elsewhere ??= []).push({ code: item.code, by: by.title });
        continue;
      }
      if (completed.has(item.code)) node.done += cp(item.code);
      else node.planned += cp(item.code);
      claimed.set(item.code, owner);
    }
    // "One of the following" holds one program. Programs with fewer other places to go get it first,
    // then the order they were chosen in. A program with nowhere else left still goes here.
    const order = (c: string) => plan.programs.indexOf(c);
    const candidates = container.items
      .filter((i) => i.kind === 'program' && chosen.has(i.code) && !placed.has(i.code) && map.programs[i.code])
      .map((i) => i.code)
      .sort((a, b) => (listings.get(a) ?? 0) - (listings.get(b) ?? 0) || order(a) - order(b));
    let slots = chooseOne(container.description) ? 1 : Infinity;
    for (const code of candidates) {
      const later = (listings.get(code) ?? 1) - 1;
      listings.set(code, later);
      if (slots <= 0 && later > 0) continue;
      slots--;
      placed.add(code);
      const program = map.programs[code];
      const sub = walk(program.structure, code + ':', { key: code, title: program.title });
      sub.title = program.title;
      sub.required = program.creditPoints || sub.required;
      sub.refs = [code];
      sub.program = code;
      if (implied.has(code)) sub.implied = true;
      node.children.push(sub);
    }
    for (const child of container.children) node.children.push(walk(child, idPrefix, idPrefix ? owner : { key: child.id, title: child.title }));
    return node;
  }

  const root = walk(structure);
  root.claims = new Map([...claimed].map(([c, o]) => [c, o.key]));
  for (const node of free) {
    for (const c of [...completed].filter((c) => !claimed.has(c))) {
      if (node.done >= node.required) break;
      node.done += cp(c);
      claimed.set(c, { key: node.id, title: node.title });
      (node.fills ??= []).push(c);
    }
    for (const c of [...planned].filter((c) => !claimed.has(c))) {
      if (node.done + node.planned >= node.required) break;
      node.planned += cp(c);
      claimed.set(c, { key: node.id, title: node.title });
      (node.fills ??= []).push(c);
    }
  }

  const below = (n: Progress, test: (d: Progress) => boolean, out: Progress[] = []): Progress[] => {
    for (const c of n.children) {
      if (test(c)) out.push(c);
      else below(c, test, out);
    }
    return out;
  };
  const kindOf = (d: Progress) => (d.program ? map.programs[d.program]?.kind : undefined);

  // Credit points a requirement had beyond its cap (done, done + planned), before capping.
  const over = new Map<Progress, [number, number]>();
  const sharedCp = (n: Progress): number =>
    (n.elsewhere ?? []).reduce((t, e) => t + cp(e.code), 0) + n.children.filter((c) => !c.program).reduce((t, c) => t + sharedCp(c), 0);

  // Roll up bottom-up: children are summed (or the best one taken), capped at the requirement.
  const roll = (n: Progress): void => {
    n.children.forEach(roll);
    const dp = (c: { done: number; planned: number }) => c.done + c.planned;
    let done = n.done;
    let reach = n.done + n.planned;
    if (chooseOne(n.description) && n.children.length) {
      done += Math.max(...n.children.map((c) => c.done));
      reach += Math.max(...n.children.map(dp));
    } else {
      done += n.children.reduce((t, c) => t + c.done, 0);
      reach += n.children.reduce((t, c) => t + dp(c), 0);
    }
    const ways = parseWays(n.description);
    if (ways.length) {
      n.ways = ways.map(({ text, parts }) => {
        if (!parts) return { text, understood: false, required: 0, done: 0, planned: 0, chosen: false, parts: [] };
        let wDone = 0;
        let wReach = 0;
        let chosenHere = false;
        const partProgress: WayPartProgress[] = [];
        for (const part of parts) {
          const pool = part.what === 'electives' ? below(n, (d) => isFree.has(d)) : below(n, (d) => kindOf(d) === part.what);
          // A way is started once one of its programs is chosen, or an implied one has something in it.
          if (part.what !== 'electives' && pool.some((d) => !d.implied || d.done + d.planned > 0)) chosenHere = true;
          // Programs: the best `count` of them. Electives: all the free credit points under this requirement.
          const take = (score: (d: Progress) => number) =>
            part.what === 'electives'
              ? pool.reduce((t, d) => t + score(d), 0)
              : pool.map(score).sort((a, b) => b - a).slice(0, part.count).reduce((t, v) => t + v, 0);
          const pDone = Math.min(part.cp, take((d) => d.done));
          const pReach = Math.min(part.cp, take(dp));
          partProgress.push({ text: part.text, what: part.what, required: part.cp, done: pDone, planned: pReach - pDone });
          wDone += pDone;
          wReach += pReach;
        }
        const required = parts.reduce((t, p) => t + p.cp, 0);
        return { text, understood: true, required, done: wDone, planned: wReach - wDone, chosen: chosenHere, parts: partProgress };
      });
      const counted = n.ways.filter((w) => w.understood);
      if (counted.length) {
        done = n.done + Math.max(...counted.map((w) => w.done));
        reach = n.done + n.planned + Math.max(...counted.map((w) => w.done + w.planned));
      }
    }
    // A subject that already counts towards another program leaves a gap here; extra subjects taken
    // from this program's own lists (beyond their caps) fill it, as a replacement subject would.
    if (n.program) {
      const gap = sharedCp(n);
      const extra = n.children.filter((c) => !c.program).map((c) => over.get(c) ?? [0, 0]);
      done += Math.min(gap, extra.reduce((t, e) => t + e[0], 0));
      reach += Math.min(gap, extra.reduce((t, e) => t + e[1], 0));
    }
    if (n.required > 0) {
      over.set(n, [Math.max(0, done - n.required), Math.max(0, reach - n.required)]);
      done = Math.min(done, n.required);
      reach = Math.min(reach, n.required);
    }
    n.done = done;
    n.planned = Math.max(0, reach - done);
  };
  roll(root);
  return root;
}

/** Progress towards one degree, for the progress panel and the degree outline (US-022, US-027). */
export function progress(map: MapDoc, degreeCode: string, plan: Plan): Progress {
  const degree = map.degrees[degreeCode];
  // A chosen program locked out of this degree counts nothing (US-038).
  const root = measure(map, degree.structure, { ...plan, programs: programLocks(map, degreeCode, plan).accepted });
  root.title = degree.title;
  return root;
}

/** Progress towards one program on its own, whether or not it is chosen (US-026). */
export function programProgress(map: MapDoc, code: string, plan: Plan): Progress {
  const program = map.programs[code];
  const root = measure(map, program.structure, plan);
  root.title = program.title;
  root.required = program.creditPoints || root.required;
  root.done = Math.min(root.done, root.required);
  root.planned = Math.min(root.planned, root.required - root.done);
  root.program = code;
  return root;
}

/** Why a major or sub-major can no longer count towards the selected degree (US-037). */
export interface Lock {
  /**
   * No room left for it; its subjects count elsewhere so it cannot be completed; it clashes with a
   * subject taken; or it belongs to a double degree that is not the one chosen (US-048).
   */
  why: 'room' | 'overlap' | 'clash' | 'pairing';
  text: string;
  /** Chosen programs (room, overlap) or taken subjects (clash) that cause it. */
  blockers: string[];
}

const programCp = (map: MapDoc, code: string) => map.programs[code]?.creditPoints || map.programs[code]?.structure.creditPoints || 0;
const lockable = (map: MapDoc, code: string) => map.programs[code]?.kind === 'major' || map.programs[code]?.kind === 'sub_major';

/**
 * Whether these programs can all count towards a degree at once, read from its structure: each goes
 * in a requirement that lists it; a requirement with numbered ways takes what one of its ways allows
 * (so many majors, so many sub-majors); any other requirement takes programs up to its credit points.
 */
export function programsFit(map: MapDoc, degreeCode: string, codes: string[]): boolean {
  const structure = map.degrees[degreeCode].structure;
  const homes = new Map<string, Container[]>(codes.map((c) => [c, []]));
  (function find(c: Container) {
    for (const i of c.items) if (i.kind === 'program' && homes.has(i.code)) homes.get(i.code)!.push(c);
    c.children.forEach(find);
  })(structure);
  if (codes.some((c) => !homes.get(c)!.length)) return false;

  const ok = (at: Map<string, Container>) => {
    const inside = (c: Container, out: string[] = []): string[] => {
      for (const [code, home] of at) if (home === c) out.push(code);
      c.children.forEach((ch) => inside(ch, out));
      return out;
    };
    const check = (c: Container, underWays: boolean): boolean => {
      const here = inside(c);
      const ways = parseWays(c.description).filter((w) => w.parts);
      if (ways.length) {
        const count = (k: string) => here.filter((p) => map.programs[p]?.kind === k).length;
        const fits = ways.some((w) =>
          (['major', 'sub_major', 'stream'] as const).every((k) => count(k) <= w.parts!.filter((p) => p.what === k).reduce((t, p) => t + p.count, 0)),
        );
        if (!fits) return false;
        underWays = true;
      } else if (!underWays && c.creditPoints > 0 && here.reduce((t, p) => t + programCp(map, p), 0) > c.creditPoints) return false;
      return c.children.every((ch) => check(ch, underWays));
    };
    return check(structure, false);
  };

  // Every way of placing each program in one of the requirements that list it (a handful at most).
  const place = (i: number, at: Map<string, Container>): boolean => {
    if (i === codes.length) return ok(at);
    for (const home of homes.get(codes[i])!) {
      at.set(codes[i], home);
      if (place(i + 1, at)) return true;
    }
    at.delete(codes[i]);
    return false;
  };
  return place(0, new Map());
}

/**
 * Majors and sub-majors of a degree that can no longer count towards it (US-037, US-038). Chosen
 * programs are kept in the order they were chosen; one that does not fit beside those before it is
 * locked out, and `accepted` is the plan's programs without them.
 */
export function programLocks(map: MapDoc, degreeCode: string, plan: Plan): { accepted: string[]; locks: Map<string, Lock> } {
  const degree = map.degrees[degreeCode];
  const locks = new Map<string, Lock>();
  if (!degree) return { accepted: plan.programs, locks };
  const offered = [...programsUnder(map, degree.structure)].filter((c) => lockable(map, c));
  const taken = new Set([...plan.completed, ...plan.planned]);
  const cp = (c: string) => (map.subjects[c]?.legacy ? 0 : (map.subjects[c]?.creditPoints ?? 0));
  const title = (c: string) => map.programs[c]?.title ?? c;
  const kindName = (c: string) => (map.programs[c]?.kind === 'sub_major' ? 'sub-major' : 'major');
  const names = (codes: string[]) => codes.map((c) => `${title(c)} (${kindName(c)})`).join(' and ');

  const claimedFor = (accepted: string[]) => {
    // Subjects that count elsewhere: the degree's and the accepted programs' compulsory subjects, and
    // taken subjects already counted by a requirement or program (not by free electives).
    const owner = new Map<string, string>();
    compulsorySubjects(map, degree.structure).forEach((c) => owner.set(c, 'degree'));
    for (const p of accepted) if (offered.includes(p)) compulsorySubjects(map, map.programs[p].structure).forEach((c) => owner.has(c) || owner.set(c, p));
    const root = measure(map, degree.structure, { ...plan, programs: accepted });
    for (const [c, by] of root.claims ?? []) if (!owner.has(c)) owner.set(c, map.programs[by] ? by : 'degree');
    return owner;
  };

  const check = (code: string, accepted: string[], claimed: Map<string, string>): Lock | null => {
    // Only programs this degree offers take up its room; others chosen for another degree do not.
    const others = accepted.filter((c) => offered.includes(c) && c !== code);
    if (!programsFit(map, degreeCode, [...others, code])) {
      return { why: 'room', text: `No room: with ${names(others)} chosen, ${degree.title} has no place left for this ${kindName(code)}.`, blockers: others };
    }
    const listed = [...subjectsUnder(map, map.programs[code].structure)];
    const free = listed.filter((c) => !claimed.has(c) || claimed.get(c) === code).reduce((t, c) => t + cp(c), 0);
    const need = programCp(map, code);
    // Only a shortfall caused by subjects counting elsewhere; one caused by gaps in the handbook data
    // (subjects missing from this year) is not the student's doing and does not lock it.
    const total = listed.reduce((t, c) => t + cp(c), 0);
    if (free < Math.min(need, total)) {
      const by = [...new Set(listed.map((c) => claimed.get(c)).filter((b): b is string => !!b && b !== code))];
      const progs = by.filter((b) => b !== 'degree');
      const where = [...(progs.length ? [names(progs)] : []), ...(by.includes('degree') ? [`${degree.title}'s own requirements`] : [])].join(' and ');
      return { why: 'overlap', text: `Cannot be completed: its subjects already count towards ${where}, leaving ${free} of the ${need}cp it needs.`, blockers: progs };
    }
    for (const req of compulsorySubjects(map, map.programs[code].structure)) {
      const s = map.subjects[req];
      if (!s || taken.has(req)) continue;
      const against = [...taken].filter((t) => clashes(s, new Set([t]), map));
      if (against.length) return { why: 'clash', text: `Clashes: its compulsory subject ${req} cannot be taken with ${against.join(', ')}, which you have.`, blockers: against };
    }
    return null;
  };

  const accepted: string[] = [];
  for (const code of plan.programs) {
    const lock = offered.includes(code) ? check(code, accepted, claimedFor(accepted)) : null;
    if (lock) locks.set(code, lock);
    else accepted.push(code);
  }
  const claimed = claimedFor(accepted);
  for (const code of offered) if (!plan.programs.includes(code)) {
    const lock = check(code, accepted, claimed);
    if (lock) locks.set(code, lock);
  }
  return { accepted, locks };
}

/** Credit points for a circle's title (US-028). */
export interface TitleCp {
  done: number;
  planned: number;
  required: number;
}

/**
 * Credit points shown on a degree or program circle's title. Not capped: extra subjects show above
 * what is needed. A program counts the completed and planned subjects it lists; a degree counts the
 * completed subjects that can count towards it (compatibility), and the planned ones the same way.
 */
export function titleCp(map: MapDoc, id: string, plan: Plan): TitleCp | null {
  const cp = (c: string) => map.subjects[c]?.creditPoints ?? 0;
  const program = map.programs[id];
  if (program) {
    const listed = subjectsUnder(map, program.structure);
    const done = plan.completed.filter((c) => listed.has(c)).reduce((t, c) => t + cp(c), 0);
    const planned = plan.planned.filter((c) => listed.has(c) && !plan.completed.includes(c)).reduce((t, c) => t + cp(c), 0);
    return { done, planned, required: program.creditPoints };
  }
  const degree = map.degrees[id];
  if (!degree) return null;
  const done = compatibility(map, id, plan).countingCp;
  const reach = compatibility(map, id, { ...plan, completed: [...new Set([...plan.completed, ...plan.planned])] }).countingCp;
  return { done, planned: Math.max(0, reach - done), required: degree.creditPoints };
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
