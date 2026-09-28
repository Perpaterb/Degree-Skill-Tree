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

test('US-055: choosing a degree leaves it and the camera where they are, the rest settle round it within 5 s with no overlaps; unchoosing brings circles back', async ({ page }) => {
  await openDynamic(page, 't=uts-2027');
  const all = (await bodies(page)).length;
  const camera = await page.evaluate(() => window.__dyn!.screen());
  const was = (await bodies(page)).find((b) => b.id === 'C10242')!;
  await page.getByTestId('degree-picker').selectOption('C10242');
  const t0 = Date.now();
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.__dyn!.settled()), { timeout: 5_000 }).toBe(true);
  expect(Date.now() - t0).toBeLessThan(5_000);
  expect(await page.evaluate(() => window.__dyn!.centre())).toBe('C10242');
  // Neither the camera nor the chosen degree moved.
  const now = await page.evaluate(() => window.__dyn!.screen());
  expect(now.scale).toBeCloseTo(camera.scale, 6);
  expect(Math.hypot(now.x - camera.x, now.y - camera.y)).toBeLessThan(1);
  const b = await bodies(page);
  const sci = b.find((x) => x.id === 'C10242')!;
  expect(Math.hypot(sci.x - was.x, sci.y - was.y)).toBeLessThan(1);
  // Everything else gathered round it, without overlapping.
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y), `${b[i].id} / ${b[j].id}`).toBeGreaterThanOrEqual(b[i].circleR + b[j].circleR);
  const nearest = [...b].sort((p, q) => Math.hypot(p.x - sci.x, p.y - sci.y) - Math.hypot(q.x - sci.x, q.y - sci.y));
  expect(nearest[0].id).toBe('C10242');

  await page.getByTestId('unchoose-degree').click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 15_000 }).toBe(all);
  expect(await page.evaluate(() => window.__dyn!.centre())).toBeNull();
});

test('US-054: offshore circles come in last, to the right of everything else, in their own cluster', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dst.mode', 'dynamic'));
  await page.goto('./#t=uts-2027');
  await expect(page.locator('.brand-sub')).toContainText('degrees', { timeout: 30_000 });
  await page.waitForFunction(() => !!window.__dyn, undefined, { timeout: 30_000 });
  const offshore = ['C04283', 'C04308', 'C04426', 'C10226', 'C11256', 'C11266', 'C11334', 'C10487', 'C10488'];
  // Not there while the rest are still settling.
  const early = (await bodies(page)).map((b) => b.id);
  if (!(await page.evaluate(() => window.__dyn!.settled()))) expect(early.filter((id) => offshore.includes(id))).toEqual([]);
  await expect.poll(async () => (await bodies(page)).filter((b) => offshore.includes(b.id)).length, { timeout: 20_000 }).toBe(9);
  await settled(page);
  const b = await bodies(page);
  const main = b.filter((x) => !offshore.includes(x.id));
  const off = b.filter((x) => offshore.includes(x.id));
  const mainRight = Math.max(...main.map((x) => x.x + x.circleR));
  for (const o of off) expect(o.x - o.circleR, o.id).toBeGreaterThan(mainRight);
  // Each location's courses stay together: China's all left of Vietnam's.
  const china = off.filter((x) => !['C10487', 'C10488'].includes(x.id));
  const vietnam = off.filter((x) => ['C10487', 'C10488'].includes(x.id));
  expect(Math.max(...china.map((x) => x.x))).toBeLessThan(Math.min(...vietnam.map((x) => x.x)));
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
