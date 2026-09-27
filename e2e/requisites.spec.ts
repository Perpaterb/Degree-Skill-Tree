import { expect, test } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-045: selecting a subject lights the lines from every subject its requisite rule names, even when
// the rule also offers an alternative the map cannot check (e.g. "Admission into C04143 Master of Laws").
const REQUISITES: Record<string, string[]> = {
  '76024': ['70106', '70107', '70311', '70616'], // Environmental Law: was dark
  '70317': ['70211', '70311', '70327'], // Real Property: was dark
  '77889': ['70106', '70107', '77905'], // Trade Marks Law: showed what it unlocks, not its requisites
  '70107': ['70517', '70616'], // Principles of Company Law: already worked
};

for (const [code, reqs] of Object.entries(REQUISITES)) {
  test(`US-045: selecting ${code} lights the lines from all of its requisites`, async ({ page }) => {
    await openTree(page, 't=uts-2027');
    await goTo(page, code);
    const lit = await page.evaluate(() => window.__dst!.litEdges());
    expect(reqs.filter((r) => !lit.includes(`${r}>${code}`))).toEqual([]);
  });
}
