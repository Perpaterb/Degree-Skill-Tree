import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-021: going to a subject with several copies flies to the one that matters to this student: inside
// the chosen degree (either half of a double) and not in a locked circle, else any copy not locked.
const flewTo = (page: Page) => page.evaluate(() => window.__dst!.flewTo());

test('US-021: with nothing chosen, a subject flies to a copy outside the locked add-on halves', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  // 81511 is listed by Creative Intelligence and Innovation's core (inside that locked add-on half) and
  // by C09122, which is open.
  await goTo(page, '81511');
  expect(await flewTo(page)).toBe('C09122/81511');
});

test('US-021: with a double chosen, a subject flies to its copy inside one of the halves', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10219');
  // Both used to fly to the locked Sustainability and Environment stream (STM92037).
  await goTo(page, '23115');
  expect(await flewTo(page)).toBe('C10026/23115');
  await page.getByTestId('search').fill('');
  await goTo(page, '21513');
  expect(await flewTo(page)).toBe('MAJ08966/21513');
});

test('US-021: clicking a subject in the degree panel flies the same way', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10219');
  await goTo(page, 'C10026');
  const link = page.getByTestId('detail-panel').getByRole('button', { name: /23115 Economics for Business/ }).first();
  await link.click();
  await expect(page.getByTestId('detail-panel')).toContainText('Economics for Business');
  expect(await flewTo(page)).toBe('C10026/23115');
});
