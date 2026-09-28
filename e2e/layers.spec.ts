import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-052: the circles the open item sits in, as buttons above the detail card.
const layers = (page: Page) => page.getByTestId('layer');
const codes = (page: Page) => layers(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));

test('US-052: a subject shows the circles it sits in, outermost first, topped by a chosen double; each button goes up to that circle', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10219');
  // With IT + Business chosen, 21513 flies to its copy in major MAJ08966, inside the Bachelor of IT.
  await goTo(page, '21513');
  await expect.poll(() => codes(page)).toEqual(['C10219', 'C10148', 'MAJ08966']);
  // The buttons are the card's width, stacked above it.
  const card = (await page.getByTestId('detail-panel').boundingBox())!;
  for (const b of await layers(page).all()) {
    const box = (await b.boundingBox())!;
    expect(Math.abs(box.width - card.width)).toBeLessThan(1);
    expect(box.y + box.height).toBeLessThanOrEqual(card.y);
  }

  // Up two levels: the degree itself, whose own layers are the double above it.
  await layers(page).nth(1).click();
  await expect(page.getByTestId('detail-panel').locator('h2')).toHaveText('Bachelor of Information Technology');
  await expect.poll(() => codes(page)).toEqual(['C10219']);

  // The double: its details, and the camera frames both halves.
  await layers(page).first().click();
  await expect(page.getByTestId('detail-panel')).toContainText('C10219');
  await expect.poll(() => codes(page)).toEqual([]);
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__dst!.titles().filter((x) => x.id === 'C10148' || x.id === 'C10026').map((x) => x.centre));
      return t.length === 2 && t.every((c) => c.x > 0 && c.x < b.width && c.y > 0 && c.y < b.height);
    })
    .toBe(true);
});

test('US-052: a subject link in a circle\'s panel keeps that circle as its layer, a map click shows the clicked copy\'s, and closing the card removes them', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  // From Business's panel, 23115 opens its copy inside Business.
  await goTo(page, 'C10026');
  await page.getByTestId('detail-panel').getByRole('button', { name: /23115 Economics for Business/ }).first().click();
  await expect.poll(() => codes(page)).toEqual(['C10026']);
  // From Software Engineering's panel, 31005 opens its copy there, not the copy another major would
  // otherwise get (MAJ03518).
  await page.getByTestId('search').fill('');
  await goTo(page, 'MAJ03523');
  await page.getByTestId('detail-panel').getByRole('button', { name: /31005 Machine Learning/ }).first().click();
  await expect.poll(() => codes(page)).toEqual(['C09066', 'MAJ03523']);

  // Clicked on the map: the layers end at the circle holding the copy clicked. Search first, so the
  // copy on screen is the one pointFor picks.
  await page.getByTestId('search').fill('');
  await goTo(page, '23115');
  await page.getByRole('button', { name: 'Close' }).click();
  const at = (await page.evaluate(() => window.__dst!.pointFor('23115')))!;
  const box = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(page.getByTestId('detail-panel')).toContainText('23115');
  const flown = (await page.evaluate(() => window.__dst!.flewTo()))!;
  const shown = await codes(page);
  expect(shown[shown.length - 1]).toBe(flown.split('/')[0]);

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(layers(page)).toHaveCount(0);
});
