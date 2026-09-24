import { cached, fetchText } from './http.js';

export const HANDBOOK = 'https://coursehandbook.uts.edu.au';
const SITE_ID = 'uts-prod-pres';
const PAGE_SIZE = 100; // the search API rejects anything larger

export type ContentType = 'subject' | 'course' | 'aos';

export interface ListedItem {
  code: string;
  title: string;
  lines: string[]; // e.g. ["Subject", "Undergraduate"]
  uri: string;
}

async function searchPage(type: ContentType, year: string, from: number) {
  const body = await fetchText(`${HANDBOOK}/api/search/search-academic-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteId: SITE_ID,
      query: '',
      contenttype: type,
      searchFilters: [{ filterField: 'implementationYear', filterValue: [year], isExactMatch: false }],
      from,
      size: PAGE_SIZE,
      siteYear: year,
    }),
  });
  const json = JSON.parse(body) as { data: { results: ListedItem[]; total: number } };
  return json.data;
}

/**
 * Enumerate every published item of a content type for one handbook year.
 * Every result has the same relevance score, so deep paging is not stable
 * between requests; repeat full passes and union them until the count matches.
 */
export async function listItems(type: ContentType, year: string, maxPasses = 6): Promise<{ items: ListedItem[]; total: number }> {
  const byUri = new Map<string, ListedItem>();
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const first = await searchPage(type, year, 0);
    total = first.total;
    for (const r of first.results) byUri.set(r.uri, r);
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
      const page = await searchPage(type, year, from);
      for (const r of page.results) byUri.set(r.uri, r);
    }
    if (byUri.size >= total) break;
  }
  const items = [...byUri.values()]
    .filter((r) => r.uri.includes(`/${year}/`))
    .map((r) => ({ ...r, title: r.title.trim() }));
  return { items, total };
}

/** Pull the embedded Next.js page data out of a handbook page. */
export function extractPageContent(html: string): Record<string, unknown> {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no __NEXT_DATA__ on page');
  const data = JSON.parse(m[1]);
  const content = data?.props?.pageProps?.pageContent;
  if (!content || typeof content !== 'object') throw new Error('page has no pageContent');
  return content;
}

/** Fetch one item's page content, caching only the extracted JSON (the full HTML is ~160KB of theme). */
export async function fetchItem(rawDir: string, uri: string): Promise<Record<string, unknown>> {
  const file = `${rawDir}${uri}.json`;
  const text = await cached(file, async () => {
    const html = await fetchText(HANDBOOK + uri);
    return JSON.stringify(extractPageContent(html));
  });
  return JSON.parse(text);
}
