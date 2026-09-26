import { expect, test } from '@playwright/test';
import { chooseDegree, clickCircle, goTo, openDegreeFromChip, openTree, waitReady } from './helpers';

const glowing = (page: import('@playwright/test').Page) => page.evaluate(() => window.__dst?.glowing() ?? []);

test('US-019: the degrees share one map, and pre-map links still open with their plan', async ({ page }) => {
  await openTree(page);
  const options = await page.getByTestId('degree-picker').locator('option').allTextContents();
  expect(options).toEqual([
    'Any degree (explore)',
    'Bachelor of Business',
    'Bachelor of Computing Science',
    'Bachelor of Cybersecurity',
    'Bachelor of Information Technology',
    'Bachelor of Information Technology Bachelor of Business',
  ]);

  // A link shared before degrees were merged into one map.
  await openTree(page, 't=uts-2027-C10148&c=41039');
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10148');
  await expect(page.getByTestId('progress-total')).toHaveText('6/144cp');
});

test('US-020: clicking a program circle opens it, and clicking a degree circle opens its panel to choose it from', async ({ page }) => {
  await openTree(page);
  await goTo(page, 'MAJ03444'); // flies to the circle
  await page.getByRole('button', { name: 'Close' }).click();
  await clickCircle(page, 'MAJ03444');
  await expect(page.getByTestId('detail-panel').locator('h2')).toHaveText('Enterprise Software Development');

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('search').fill('');
  await goTo(page, 'C10476');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('degree-picker').selectOption(''); // nothing selected yet
  await clickCircle(page, 'C10476');
  await expect(page.getByTestId('detail-panel').locator('h2')).toHaveText('Bachelor of Computing Science');
  // Chosen from its panel (US-046).
  await page.getByTestId('choose-degree').click();
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10476');
});

test('US-020: hovering a circle makes it glow', async ({ page }) => {
  await openTree(page);
  await goTo(page, 'MAJ03444');
  await page.getByRole('button', { name: 'Close' }).click();
  const point = (await page.evaluate(() => window.__dst!.pointFor('MAJ03444')))!;
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.move(b.x + point.x, b.y + point.y);
  await expect.poll(() => glowing(page)).toContain('MAJ03444');
});

test('US-021: a selected degree stays selected across reloads until another is chosen or it is cleared', async ({ page }) => {
  await openTree(page);
  await chooseDegree(page, 'C10476');
  await expect(page).toHaveURL(/d=C10476/);
  await page.reload();
  await waitReady(page);
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10476');

  await chooseDegree(page, 'C10148');
  await expect(page.getByTestId('degree-chip')).toContainText('Bachelor of Information Technology');
  await page.getByTestId('degree-chip').getByRole('button', { name: 'Clear degree' }).click();
  await expect(page.getByTestId('degree-chip')).toHaveCount(0);
  await expect(page.getByTestId('degree-picker')).toHaveValue('');
});

test('US-021: choosing a major needs a degree that offers it', async ({ page }) => {
  await openTree(page);
  await goTo(page, 'MAJ03444');
  const panel = page.getByTestId('detail-panel');
  await expect(panel.getByRole('button', { name: 'Choose this major' })).toHaveCount(0);
  await panel.getByRole('button', { name: /Bachelor of Information Technology$/ }).click();
  await expect(panel.getByRole('button', { name: 'Choose this major' })).toBeVisible();
});

test('US-022: progress appears only with a degree, and hovering an outline heading glows what it names', async ({ page }) => {
  await openTree(page);
  await expect(page.getByTestId('degree-chip')).toHaveCount(0);
  await chooseDegree(page, 'C10148');
  const panel = await openDegreeFromChip(page);
  await panel.getByTestId('outline-heading').filter({ hasText: /^Major - Information Technology/ }).hover();
  await expect.poll(async () => (await glowing(page)).sort()).toEqual(['MAJ02080', 'MAJ02081', 'MAJ02092', 'MAJ03444', 'MAJ03445']);
  await page.mouse.move(5, 5);
  await expect.poll(() => glowing(page)).toEqual([]);
});

test('US-023: completed subjects grey the degrees they do not fit, and a greyed degree says what is in the way', async ({ page }) => {
  // Six compulsory Bachelor of Business subjects. Computing Science can absorb three as free electives.
  await openTree(page, 't=uts-2027&c=21212.22108.24109.25400.21214.22208');
  await page.getByTestId('degree-picker').selectOption('C10476');
  const fit = page.getByTestId('degree-fit');
  await expect(fit).toContainText('18 of your 36cp would count towards this degree');
  for (const code of ['22208', '24109', '25400']) await expect(fit).toContainText(code);
  await expect(fit).toContainText('free electives are used up');

  // The same subjects all count towards Business itself.
  await page.getByTestId('degree-picker').selectOption('C10026');
  await expect(page.getByTestId('degree-fit')).toContainText('36 of your 36cp would count');
});

test('US-023: with no degree selected, a greyed degree can still be clicked and selected', async ({ page }) => {
  await openTree(page, 't=uts-2027&c=21212.22108.24109.25400.21214.22208');
  await goTo(page, 'C10476');
  await page.getByRole('button', { name: 'Close' }).click();
  await clickCircle(page, 'C10476');
  await page.getByTestId('choose-degree').click();
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10476');
});

