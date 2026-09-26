import { expect, test, type Page } from '@playwright/test';
import { openTree } from './helpers';

// US-044: titles never pile up on the zoomed-out map.
const titles = (page: Page) => page.evaluate(() => window.__dst!.titles());

type Box = { minX: number; minY: number; maxX: number; maxY: number };
// Half a pixel of rounding either way is not an overlap.
const overlap = (a: Box, b: Box) => a.minX < b.maxX - 0.5 && a.maxX > b.minX + 0.5 && a.minY < b.maxY - 0.5 && a.maxY > b.minY + 0.5;

test('US-044: at the far zoom no two titles overlap, and the selected degree keeps its title', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10148');
  const shown = (await titles(page)).filter((t) => t.shown);
  // Enough titles that they would have piled up without decluttering.
  expect(shown.length).toBeGreaterThan(20);
  const clashes = [];
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) if (overlap(shown[i].box, shown[j].box)) clashes.push(`${shown[i].id} / ${shown[j].id}`);
  expect(clashes).toEqual([]);
  expect(shown.map((t) => t.id)).toContain('C10148');
});

test('US-044: a degree title hidden at the far zoom shows once you zoom in on it', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const mid = { x: b.width / 2, y: b.height / 2 };
  // The hidden degree title nearest the middle of the screen.
  const target = (await titles(page))
    .filter((t) => t.kind === 'degree' && !t.shown && t.centre.x > 100 && t.centre.x < b.width - 100 && t.centre.y > 100 && t.centre.y < b.height - 100)
    .sort((p, q) => Math.hypot(p.centre.x - mid.x, p.centre.y - mid.y) - Math.hypot(q.centre.x - mid.x, q.centre.y - mid.y))[0];
  expect(target, 'a degree title hidden at the far zoom').toBeTruthy();
  for (let i = 0; i < 40; i++) {
    const t = (await titles(page)).find((x) => x.id === target.id)!;
    if (t.shown) break;
    await page.mouse.move(b.x + t.centre.x, b.y + t.centre.y);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await titles(page)).find((x) => x.id === target.id)!.shown).toBe(true);
});

test('US-044: panning at one zoom never changes which titles show', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const shownIds = async () => (await titles(page)).filter((t) => t.shown).map((t) => t.id).sort();
  const before = await shownIds();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 500, b.y + b.height / 2 - 200, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(1500); // inertia
  expect(await shownIds()).toEqual(before);
});

test('US-044: hovering a circle whose title was hidden shows its title', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  // A hidden degree title whose circle's centre is on screen and is not inside another degree.
  const hidden = (await titles(page)).filter(
    (t) => t.kind === 'degree' && !t.shown && t.centre.x > 100 && t.centre.x < b.width - 100 && t.centre.y > 100 && t.centre.y < b.height - 100,
  );
  expect(hidden.length).toBeGreaterThan(0);
  let target: string | null = null;
  for (const t of hidden) {
    await page.mouse.move(b.x + t.centre.x, b.y + t.centre.y);
    if ((await page.evaluate(() => window.__dst!.glowing())).includes(t.id)) {
      target = t.id;
      break;
    }
  }
  expect(target, 'a hidden degree that lights up under the pointer').toBeTruthy();
  expect((await titles(page)).find((t) => t.id === target)!.shown).toBe(true);
});
