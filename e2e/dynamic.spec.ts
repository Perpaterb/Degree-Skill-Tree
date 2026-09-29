import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-053 to US-056: Dynamic mode.
test.slow(); // the whole 2027 map, twice over (static underneath, dynamic on top), under software GL

const bodies = (page: Page) => page.evaluate(() => window.__dyn!.bodies());
const settled = (page: Page, timeout = 60_000) =>
  expect.poll(() => page.evaluate(() => !!window.__dyn?.settled() && window.__dyn!.arriving() === 0), { timeout }).toBe(true);
/** Open a link with Dynamic mode already on (remembered in this browser). */
async function openDynamic(page: Page, hash: string) {
  await page.addInitScript(() => localStorage.setItem('dst.mode', 'dynamic'));
  // Not openTree: it waits for the static canvas, which Dynamic mode keeps hidden.
  await page.goto(`./#${hash}`);
  await expect(page.locator('.brand-sub')).toContainText('degrees', { timeout: 30_000 });
  await page.waitForFunction(() => !!window.__dyn, undefined, { timeout: 30_000 });
  await settled(page);
}

test('US-053: the switch defaults to Static, is remembered but not in the link; Dynamic opens zoomed out and centred; back to Static is like a refresh, then goes to the selection', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  await expect(page.getByTestId('mode-static')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('dynamic-canvas')).toHaveCount(0);
  const opened = await page.evaluate(() => window.__dst!.zoom());
  // Somewhere particular on the static map.
  await goTo(page, 'C10148');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('mode-dynamic').click();
  await expect(page.getByTestId('dynamic-canvas')).toBeVisible();
  await expect(page.getByTestId('tree-canvas')).toHaveClass(/hidden/);
  await page.waitForFunction(() => !!window.__dyn);
  // Zoomed all the way out, as the static map opens.
  expect(await page.evaluate(() => window.__dyn!.zoom())).toBeCloseTo(opened, 6);
  expect(page.url()).not.toMatch(/dynamic|mode/);
  await page.reload();
  await expect(page.getByTestId('mode-dynamic')).toHaveAttribute('aria-checked', 'true');
  await page.waitForFunction(() => !!window.__dyn);

  // Back to Static with nothing selected: zoomed out and centred, like a refresh.
  await page.getByTestId('mode-static').click();
  await expect(page.getByTestId('dynamic-canvas')).toHaveCount(0);
  await expect(page.getByTestId('tree-canvas')).not.toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => window.__dst!.zoom())).toBeCloseTo(opened, 6);

  // With a subject selected: the same, then off to the subject.
  await page.getByTestId('mode-dynamic').click();
  await page.waitForFunction(() => !!window.__dyn);
  await goTo(page, '31268');
  await page.getByTestId('mode-static').click();
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      const at = await page.evaluate(() => window.__dst!.pointFor('31268'));
      return !!at && Math.abs(at.x - b.width / 2) < 40 && Math.abs(at.y - b.height / 2) < 40;
    }, { timeout: 10_000 })
    .toBe(true);
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

test('US-055: choosing a degree leaves it and the camera where they are; the rest come to rest round it by faculty, without overlaps; unchoosing brings circles back gradually', async ({ page }) => {
  await openDynamic(page, 't=uts-2027');
  const all = (await bodies(page)).length;
  const camera = await page.evaluate(() => window.__dyn!.screen());
  const was = (await bodies(page)).find((b) => b.id === 'C10242')!;
  await page.getByTestId('degree-picker').selectOption('C10242');
  await page.waitForTimeout(100);
  await settled(page);
  expect(await page.evaluate(() => window.__dyn!.centre())).toBe('C10242');
  // Neither the camera nor the chosen degree moved.
  const now = await page.evaluate(() => window.__dyn!.screen());
  expect(now.scale).toBeCloseTo(camera.scale, 6);
  expect(Math.hypot(now.x - camera.x, now.y - camera.y)).toBeLessThan(1);
  const b = await bodies(page);
  const sci = b.find((x) => x.id === 'C10242')!;
  expect(Math.hypot(sci.x - was.x, sci.y - was.y)).toBeLessThan(1);
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y), `${b[i].id} / ${b[j].id}`).toBeGreaterThanOrEqual(b[i].circleR + b[j].circleR);
  // Gathered round it: the farthest circle within 3 times the radius a tight disc of them all would need.
  const far = Math.max(...b.map((x) => Math.hypot(x.x - sci.x, x.y - sci.y) + x.r));
  expect(far).toBeLessThan(3 * Math.sqrt(b.reduce((t, x) => t + x.r * x.r, 0)));

  // Unchosen: circles come back a few at a time, not all at once, then everything comes to rest.
  await page.getByTestId('unchoose-degree').click();
  await page.waitForTimeout(150);
  const early = (await bodies(page)).length;
  expect(early).toBeLessThan(all);
  await settled(page, 90_000);
  expect((await bodies(page)).length).toBe(all);
  expect(await page.evaluate(() => window.__dyn!.centre())).toBeNull();
  // A few at a time: never more than a handful in one step.
  expect(await page.evaluate(() => window.__dyn!.biggestArrival())).toBeLessThanOrEqual(4);
  // Grouped by faculty: nearly every single-faculty degree ends nearer its own faculty's spawn point than any other.
  const anchors = await page.evaluate(() => window.__dyn!.anchors());
  const faculty = await page.evaluate(() => window.__dyn!.faculties());
  const settledBodies = await bodies(page);
  let own = 0;
  let counted = 0;
  for (const d of settledBodies) {
    const fs = faculty[d.id];
    if (!fs || fs.length !== 1 || !anchors.some((a) => a.faculty === fs[0])) continue;
    counted++;
    const nearest = [...anchors].sort((p, q) => Math.hypot(p.x - d.x, p.y - d.y) - Math.hypot(q.x - d.x, q.y - d.y))[0];
    if (nearest.faculty === fs[0]) own++;
  }
  expect(counted).toBeGreaterThan(100);
  expect(own / counted).toBeGreaterThan(0.8);
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
  await expect.poll(async () => (await bodies(page)).filter((b) => offshore.includes(b.id)).length, { timeout: 90_000 }).toBe(9);
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

test('US-056: sizes first: no circle changes size once the map has started moving', async ({ page }) => {
  await openDynamic(page, 't=uts-2027');
  expect(await page.evaluate(() => window.__dyn!.lateResizes())).toBe(0);
  await page.getByTestId('degree-picker').selectOption('C10242');
  await page.waitForTimeout(100);
  await settled(page);
  await page.getByTestId('unchoose-degree').click();
  await page.waitForTimeout(100);
  await settled(page, 90_000);
  expect(await page.evaluate(() => window.__dyn!.lateResizes())).toBe(0);
});
