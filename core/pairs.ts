import { programsUnder, subjectsUnder, type Lock, type Plan } from './engine.js';
import { awayArea } from './layout.js';
import type { Container, ContainerItem, Degree, MapDoc } from './model.js';

// Double degrees from two halves (US-048, US-049). A double degree's title names its parts; each part
// is either a stand-alone degree on the map with that title, or an add-on half: a degree studied only
// as part of doubles, found as the double's top-level section named after it. Whatever a double adds
// beyond its halves is grouped inside the half it belongs to. Institution-agnostic: it reads only
// titles, title parts, structures and faculties. Deterministic.

const squash = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The top-level section of a double's structure named after one of its parts. */
function sectionFor(d: Degree, part: string): Container | null {
  const p = squash(part);
  return d.structure.children.find((c) => {
    const t = squash(c.title);
    return t && (t === p || t.includes(p) || p.includes(t));
  }) ?? null;
}

/** Items listed directly in a container and its groups, not inside the programs it names. */
function directItems(c: Container, out: ContainerItem[] = []): ContainerItem[] {
  out.push(...c.items);
  for (const ch of c.children) directItems(ch, out);
  return out;
}

const signature = (map: MapDoc, c: Container) =>
  `${c.creditPoints}|${[...subjectsUnder(map, c)].sort().join(',')}|${[...programsUnder(map, c)].sort().join(',')}`;

/** Give a copied container, and every group in it, ids of its own (progress is keyed by container id). */
function reId(c: Container, id: string): Container {
  c.id = id;
  c.children.forEach((ch, i) => reId(ch, `${id}/${i}`));
  return c;
}

/** Code of the add-on half for a part title. */
export const addOnCode = (title: string) => `A-${slug(title)}`;

/**
 * Add halves to the map's double degrees, an entry per add-on half, and the groups of what each double
 * adds to its halves. Returns the same map, changed.
 */
