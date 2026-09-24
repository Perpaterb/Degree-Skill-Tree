import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import { fetchAccessConditions } from './access.js';
import { BlockedError } from './http.js';
import { fetchItem, listItems, type ContentType, type ListedItem } from './handbook.js';

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

const commands: Record<string, () => Promise<unknown>> = {
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