test('US-020: selecting a subject lights up every copy of it across the map', async ({ page }) => {
  await openTree(page);
  // Mathematics 1 is listed by eight circles.
  await goTo(page, '33130');
  const lit = await page.evaluate(() => window.__dst!.highlighted());
  expect(lit.filter((id) => id.endsWith('/33130')).length).toBeGreaterThanOrEqual(8);
  expect(lit.every((id) => id.endsWith('/33130'))).toBe(true);
});

test('US-022: completed subjects that do not count are listed under the selected degree', async ({ page }) => {
  await openTree(page, 't=uts-2027&c=21212.22108.24109.25400.21214.22208');
  await chooseDegree(page, 'C10476');
  await openDegreeFromChip(page);
  const list = page.getByTestId('not-counting');
  await expect(list).toContainText('These subjects do not count towards this degree');
  for (const code of ['22208', '24109', '25400']) await expect(list).toContainText(code);
});

test('US-020: every copy of a completed subject looks the same, entry copies and copies outside the degree included', async ({ page }) => {
  // Programming 1 has 19 copies, 14 of them entry copies, in circles inside and outside Business
  // (the 19th is in the Bachelor of IT Bachelor of Business double degree, pulled 25 Sep 2026).
  await openTree(page, 't=uts-2027&c=41039');
  await chooseDegree(page, 'C10148');
  const looks = await page.evaluate(() => window.__dst!.copies('41039').map((id) => ({ id, ...window.__dst!.look(id)! })));
  expect(looks.length).toBe(19);
  const first = { fill: looks[0].fill, ring: looks[0].ring, alpha: looks[0].alpha, scale: looks[0].scale };
  for (const l of looks) expect({ fill: l.fill, ring: l.ring, alpha: l.alpha, scale: l.scale }, l.id).toEqual(first);
  expect(first.alpha).toBe(1);
});

test('US-020: hovering one copy of a subject makes every copy pop out and glow', async ({ page }) => {
  await openTree(page);
  await goTo(page, '41039');
  await page.getByRole('button', { name: 'Close' }).click();
  const at = (await page.evaluate(() => window.__dst!.pointFor('41039')))!;
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.move(b.x + at.x, b.y + at.y);
  await expect.poll(() => page.evaluate(() => window.__dst!.highlighted().length)).toBe(19);
  const looks = await page.evaluate(() => window.__dst!.copies('41039').map((id) => window.__dst!.look(id)!));
  for (const l of looks) {
    expect(l).toMatchObject({ halo: true, alpha: 1 });
    expect(l.scale).toBeGreaterThanOrEqual(1.4);
  }
  // Other subjects stay their normal size.
  const other = await page.evaluate(() => window.__dst!.look(window.__dst!.copies('48023')[0])!);
  expect(other).toMatchObject({ halo: false, scale: 1 });
});

test('US-020: hover ends as soon as the pointer leaves the enlarged subject, not its glow', async ({ page }) => {
  await openTree(page);
  await goTo(page, '41039');
  await page.getByRole('button', { name: 'Close' }).click();
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const at = (await page.evaluate(() => window.__dst!.pointFor('41039')))!;
  await page.mouse.move(b.x + at.x, b.y + at.y);
  await expect.poll(() => page.evaluate(() => window.__dst!.highlighted().length)).toBe(19);
  // Just outside the enlarged disc, but well inside its glow (which reaches 30 units further out).
  // Every copy of the hovered subject is enlarged by the same amount.
  const { scale, zoom } = await page.evaluate(() => ({ scale: window.__dst!.look(window.__dst!.copies('41039')[0])!.scale, zoom: window.__dst!.zoom() }));
  const edge = 22 * scale * zoom;
  await page.mouse.move(b.x + at.x + edge + 4, b.y + at.y, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.__dst!.highlighted().length)).toBe(0);
});

test('US-026: a finished circle glows green, one the plan finishes glows blue, a half-done one does not', async ({ page }) => {
  // Innovation and Entrepreneurship (SMJ10156) is exactly four 6cp subjects: 81547, 81529, 48080, 81546.
  const finished = () => page.evaluate(() => window.__dst!.finished());
  await openTree(page, 't=uts-2027&c=81547.81529.48080.81546');
  await expect.poll(async () => (await finished()).SMJ10156).toBe('complete');

  await openTree(page, 't=uts-2027&c=81547.81529&p=48080.81546');
  await expect.poll(async () => (await finished()).SMJ10156).toBe('planned');

  await openTree(page, 't=uts-2027&c=81547.81529');
  await page.waitForTimeout(300);
  expect((await finished()).SMJ10156).toBeUndefined();
});

test('US-009: planned subjects are drawn purple, distinct from available ones', async ({ page }) => {
  await openTree(page, 't=uts-2027&p=41039');
  const planned = await page.evaluate(() => window.__dst!.look(window.__dst!.copies('41039')[0])!);
  expect(planned).toMatchObject({ fill: 0x33175c, ring: 0xb36bff });
  // 31265 has no prerequisites, so it is available now.
  const available = await page.evaluate(() => window.__dst!.look(window.__dst!.copies('31265')[0])!);
  expect(available.fill).not.toBe(planned.fill);
  expect(available.ring).not.toBe(planned.ring);
});
