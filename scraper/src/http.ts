import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// The handbook's robots.txt disallows crawling, so every fetch is cached on disk
// and throttled: each page should only ever be requested once.
const UA = 'uts-skill-tree-research/0.1 (student planning prototype; low-rate one-off pull)';
const MIN_GAP_MS = Number(process.env.SCRAPE_GAP_MS ?? 250);

let nextSlot = 0;
let blocked: string | null = null;

/** Thrown once the server refuses us (403). Everything stops: we do not retry against a block. */
export class BlockedError extends Error {}
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function fetchText(url: string, init: RequestInit = {}, attempts = 4): Promise<string> {
  for (let i = 1; ; i++) {
    if (blocked) throw new BlockedError(blocked);
    await throttle();
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 403) {
        blocked = `blocked (HTTP 403) at ${url}; stopping all requests`;
        throw new BlockedError(blocked);
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`), { fatal: true });
      return body;
    } catch (err) {
      if (err instanceof BlockedError || (err as { fatal?: boolean }).fatal || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

/** Read from the disk cache, or run `load` on a miss and store its result. */
export async function cached(path: string, load: () => Promise<string>): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    const body = await load();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return body;
  }
}
