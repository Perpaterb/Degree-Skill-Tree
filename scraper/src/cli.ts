import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import { fetchAccessConditions } from './access.js';
import { BlockedError } from './http.js';
import { fetchItem, listItems, type ContentType, type ListedItem } from './handbook.js';
import { buildMap } from './normalize.js';
import { layoutMap } from '../../core/layout.js';
import { linkQuality } from '../../core/linkQuality.js';

const YEAR = process.env.HANDBOOK_YEAR ?? '2026';
const RAW = `data/raw/${YEAR}`;
const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 4);
const TYPES: ContentType[] = ['course', 'aos', 'subject'];

async function readList(type: ContentType): Promise<ListedItem[]> {
  return JSON.parse(await readFile(`${RAW}/list-${type}.json`, 'utf8'));
}

async function list() {
  await mkdir(RAW, { recursive: true });
  for (const type of TYPES) {
    const { items, total } = await listItems(type, YEAR);
    await writeFile(`${RAW}/list-${type}.json`, JSON.stringify(items, null, 1));
    const note = items.length === total ? '' : `  (search reported ${total}: MISMATCH)`;
    console.log(`${type}: ${items.length} items${note}`);
  }
}

async function runAll<T>(label: string, things: T[], fn: (t: T) => Promise<unknown>) {
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let stopped = false;
  const failures: { thing: T; error: string }[] = [];
  await Promise.all(
    things.map((t) =>
      limit(async () => {
        if (stopped) return;
        try {
          await fn(t);
        } catch (e) {
          if (e instanceof BlockedError) {
            if (!stopped) console.error(e.message);
            stopped = true;
          }
          failures.push({ thing: t, error: String((e as Error).message ?? e) });
        }
        if (++done % 100 === 0 || done === things.length) console.log(`${label}: ${done}/${things.length}`);
      }),
    ),
  );
  if (failures.length) {
    await writeFile(`${RAW}/failures-${label}.json`, JSON.stringify(failures, null, 1));
    console.log(`${label}: ${failures.length} failures written to ${RAW}/failures-${label}.json`);
  }
  if (failures.some((f) => f.error.startsWith('blocked'))) {
    console.error('Server is refusing requests. Stopped. Re-run later: cached pages are not re-fetched.');
    process.exit(2);
  }
  return failures;
}

async function pages() {
  for (const type of TYPES) {
    const items = await readList(type);
    await runAll(`pages-${type}`, items, (it) => fetchItem(RAW, it.uri));
  }
}

async function access() {
  const subjects = await readList('subject');
  await runAll('access', subjects, (s) => fetchAccessConditions(RAW, s.code));
}

type Json = Record<string, unknown>;

/** Collect every academic item referenced anywhere inside a curriculum structure. */
export function structureRefs(node: unknown, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(node)) node.forEach((n) => structureRefs(n, out));
  else if (node && typeof node === 'object') {
    const n = node as Json;
    const type = (n.academic_item_type as Json | undefined)?.value;
    if (typeof n.academic_item_code === 'string' && typeof type === 'string') out.set(n.academic_item_code, type);
    for (const v of Object.values(n)) if (v && typeof v === 'object') structureRefs(v, out);
  }
  return out;
}

/**
 * Pull one course and everything it reaches: areas of study (recursively),
 * their subjects, those subjects' requisites, and one hop of requisite subjects.
 * Deliberately slow and sequential: see scraper/src/http.ts.
 */