export function pairDegrees(map: MapDoc): MapDoc {
  const degrees = Object.values(map.degrees).sort((a, b) => a.code.localeCompare(b.code));
  const combined = degrees.filter((d) => (d.titleParts?.length ?? 0) === 2);
  // Stand-alone degrees by title; where two share a title, the one taught at home (e.g. Master of
  // Engineering Management in Sydney, not its Shanghai twin).
  const single = new Map<string, Degree>();
  for (const d of degrees) {
    if ((d.titleParts?.length ?? 0) > 1) continue;
    const had = single.get(d.title);
    if (!had || (awayArea(map, had.code) && !awayArea(map, d.code))) single.set(d.title, d);
  }

  // Each double's halves: a stand-alone degree, or an add-on half when its section can be found.
  const addOnSections = new Map<string, { title: string; faculty: string; colour: string | null; level: string; sections: [string, Container][] }>();
  const halvesOf = new Map<string, [string, string]>();
  for (const d of combined) {
    const halves = d.titleParts!.map((p) => {
      const s = single.get(p.text);
      if (s) return s.code;
      const sec = sectionFor(d, p.text);
      if (!sec) return null;
      const code = addOnCode(p.text);
      const a = addOnSections.get(code) ?? { title: p.text, faculty: p.faculty, colour: p.colour, level: d.level, sections: [] };
      a.sections.push([d.code, sec]);
      addOnSections.set(code, a);
      return code;
    });
    if (halves[0] && halves[1] && halves[0] !== halves[1]) halvesOf.set(d.code, [halves[0], halves[1]]);
  }

  // Add-on halves: the section most of their doubles share; the others' differences become groups.
  for (const [code, a] of addOnSections) {
    const doubles = a.sections.filter(([c]) => halvesOf.has(c));
    if (!doubles.length) continue;
    const count = new Map<string, number>();
    for (const [, sec] of doubles) count.set(signature(map, sec), (count.get(signature(map, sec)) ?? 0) + 1);
    const base = doubles.find(([, sec]) => signature(map, sec) === [...count].sort((x, y) => y[1] - x[1])[0][0])![1];
    map.degrees[code] = {
      code,
      title: a.title,
      creditPoints: base.creditPoints,
      level: a.level,
      faculty: a.faculty,
      url: map.degrees[doubles[0][0]].url,
      structure: reId({ ...structuredClone(base), title: a.title }, `${code}-structure`),
      studyPlans: [],
      titleParts: [{ text: a.title, faculty: a.faculty, colour: a.colour }],
      addOn: { combined: doubles.map(([c]) => c) },
    };
  }

  // What each double adds to each half. An item several doubles add to one half is listed once, in a
  // group for exactly those doubles, so the layout nests it in that half rather than between circles.
  const adds = new Map<string, Map<string, { item: ContainerItem; combined: Set<string> }>>();
  for (const [dc, halves] of halvesOf) {
    const d = map.degrees[dc];
    d.halves = halves;
    const has = halves.map((h) => ({
      subjects: subjectsUnder(map, map.degrees[h].structure),
      programs: programsUnder(map, map.degrees[h].structure),
    }));
    const known = (i: ContainerItem) =>
      has.some((h) => (i.kind === 'subject' ? h.subjects.has(i.code) : h.programs.has(i.code))) ||
      (i.kind === 'subject' ? !map.subjects[i.code] : !map.programs[i.code]);
    const sections = d.titleParts!.map((p) => sectionFor(d, p.text));
    const extra: ContainerItem[][] = [[], [], []];
    const add = (k: number, i: ContainerItem) => {
      if (!known(i) && !extra.some((e) => e.some((x) => x.kind === i.kind && x.code === i.code))) extra[k].push(i);
    };
    if (sections[0] && sections[1] && sections[0] !== sections[1]) {
      sections.forEach((sec, k) => directItems(sec!).forEach((i) => add(k, i)));
      // Anything outside both sections: left for the faculty rule below.
      for (const top of d.structure.children.filter((c) => c !== sections[0] && c !== sections[1])) directItems(top).forEach((i) => add(2, i));
      d.structure.items.forEach((i) => add(2, i));
    } else directItems(d.structure).forEach((i) => add(2, i));
    // Unsplit doubles: each item goes to the half whose faculty teaches most of its subjects.
    for (const i of extra[2]) {
      const subjects = i.kind === 'subject' ? [i.code] : [...subjectsUnder(map, map.programs[i.code].structure)];
      const votes = d.titleParts!.map((p) => subjects.filter((s) => map.subjects[s]?.faculty === p.faculty).length);
      extra[votes[1] > votes[0] ? 1 : 0].push(i);
    }
    halves.forEach((h, k) => {
      const byItem = adds.get(h) ?? adds.set(h, new Map()).get(h)!;
      for (const i of extra[k]) {
        const key = `${i.kind}:${i.code}`;
        (byItem.get(key) ?? byItem.set(key, { item: i, combined: new Set() }).get(key)!).combined.add(dc);
      }
    });
  }
  for (const [h, byItem] of [...adds].sort((a, b) => a[0].localeCompare(b[0]))) {
    const groups = new Map<string, ContainerItem[]>();
    for (const { item, combined: cs } of byItem.values()) {
      const key = [...cs].sort().join('+');
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const cs = key.split('+');
      const partners = cs.map((c) => halvesOf.get(c)!.find((x) => x !== h)!);
      const title = `With ${partners.map((p) => map.degrees[p].title).join(' or ')}`;
      const code = `X-${h}-${cs.join('-')}`;
      map.programs[code] = {
        code,
        title,
        kind: 'other',
        creditPoints: 0,
        url: map.degrees[cs[0]].url,
        structure: { id: `${code}-structure`, title, description: '', creditPoints: 0, kind: 'group', children: [], items },
        onlyWith: { combined: cs, half: h, partners },
      };
      map.degrees[h].extras = [...(map.degrees[h].extras ?? []), code];
    }
  }
  return map;
}

/** The degrees chosen in a plan: a double's two halves, or the one degree. */
export function chosenDegrees(map: MapDoc, degree: string | null): string[] {
  if (!degree || !map.degrees[degree]) return [];
  return map.degrees[degree].halves ?? [degree];
}

/** The double degree two halves make, or null when they do not pair. */
export function combinedOf(map: MapDoc, a: string, b: string): string | null {
  for (const d of Object.values(map.degrees)) {
    const h = d.halves;
    if (h && ((h[0] === a && h[1] === b) || (h[0] === b && h[1] === a))) return d.code;
  }
  return null;
}

