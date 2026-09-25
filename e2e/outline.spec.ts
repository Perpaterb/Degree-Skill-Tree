import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-027: the Bachelor of IT outline in the degree panel, coloured by progress.
// Compulsory (42cp): 31265 31268 31271 31269 41092 43030 31272.
// Options (48cp), way 2 "two sub-majors": Advertising Principles SMJ08198 (24210 52662 24109 24202)
// and Innovation and Entrepreneurship SMJ10156 (81547 81529 48080 81546).
const COMPULSORY = ['31265', '31268', '31271', '31269', '41092', '43030', '31272'];
const ADV = ['24210', '52662', '24109', '24202'];
const INN = ['81547', '81529', '48080', '81546'];

async function outline(page: Page, hash: string) {
  await openTree(page, `t=uts-2027&d=C10148&${hash}`);
  await goTo(page, 'C10148');
  return page.getByTestId('detail-panel');
}
const heading = (panel: ReturnType<Page['getByTestId']>, title: string) =>
  panel.getByTestId('outline-heading').filter({ hasText: new RegExp(`^${title} \\(`) });
const way = (panel: ReturnType<Page['getByTestId']>, n: number) => panel.getByTestId('outline-way').nth(n);

test('US-027: a compulsory block is untouched, started, planned-complete, then complete', async ({ page }) => {
  let panel = await outline(page, 'c=');
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'none');

  panel = await outline(page, `c=${COMPULSORY[0]}`);
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'started');

  panel = await outline(page, `c=${COMPULSORY.slice(0, 3).join('.')}&p=${COMPULSORY.slice(3).join('.')}`);
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'planned');
  await expect(heading(panel, 'Compulsory')).toContainText('✓');

  panel = await outline(page, `c=${COMPULSORY.join('.')}`);
  const h = heading(panel, 'Compulsory');
  await expect(h).toHaveAttribute('data-status', 'complete');
  await expect(h).toContainText('✓');
  // Green, not the untouched grey.
  expect(await h.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(69, 209, 107)');
});

test('US-027 / US-022: the Options ways each get their own line, fill in as sub-majors are chosen, planned and done, and count 48/48', async ({ page }) => {
  let panel = await outline(page, 'c=');
  await expect(panel.getByTestId('outline-way')).toHaveText([/^one major \(48cp\)/, /^two sub-majors/, /^one sub-major \(24cp\) and four electives/, /^one transdisciplinary elective/]);
  for (let i = 0; i < 4; i++) await expect(way(panel, i)).toHaveAttribute('data-status', 'none');

  // Chosen, nothing done: the sub-major ways start, and the chosen sub-major line is yellow.
  panel = await outline(page, 'm=SMJ08198.SMJ10156');
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'started');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'none');
  await expect(panel.locator('[data-testid="outline-program"][data-code="SMJ08198"]').first()).toHaveAttribute('data-status', 'started');

  // One done, one planned: blue with a tick, for the way and for Options.
  panel = await outline(page, `m=SMJ08198.SMJ10156&c=${ADV.join('.')}&p=${INN.join('.')}`);
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'planned');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'planned');

  // Both done: green with a tick, and the progress panel agrees at 48/48.
  panel = await outline(page, `m=SMJ08198.SMJ10156&c=${[...ADV, ...INN].join('.')}`);
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'complete');
  await expect(way(panel, 1)).toContainText('✓');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'complete');
  await expect(panel.locator('[data-testid="outline-program"][data-code="SMJ08198"]').first()).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('progress-panel').getByRole('button', { name: /^Options\s*48\/48cp/ })).toBeVisible();
});

test('US-027 / US-022: a second completed major counts under Options, and a subject shared with the first is named', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const ID = ['31260', '31777', '31080', '41019', '31263', '31264', '41889'];
  const program = (panel: ReturnType<Page['getByTestId']>, code: string, n: number) => panel.locator(`[data-testid="outline-program"][data-code="${code}"]`).nth(n);

  // 41759 is in both majors but counts once, so Interaction Design is 6cp short and the panel says why.
  let panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID].join('.')}`);
  await expect(program(panel, 'MAJ02081', 0)).toHaveAttribute('data-status', 'complete');
  await expect(program(panel, 'MAJ02092', 1)).toHaveAttribute('data-status', 'started');
  await expect(program(panel, 'MAJ02092', 1).getByTestId('outline-shared')).toContainText('41759');
  await expect(program(panel, 'MAJ02092', 1).getByTestId('outline-shared')).toContainText('counts towards Data Analytics, not here');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'started');
  await expect(page.getByTestId('progress-total')).toHaveText('90/144cp');

  // One more Interaction Design option fills it: both majors green, Options way 1 green, 96cp in all.
  panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID, '31262'].join('.')}`);
  await expect(program(panel, 'MAJ02092', 1)).toHaveAttribute('data-status', 'complete');
  await expect(program(panel, 'MAJ02092', 1)).toContainText('✓');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'complete');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('progress-total')).toHaveText('96/144cp');
});

test('US-031: each Options way and heading shows its own done / needed credit points', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const ID = ['31260', '31777', '31080', '41019', '31263', '31264', '41889'];
  const panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID].join('.')}&p=31262`);
  // Way 1 (one major): Interaction Design is 42 done, and the planned extra option makes up the shared 6.
  await expect(way(panel, 0).getByTestId('outline-way-cp')).toHaveText('42+6/48cp');
  await expect(way(panel, 1).getByTestId('outline-way-cp')).toHaveText('0/48cp');
  await expect(heading(panel, 'Options').last().getByTestId('outline-cp')).toHaveText('(42+6/48cp)');
  await expect(heading(panel, 'Compulsory').getByTestId('outline-cp')).toHaveText('(0/42cp)');
  // The bar is drawn for each way it can read.
  await expect(way(panel, 0).locator('.bar-done')).toHaveAttribute('style', /width: 87\.5/);
});

test('US-032: a free-elective slot lists what fills it, and hovering its note lights up subjects you could take now', async ({ page }) => {
  // 31061 and 32130 are not listed anywhere in the Bachelor of IT, so they can only count as free electives.
  const panel = await outline(page, 'c=31061.32130');
  const free = panel.getByTestId('free-electives');
  await expect(free.first()).toContainText('31061');
  await expect(free.first()).toContainText('32130');
  const hint = panel.getByTestId('free-electives-hint').first();
  await expect(hint).toContainText('Any UTS subject');
  expect(await page.evaluate(() => window.__dst!.ringed().length)).toBe(0);
  await hint.hover();
  await expect.poll(() => page.evaluate(() => window.__dst!.ringed().length)).toBeGreaterThan(5);
  const n = Number((await hint.textContent())!.match(/the (\d+) subjects/)![1]);
  expect(await page.evaluate(() => window.__dst!.ringed().length)).toBe(n);
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => window.__dst!.ringed().length)).toBe(0);
});
