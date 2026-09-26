import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-050: courses offered only in another location sit in their own labelled areas.
const areas = (page: Page) => page.evaluate(() => window.__dst!.areas());

test('US-050: the China and Vietnam areas are titled, and an offshore degree sits inside its area', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  expect((await areas(page)).map((a) => [a.id, a.title.replace(/\s+/g, ' ')])).toEqual([
    ['China', 'Offered only in China'],
    ['Vietnam', 'Offered only in Ho Chi Minh City, Vietnam'],
  ]);

  // Fly to the offshore Bachelor of Business, then zoom out until the China area's title is on screen.
  await goTo(page, 'C10226');
  await page.getByRole('button', { name: 'Close' }).click();
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const onScreen = (t: { minX: number; minY: number; maxX: number; maxY: number }) => t.minX >= 0 && t.minY >= 0 && t.maxX <= b.width && t.maxY <= b.height;
  for (let i = 0; i < 40; i++) {
    const china = (await areas(page)).find((a) => a.id === 'China')!;
    if (china.shown && onScreen(china.titleBox)) break;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
  }
  const china = (await areas(page)).find((a) => a.id === 'China')!;
  expect(china.shown).toBe(true);
  expect(onScreen(china.titleBox)).toBe(true);
  const centre = (await page.evaluate(() => window.__dst!.titles().find((t) => t.id === 'C10226')!.centre))!;
  expect(centre.x).toBeGreaterThan(china.frame.minX);
  expect(centre.x).toBeLessThan(china.frame.maxX);
  expect(centre.y).toBeGreaterThan(china.frame.minY);
  expect(centre.y).toBeLessThan(china.frame.maxY);
});
