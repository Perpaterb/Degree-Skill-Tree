import type { Container, Rule, Subject, TreeDoc } from './model.js';

/** A student's plan. Codes only, so it serialises into a URL. */
export interface Plan {
  completed: string[];
  planned: string[];
  /** Chosen majors / sub-majors / streams. */
  programs: string[];
}

export const emptyPlan = (): Plan => ({ completed: [], planned: [], programs: [] });

export type NodeState =
  | 'completed'
  | 'planned'
  | 'available' // requisites met by completed subjects
  | 'reachable' // requisites met once planned subjects are done
  | 'locked'
  | 'excluded' // anti-requisite of something completed or planned
  | 'legacy'; // not in this handbook year

export interface Ctx {
  tree: TreeDoc;
  have: Set<string>;
  haveCp: number;
}

export function makeCtx(tree: TreeDoc, codes: Iterable<string>): Ctx {
  const have = new Set(codes);
  let haveCp = 0;
  for (const c of have) haveCp += tree.subjects[c]?.creditPoints ?? 0;
  return { tree, have, haveCp };
}

/**
 * Whether a rule is satisfied.
 * - Course conditions are met when the course is the tree's degree (the student is enrolled in it).
 * - Credit-point conditions are scoped to a course type/faculty at the source; within one degree's
 *   tree that scope is the degree itself, so they are checked against credit points held.
 * - Free-text conditions cannot be evaluated and count as met; the UI shows them as notes.
 */
export function ruleMet(rule: Rule | null, ctx: Ctx): boolean {
  if (!rule) return true;
  if ('op' in rule) return rule.op === 'and' ? rule.args.every((r) => ruleMet(r, ctx)) : rule.args.some((r) => ruleMet(r, ctx));
  if ('subject' in rule) return ctx.have.has(rule.subject);
  if ('course' in rule) return rule.course === ctx.tree.degree.code;
  if ('creditPoints' in rule) return ctx.haveCp >= rule.creditPoints;
  return true;
}

export function clashes(subject: Subject, taken: Set<string>, tree: TreeDoc): boolean {
  if (subject.antiRequisites.some((c) => taken.has(c))) return true;
  // Anti-requisites are not always listed in both directions.
  for (const c of taken) if (tree.subjects[c]?.antiRequisites.includes(subject.code)) return true;
  return false;
}

export function computeStates(tree: TreeDoc, plan: Plan): Map<string, NodeState> {
  const completed = new Set(plan.completed);
  const planned = new Set(plan.planned.filter((c) => !completed.has(c)));
  const now = makeCtx(tree, completed);
  const later = makeCtx(tree, [...completed, ...planned]);
  const taken = new Set([...completed, ...planned]);
  const states = new Map<string, NodeState>();
  for (const s of Object.values(tree.subjects)) {
    let state: NodeState;
    if (completed.has(s.code)) state = 'completed';
    else if (planned.has(s.code)) state = 'planned';
    else if (s.legacy) state = 'legacy';
    else if (clashes(s, taken, tree)) state = 'excluded';
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
export function missingFor(tree: TreeDoc, code: string, have: Set<string>): Missing {
  const memo = new Map<string, Missing | null>();

  const merge = (parts: Missing[]): Missing => {
    const subjects: string[] = [];
    const notes: string[] = [];
    for (const p of parts) {
      for (const s of p.subjects) if (!subjects.includes(s)) subjects.push(s);
      for (const n of p.notes) if (!notes.includes(n)) notes.push(n);
    }
    return { subjects, notes, creditPoints: subjects.reduce((t, s) => t + (tree.subjects[s]?.creditPoints ?? 6), 0) };
  };

  const cost = (m: Missing | null) =>
    m === null ? Infinity : m.creditPoints + m.subjects.filter((s) => tree.subjects[s]?.legacy || !tree.subjects[s]).length * 1000;

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
    if ('course' in rule) return rule.course === tree.degree.code ? merge([]) : null;
    if ('creditPoints' in rule) return merge([{ subjects: [], creditPoints: 0, notes: [`at least ${rule.creditPoints}cp completed`] }]);
    return merge([{ subjects: [], creditPoints: 0, notes: [rule.text] }]);
  }

  function forSubject(c: string, stack: string[]): Missing | null {
    if (have.has(c)) return merge([]);
    if (stack.includes(c)) return null; // cycle in source data
    if (memo.has(c)) return memo.get(c)!;
    const subject = tree.subjects[c];
    // Outside this tree: suggest it, but we cannot see its own requisites.
    const inner = subject ? forRule(subject.requisite, [...stack, c]) : merge([]);
    const result = inner === null ? null : merge([inner, { subjects: [c], notes: [], creditPoints: 0 }]);
    memo.set(c, result);
    return result;
  }

  const target = tree.subjects[code];
  return forRule(target?.requisite ?? null, [code]) ?? { subjects: [], creditPoints: 0, notes: ['no route found in this tree'] };
}

/** Subjects whose requisite rule mentions `code` anywhere. */
export function unlockedBy(tree: TreeDoc, code: string): string[] {
  const mentions = (r: Rule | null): boolean =>
    !!r && ('op' in r ? r.args.some(mentions) : 'subject' in r && r.subject === code);
  return Object.values(tree.subjects)
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

export interface Progress {
  id: string;
  title: string;
  description: string;
  required: number;
  done: number;
  planned: number;
  children: Progress[];
}

/**
 * Credit points towards each structure container. Subjects are claimed by the first
 * container (in structure order) that lists them, so nothing counts twice; free-elective
 * containers take whatever is left over.
 */
export function progress(tree: TreeDoc, plan: Plan): Progress {
  const completed = new Set(plan.completed);
  const planned = new Set(plan.planned.filter((c) => !completed.has(c)));
  const chosen = new Set(plan.programs);
  const claimed = new Set<string>();
  const free: { node: Progress; container: Container }[] = [];
  const cp = (c: string) => tree.subjects[c]?.creditPoints ?? 0;

  function walk(container: Container, idPrefix = ''): Progress {
    const node: Progress = {
      id: idPrefix + container.id,
      title: container.title,
      description: container.description,
      required: container.creditPoints,
      done: 0,
      planned: 0,
      children: [],
    };
    if (container.kind === 'free') {
      free.push({ node, container });
      return node;
    }
    for (const item of container.items) {
      if (item.kind === 'subject') {
        if (claimed.has(item.code)) continue;
        if (completed.has(item.code)) (node.done += cp(item.code)), claimed.add(item.code);
        else if (planned.has(item.code)) (node.planned += cp(item.code)), claimed.add(item.code);
      } else if (chosen.has(item.code)) {
        const program = tree.programs[item.code];
        if (!program) continue;
        const sub = walk(program.structure, item.code + ':');
        sub.title = program.title;
        sub.required = program.creditPoints || sub.required;
        node.children.push(sub);
      }
    }
    for (const child of container.children) node.children.push(walk(child, idPrefix));
    return node;
  }

  const root = walk(tree.degree.structure);
  for (const { node } of free) {
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
  return root;
}

// URL form: "c=31251.31268&p=41039&m=MAJ03444". Readable, short, and stable.
export function encodePlan(plan: Plan): string {
  const parts: string[] = [];
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
  return plan;
}
