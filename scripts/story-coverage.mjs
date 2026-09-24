#!/usr/bin/env node
// Which user stories have at least one E2E test? Reads story IDs from docs/UserStories.md
// and test names ("US-###: ...") from e2e/*.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';

const stories = [...readFileSync('docs/UserStories.md', 'utf8').matchAll(/^### (US-\d{3}) (.+)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
const tests = new Map();
for (const f of readdirSync('e2e').filter((f) => f.endsWith('.spec.ts'))) {
  for (const m of readFileSync(`e2e/${f}`, 'utf8').matchAll(/test\(\s*['"`](US-\d{3}):/g)) tests.set(m[1], (tests.get(m[1]) ?? 0) + 1);
}
let covered = 0;
for (const s of stories) {
  const n = tests.get(s.id) ?? 0;
  if (n) covered++;
  console.log(`${n ? '✓' : '·'} ${s.id} ${s.title}${n ? ` (${n} test${n > 1 ? 's' : ''})` : ''}`);
}
console.log(`\n${covered}/${stories.length} stories have an E2E test (${Math.round((covered / stories.length) * 100)}%)`);