/** The degrees that pair with a degree, each with the double they make. */
export function partnersOf(map: MapDoc, code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of Object.values(map.degrees)) {
    const h = d.halves;
    if (h?.[0] === code) out.set(h[1], d.code);
    else if (h?.[1] === code) out.set(h[0], d.code);
  }
  return out;
}

const undergraduate = (map: MapDoc, code: string) => /undergrad/i.test(map.degrees[code]?.level ?? '');
const names = (map: MapDoc, codes: string[]) => codes.map((c) => map.degrees[c]?.title ?? c).join(', ');

/**
 * Degrees that cannot be chosen with the current choice, and why (US-047, US-049). With an
 * undergraduate degree chosen, other undergraduate degrees lock unless they pair with it; with a
 * double chosen, every other undergraduate degree locks. Postgraduate courses never lock. An add-on
 * half is locked until a degree it pairs with is chosen. Doubles built from halves have no circle and
 * are not listed.
 */
export function degreeLocks(map: MapDoc, degree: string | null): Map<string, string> {
  const locks = new Map<string, string>();
  const chosen = chosenDegrees(map, degree);
  const d = degree ? map.degrees[degree] : null;
  const partners = d && !d.halves ? partnersOf(map, d.code) : new Map<string, string>();
  for (const x of Object.values(map.degrees)) {
    if (x.halves || chosen.includes(x.code)) continue;
    if (x.addOn) {
      if (partners.has(x.code)) continue;
      const pairs = [...partnersOf(map, x.code).keys()];
      locks.set(
        x.code,
        d?.halves
          ? `Only as part of a double degree, and ${d.title} is already a double degree.`
          : d
            ? `Only as part of a double degree, and it does not pair with ${d.title}. It pairs with: ${names(map, pairs)}.`
            : `Only as part of a double degree. Choose a degree it pairs with first: ${names(map, pairs)}.`,
      );
      continue;
    }
    if (!d || !undergraduate(map, x.code) || !undergraduate(map, d.halves ? d.halves[0] : d.code)) continue;
    if (d.halves) locks.set(x.code, `${d.title} is chosen, and a double degree cannot take a third degree.`);
    else if (!partners.has(x.code)) locks.set(x.code, `Does not combine with ${d.title}: there is no double degree of the two.`);
  }
  return locks;
}

/**
 * Programs locked because they belong to a double degree that is not the one chosen (US-048): the
 * groups of what doubles add to a half, and what they hold. Also programs chosen under one half that
 * the chosen double does not offer.
 */
export function pairingLocks(map: MapDoc, plan: Plan): Map<string, Lock> {
  const locks = new Map<string, Lock>();
  // A program some stand-alone degree also offers is not the double's alone: it never locks here.
  const alone = new Set<string>();
  for (const d of Object.values(map.degrees)) if (!d.halves) for (const c of programsUnder(map, d.structure)) alone.add(c);
  const allowed = new Map<string, Set<string>>();
  for (const p of Object.values(map.programs)) {
    if (!p.onlyWith) continue;
    for (const code of [p.code, ...programsUnder(map, p.structure)]) {
      if (alone.has(code)) continue;
      const set = allowed.get(code) ?? allowed.set(code, new Set()).get(code)!;
      p.onlyWith.combined.forEach((c) => set.add(c));
    }
  }
  for (const [code, combined] of allowed) {
    if (plan.degree && combined.has(plan.degree)) continue;
    locks.set(code, {
      why: 'pairing',
      text: `Only in the double degree${combined.size > 1 ? 's' : ''} ${names(map, [...combined].sort())}. Choose both of its degrees to use it.`,
      blockers: [],
    });
  }
  const d = plan.degree ? map.degrees[plan.degree] : null;
  if (d?.halves) {
    const offered = programsUnder(map, d.structure);
    for (const code of plan.programs) {
      if (offered.has(code) || locks.has(code)) continue;
      const from = d.halves.find((h) => programsUnder(map, map.degrees[h].structure).has(code));
      if (from) locks.set(code, { why: 'pairing', text: `Not part of ${d.title}: only ${map.degrees[from].title} on its own offers it.`, blockers: [] });
    }
  }
  return locks;
}
