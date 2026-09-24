import { expect, test } from '@playwright/test';
import { chooseDegree, clickCircle, goTo, openTree, waitReady } from './helpers';

const glowing = (page: import('@playwright/test').Page) => page.evaluate(() => window.__dst?.glowing() ?? []);

test('US-019: four degrees share one map, and pre-map links still open with their plan', async ({ page }) => {
  await openTree(page);
  const options = await page.getByTestId('degree-picker').locator('option').allTextContents();
  expect(options).toEqual([
    'Any degree (explore)',
    'Bachelor of Business',
    'Bachelor of Computing Science',
    'Bachelor of Cybersecurity',
    'Bachelor of Information Technology',
  ]);

  // A link shared before degrees were merged into one map.
  await openTree(page, 't=uts-2027-C10148&c=41039');
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10148');
  await expect(page.getByTestId('progress-total')).toHaveText('6/144cp');
});

test('US-020: clicking a program circle opens it, and clicking a degree circle selects the degree', async ({ page }) => {
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
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10476');
  await expect(page.getByTestId('progress-panel')).toContainText('Bachelor of Computing Science');
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
  await expect(page.getByTestId('progress-panel')).toContainText('Bachelor of Information Technology');
  await page.getByTestId('progress-panel').getByRole('button', { name: 'Clear degree' }).click();
  await expect(page.getByTestId('progress-panel')).toHaveCount(0);
  await expect(page.getByTestId('degree-picker')).toHaveValue('');
});

test('US-021: choosing a major needs a degree that offers it', async ({ page }) => {
  await openTree(page);
  await goTo(page, 'MAJ03444');
  const panel = page.getByTestId('detail-panel');
  await expect(panel.getByRole('button', { name: 'Choose this major' })).toHaveCount(0);
  await panel.getByRole('button', { name: /Bachelor of Information Technology/ }).click();
  await expect(panel.getByRole('button', { name: 'Choose this major' })).toBeVisible();
});

test('US-022: the progress panel appears only with a degree, and hovering a row glows what it names', async ({ page }) => {
  await openTree(page);
  await expect(page.getByTestId('progress-panel')).toHaveCount(0);
  await chooseDegree(page, 'C10148');
  await page.getByTestId('progress-panel').getByText('Major - Information Technology').hover();
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
  const list = page.getByTestId('not-counting');
  await expect(list).toContainText('These subjects do not count towards this degree');
  for (const code of ['22208', '24109', '25400']) await expect(list).toContainText(code);
});
