import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-053 to US-056: Dynamic mode.
test.slow(); // the whole 2027 map, twice over (static underneath, dynamic on top), under software GL

const bodies = (page: Page) => page.evaluate(() => window.__dyn!.bodies());
const settled = (page: Page) => expect.poll(() => page.evaluate(() => !!window.__dyn?.settled()), { timeout: 20_000 }).toBe(true);
/** Open a link with Dynamic mode already on (remembered in this browser). */
async function openDynamic(page: Page, hash: string) {
  await page.addInitScript(() => localStorage.setItem('dst.mode', 'dynamic'));
  // Not openTree: it waits for the static canvas, which Dynamic mode keeps hidden.
  await page.goto(`./#${hash}`);
  await expect(page.locator('.brand-sub')).toContainText('degrees', { timeout: 30_000 });
  await page.waitForFunction(() => !!window.__dyn, undefined, { timeout: 30_000 });
  await settled(page);
}

test('US-053: the switch defaults to Static, turns Dynamic on and off, is remembered but not in the link, and Static comes back as it was', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  await expect(page.getByTestId('mode-static')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('dynamic-canvas')).toHaveCount(0);
  // Somewhere particular on the static map.
  await goTo(page, 'C10148');
  await page.getByRole('button', { name: 'Close' }).click();
  const before = await page.evaluate(() => ({ zoom: window.__dst!.zoom(), at: window.__dst!.pointFor('C10148') }));

  await page.getByTestId('mode-dynamic').click();
  await expect(page.getByTestId('dynamic-canvas')).toBeVisible();
  await expect(page.getByTestId('tree-canvas')).toHaveClass(/hidden/);
  expect(page.url()).not.toMatch(/dynamic|mode/);
  await page.reload();
  await expect(page.getByTestId('mode-dynamic')).toHaveAttribute('aria-checked', 'true');
  await page.waitForFunction(() => !!window.__dyn);

  // Moving about in Dynamic mode does not move the static map's camera.
  await page.getByTestId('mode-static').click();
  await goTo(page, 'C10148');
  await page.getByRole('button', { name: 'Close' }).click();
  const at = await page.evaluate(() => ({ zoom: window.__dst!.zoom(), at: window.__dst!.pointFor('C10148') }));
  await page.getByTestId('mode-dynamic').click();
  await page.waitForFunction(() => !!window.__dyn);
  await goTo(page, 'C10476');
  await page.getByTestId('mode-static').click();
  await expect(page.getByTestId('dynamic-canvas')).toHaveCount(0);
  await expect(page.getByTestId('tree-canvas')).not.toHaveClass(/hidden/);
  expect(await page.evaluate(() => ({ zoom: window.__dst!.zoom(), at: window.__dst!.pointFor('C10148') }))).toEqual(at);
  expect(before.zoom).toBeGreaterThan(0);
});

test('US-054: with the Bachelor of Science chosen, no locked degree is shown and its partners are', async ({ page }) => {
  await openDynamic(page, 't=uts-2027&d=C10242');
  const ids = (await bodies(page)).map((b) => b.id);
  expect(ids).toContain('C10242');
  expect(ids).toContain('C10026'); // Business, a partner
  expect(ids).not.toContain('C10148'); // IT, locked
  expect(ids).not.toContain('C04295'); // a master's, locked
  expect(ids).toHaveLength(114);
});

test('US-055: choosing a degree settles within 5 s with no overlaps and it at the centre; unchoosing brings circles back', async ({ page }) => {
  await openDynamic(page, 't=uts-2027');
  const all = (await bodies(page)).length;
  await page.getByTestId('degree-picker').selectOption('C10242');
  const t0 = Date.now();
  await expect.poll(() => page.evaluate(() => window.__dyn!.settled()), { timeout: 5_000 }).toBe(true);
  expect(Date.now() - t0).toBeLessThan(5_000);
  const b = await bodies(page);
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y), `${b[i].id} / ${b[j].id}`).toBeGreaterThanOrEqual(b[i].circleR + b[j].circleR);
  const nearest = [...b].sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y))[0];
  expect(nearest.id).toBe('C10242');
  expect(await page.evaluate(() => window.__dyn!.centre())).toBe('C10242');

  await page.getByTestId('unchoose-degree').click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 10_000 }).toBe(all);
  expect(await page.evaluate(() => window.__dyn!.centre())).toBeNull();
});

test('US-056: choosing two majors makes the degree\'s circle smaller in Dynamic mode, and unchoosing one makes it grow again', async ({ page }) => {
  const radius = async () => (await bodies(page)).find((b) => b.id === 'C10148')!.circleR;
  await openDynamic(page, 't=uts-2027&d=C10148');
  const whole = await radius();
  // Data Analytics and Interaction Design: no room left for any other major or sub-major (US-037).
  await openDynamic(page, 't=uts-2027&d=C10148&m=MAJ02081.MAJ02092');
  await expect.poll(radius, { timeout: 15_000 }).toBeLessThan(whole);
  const small = await radius();

  await goTo(page, 'MAJ02092');
  await page.getByTestId('detail-panel').getByRole('button', { name: /Chosen/ }).click();
  await expect.poll(radius, { timeout: 15_000 }).toBeGreaterThan(small);
});
