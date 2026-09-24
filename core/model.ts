// The institution-agnostic tree model. Importers (e.g. the UTS handbook
// adapter) write this shape; the app only ever reads this shape.

/**
 * One institution's map for one handbook year: several degrees sharing one pool of
 * programs and subjects. A subject or program offered by two degrees exists once.
 */
export interface MapDoc {
  schema: 2;
  id: string; // e.g. "uts-2027"
  institution: string;
  year: string;
  source: { name: string; url: string; fetchedAt: string };
  degrees: Record<string, Degree>;
  programs: Record<string, Program>;
  subjects: Record<string, Subject>;
  /** Precomputed positions (see core/layout.ts). Absent means the app computes them. */
  layout?: import('./layout.js').Layout;
}

export interface Degree {
  code: string;
  title: string;
  creditPoints: number;
  level: string; // "Undergraduate" / "Postgraduate"
  faculty: string;
  url: string;
  structure: Container;
  studyPlans: StudyPlan[];
}

export type ProgramKind = 'major' | 'sub_major' | 'stream' | 'other';

export interface Program {
  code: string;
  title: string;
  kind: ProgramKind;
  creditPoints: number;
  url: string;
  structure: Container;
  /** True when the degree names this program but the handbook year has no page for it. */
  legacy?: boolean;
}

/**
 * "Complete `creditPoints` from these children and items." Each child counts up
 * to its own credit points. When the options add up to exactly `creditPoints`,
 * everything is compulsory.
 */
export interface Container {
  id: string;
  title: string;
  description: string;
  creditPoints: number;
  /** "free" = any subject from the institution counts (free electives). */
  kind: 'group' | 'free';
  children: Container[];
  items: ContainerItem[];
}

export type ContainerItem = { kind: 'subject'; code: string } | { kind: 'program'; code: string };

export interface Subject {
  code: string;
  title: string;
  creditPoints: number;
  level: string;
  faculty: string;
  school: string;
  description: string; // HTML from the source
  learningOutcomes: string[]; // HTML fragments
  offerings: Offering[];
  requisite: Rule | null;
  /** The source's own wording of the rule, kept for display and audit. */
  requisiteText: string;
  antiRequisites: string[]; // subject codes
  recommended: string;
  url: string;
  /** Referenced by this tree but not published in this handbook year (retired or not yet available). */
  legacy?: boolean;
}

export interface Offering {
  session: string;
  location: string;
  mode: string;
}

export type Rule =
  | { op: 'and' | 'or'; args: Rule[] }
  | { subject: string }
  | { course: string; title: string }
  | { creditPoints: number; scope: string }
  | { text: string };

export interface StudyPlan {
  title: string;
  /** Ordered periods, e.g. "Year 1 / Autumn session", each with subject or program codes. */
  periods: { name: string; codes: string[] }[];
}