async function slice() {
  const courses = process.argv.slice(3);
  if (!courses.length) throw new Error('usage: npm run scrape -- slice <COURSE_CODE>...');
  const seen = new Set<string>();
  const subjects = new Set<string>();
  const missing: string[] = [];
  const queue: { kind: string; code: string }[] = courses.map((code) => ({ kind: 'course', code }));

  while (queue.length) {
    const { kind, code } = queue.shift()!;
    const key = `${kind}/${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === 'subject') {
      subjects.add(code);
      continue;
    }
    let content: Json;
    try {
      content = await fetchItem(RAW, `/${kind}/${YEAR}/${code}`);
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      missing.push(`${key}: ${(e as Error).message}`);
      continue;
    }
    console.log(`${key}: ${String(content.title)}`);
    for (const [ref, type] of structureRefs(content.curriculumStructure)) {
      queue.push({ kind: type === 'subject' ? 'subject' : 'aos', code: ref });
    }
  }

  const fetchSubject = async (code: string) => {
    await fetchItem(RAW, `/subject/${YEAR}/${code}`);
    return fetchAccessConditions(RAW, code);
  };
  const inScope = [...subjects];
  console.log(`${inScope.length} subjects in scope`);
  await runAll(`slice-${courses.join('+')}-subjects`, inScope, fetchSubject);

  // One hop out: subjects named in requisites that the course structure does not list.
  const hop = new Set<string>();
  for (const code of inScope) {
    const ac = await fetchAccessConditions(RAW, code).catch(() => null);
    for (const item of ac?.requisites?.items ?? []) if (item.kind === 'subject' && !subjects.has(item.code)) hop.add(item.code);
  }
  console.log(`${hop.size} extra requisite subjects`);
  await runAll(`slice-${courses.join('+')}-requisites`, [...hop], fetchSubject);

  const manifest = { year: YEAR, courses, items: [...seen].sort(), requisiteSubjects: [...hop].sort(), missing };
  await writeFile(`${RAW}/slice-${courses.join('+')}.json`, JSON.stringify(manifest, null, 1));
  console.log(`done. ${missing.length} missing (see manifest)`);
}

/** Summarise what a slice holds: in scope, fetched, failed. Exits non-zero if anything in scope is missing. */
async function report() {
  const name = process.argv[3];
  if (!name) throw new Error('usage: npm run scrape -- report <COURSE_CODE>');
  const m = JSON.parse(await readFile(`${RAW}/slice-${name}.json`, 'utf8')) as {
    items: string[];
    requisiteSubjects: string[];
    missing: string[];
  };
  const failed = async (label: string): Promise<{ thing: string; error: string }[]> =>
    JSON.parse(await readFile(`${RAW}/failures-${label}.json`, 'utf8').catch(() => '[]'));
  const byKind = (k: string) => m.items.filter((i) => i.startsWith(`${k}/`)).length;
  const subjectFailures = await failed(`slice-${name}-subjects`);
  const hopFailures = await failed(`slice-${name}-requisites`);
  const summary = {
    year: YEAR,
    course: name,
    inScope: { courses: byKind('course'), areasOfStudy: byKind('aos'), subjects: byKind('subject') },
    requisiteOnlySubjects: m.requisiteSubjects.length,
    failed: {
      coursesOrAreas: m.missing,
      subjects: subjectFailures.map((f) => `${f.thing}: ${f.error.slice(0, 60)}`),
      requisiteSubjects: hopFailures.map((f) => `${f.thing}: ${f.error.slice(0, 60)}`),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  await mkdir('data/reports', { recursive: true });
  await writeFile(`data/reports/coverage-${YEAR}-${name}.json`, JSON.stringify(summary, null, 2) + '\n');
  const failures = m.missing.length + subjectFailures.length;
  if (failures) process.exitCode = 1;
}

const TREES = 'web/public/trees';
/** Normalise pulled degrees into one map (plus its precomputed layout) that the app reads. */
async function normalize() {
  // `--all`: every course in the year's listing (US-043); otherwise the codes given.
  const codes = process.argv[3] === '--all' ? (await readList('course')).map((c) => c.code).sort() : process.argv.slice(3);
  if (!codes.length) throw new Error('usage: npm run scrape -- normalize <COURSE_CODE>... | --all');
  // Faculty colours (US-041): data/faculty-colours/<institution>.json, found by docs/FacultyColours.md.
  const colours = JSON.parse(await readFile('data/faculty-colours/uts.json', 'utf8'));
  const map = await buildMap(RAW, YEAR, codes, colours);
  for (const d of Object.values(map.degrees))
    for (const p of d.titleParts ?? []) if (!p.colour && !colours.uncoloured?.[p.faculty]) console.warn(`no faculty colour for ${d.code} "${p.text}" (faculty "${p.faculty}")`);
  const started = Date.now();
  map.layout = layoutMap(map);
  const copies = Object.keys(map.layout.nodes).length;
  const entries = Object.values(map.layout.nodes).filter((n) => n.entry).length;
  await mkdir(TREES, { recursive: true });
  await writeFile(`${TREES}/${map.id}.json`, JSON.stringify(map) + '\n');
  const index = [{ id: map.id, institution: map.institution, year: YEAR, degrees: codes.map((c) => ({ code: c, title: map.degrees[c].title })) }];
  await writeFile(`${TREES}/index.json`, JSON.stringify(index, null, 1) + '\n');
  const legacy = Object.values(map.subjects).filter((s) => s.legacy).length;
  const q = linkQuality(map.layout);
  console.log(
    `links: ${q.crossings} crossings (${q.shallowCrossings} under 45°, median ${q.medianCrossingAngle.toFixed(1)}°), ${q.runningTogether} pairs running together, ${q.throughSubjects} passing over a subject`,
  );
  console.log(
    `${map.id}: ${codes.length} degrees, ${Object.keys(map.programs).length} programs, ${Object.keys(map.subjects).length} subjects (${legacy} legacy); layout ${Date.now() - started}ms, ${copies} subject copies (${entries} entry), ${map.layout.edges.length} links`,
  );
}

const commands: Record<string, () => Promise<unknown>> = {
  slice,
  normalize,
  report,
  list,
  pages,
  access,
  all: async () => {
    await list();
    await pages();
    await access();
  },
};

const cmd = process.argv[2] ?? 'all';
if (!commands[cmd]) {
  console.error(`usage: npm run scrape -- <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
await commands[cmd]();
