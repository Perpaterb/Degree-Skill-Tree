import type { Degree, TitlePart } from '../../core/model.js';

/** One university's faculty colours and the rules matching a handbook faculty to them (US-041). */
export interface FacultyColours {
  institution: string;
  method: string;
  retrieved: string;
  source: string;
  colours: Record<string, { name: string; officialName: string | null; hex: string; hexFrom: 'published' | 'sampled' }>;
  rules: { faculty: string; title?: string; colour: string }[];
  /** Faculties known to have no colour, with why (their degrees get the neutral colour). */
  uncoloured?: Record<string, string>;
}

/**
 * Split a double degree's title into its component degrees: "Bachelor of Information Technology
 * Bachelor of Business" -> two parts. A single degree gives one part.
 */
export function splitTitle(title: string): string[] {
  const starts = [...title.matchAll(/\b(?:Bachelor|Master|Diploma|Graduate Diploma|Graduate Certificate|Associate Degree|Doctor)\s+(?:of|in)\b/g)].map((m) => m.index!);
  // "Graduate Diploma in" also matches "Diploma in" inside it; keep only starts not inside another.
  const cuts = starts.filter((s, i) => i === 0 || s > starts[i - 1] + 9);
  if (cuts.length < 2 || cuts[0] !== 0) return [title];
  return cuts.map((s, i) => title.slice(s, cuts[i + 1]).trim());
}

/** The colour key for one component degree, or null when no rule matches. */
export function colourFor(table: FacultyColours, faculty: string, titlePart: string): string | null {
  for (const r of table.rules) {
    if (!new RegExp(r.faculty, 'i').test(faculty)) continue;
    if (r.title && !new RegExp(r.title, 'i').test(titlePart)) continue;
    return table.colours[r.colour] ? r.colour : null;
  }
  return null;
}

/**
 * Each part of a degree's title with its faculty and colour (US-039, US-040). A double degree lists
 * its faculties in title order; when the counts do not match (e.g. a research degree listing the
 * Graduate Research School beside its faculty), the whole title takes the first faculty's colour.
 */
export function titleParts(table: FacultyColours | null, degree: Pick<Degree, 'title'> & { faculties: string[] }): TitlePart[] {
  const { faculties } = degree;
  let parts = splitTitle(degree.title);
  let facs = parts.map((_, i) => (faculties.length === parts.length ? faculties[i] : faculties.length === 1 ? faculties[0] : undefined));
  if (facs.some((f) => f === undefined)) {
    parts = [degree.title];
    facs = [faculties[0] ?? ''];
  }
  return parts.map((text, i) => {
    const key = table ? colourFor(table, facs[i]!, text) : null;
    return { text, faculty: facs[i]!, colour: key ? table!.colours[key].hex : null };
  });
}
