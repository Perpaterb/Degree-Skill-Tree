import { expect, test } from '@playwright/test';
import { clickCircle, goTo, openTree } from './helpers';

// US-046 to US-049: choosing degrees, locking what cannot combine, and double degrees from two halves.

test('US-046: clicking a degree circle opens its panel without choosing it; Choose chooses; clearing unchooses', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  const picker = page.getByTestId('degree-picker');
  await expect(picker).toHaveValue('');
  await goTo(page, 'C10476');
  await page.getByRole('button', { name: 'Close' }).click();
  await clickCircle(page, 'C10476');
  const panel = page.getByTestId('detail-panel');
  await expect(panel.locator('h2')).toHaveText('Bachelor of Computing Science');
  await expect(picker).toHaveValue('');

  await page.getByTestId('choose-degree').click();
  await expect(picker).toHaveValue('C10476');
  await expect(page.getByTestId('choose-degree')).toHaveText('✓ Chosen (clear)');

  // Clearing from the panel, then choosing again and clearing from the chip.
  await page.getByTestId('choose-degree').click();
  await expect(picker).toHaveValue('');
  await page.getByTestId('choose-degree').click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Clear degree' }).click();
  await expect(picker).toHaveValue('');
});

const BSE = 'A-bachelor-of-sustainability-and-environment';
const locked = (page: import('@playwright/test').Page) => page.evaluate(() => window.__dst!.locked());

/** Open a degree's panel from the search box (flies to it) and click its main button. */
async function press(page: import('@playwright/test').Page, code: string, label: RegExp) {
  // A fresh search: Enter on an unchanged one moves on to the next match.
  await page.getByTestId('search').fill('');
  await goTo(page, code);
  const button = page.getByTestId('choose-degree');
  await expect(button).toHaveText(label);
  await button.click();
}

test('US-047: choosing the Bachelor of Business locks bachelors it cannot pair with, not its partners or a master\'s; clearing unlocks', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  expect((await locked(page)).filter((c) => /^C\d{5}$/.test(c))).toEqual([]);
  await page.getByTestId('degree-picker').selectOption('C10026');
  await expect.poll(() => locked(page)).toContain('C10476');
  const now = await locked(page);
  for (const open of ['C10148', BSE, 'C04273']) expect(now, open).not.toContain(open);

  await goTo(page, 'C10476');
  await expect(page.getByTestId('degree-lock-note')).toContainText('Does not combine with Bachelor of Business');
  await expect(page.getByTestId('choose-degree')).toBeDisabled();

  await page.getByTestId('degree-lock-note').getByRole('button', { name: /Clear Bachelor of Business/ }).click();
  await expect(page.getByTestId('degree-picker')).toHaveValue('');
  await expect.poll(async () => (await locked(page)).filter((c) => /^C\d{5}$/.test(c))).toEqual([]);

  // US-046: the picker replaces the current choice, even with a degree it has locked.
  await page.getByTestId('degree-picker').selectOption('C10026');
  await expect.poll(() => locked(page)).toContain('C10476');
  await page.getByTestId('degree-picker').selectOption('C10476');
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10476');
  await expect.poll(() => locked(page)).not.toContain('C10476');
});

test('US-048: IT then Business, and Business then IT, both make C10219; removing a half leaves the other', async ({ page }) => {
  const picker = page.getByTestId('degree-picker');
  await openTree(page, 't=uts-2027');
  await press(page, 'C10148', /^Choose this degree$/);
  await press(page, 'C10026', /^Add to make Bachelor of Information Technology Bachelor of Business$/);
  await expect(picker).toHaveValue('C10219');
  // Both halves show as chosen; neither is locked.
  expect(await locked(page)).not.toContain('C10148');
  await press(page, 'C10148', /Chosen, part of Bachelor of Information Technology Bachelor of Business \(remove\)/);
  await expect(picker).toHaveValue('C10026');

  await picker.selectOption('');
  await press(page, 'C10026', /^Choose this degree$/);
  await press(page, 'C10148', /^Add to make Bachelor of Information Technology Bachelor of Business$/);
  await expect(picker).toHaveValue('C10219');
});

test('US-048: a link naming a double opens with both halves chosen', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10219');
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10219');
  await goTo(page, 'C10026');
  await expect(page.getByTestId('choose-degree')).toHaveText(/Chosen, part of Bachelor of Information Technology Bachelor of Business/);
  await goTo(page, 'C10148');
  await expect(page.getByTestId('choose-degree')).toHaveText(/Chosen, part of Bachelor of Information Technology Bachelor of Business/);
});

test('US-049: Sustainability and Environment cannot be chosen first; Business then it makes C10411', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  expect(await locked(page)).toContain(BSE);
  await goTo(page, BSE);
  await expect(page.getByTestId('add-on-note')).toContainText('Only as part of a double degree');
  // Marked on the map too.
  expect((await page.evaluate((c) => window.__dst!.title(c), BSE))!.text.replace(/\s+/g, ' ')).toMatch(/only as part of a double degree/);
  await expect(page.getByTestId('choose-degree')).toBeDisabled();
  // Not offered first in the picker either.
  expect(await page.getByTestId('degree-picker').locator(`option[value="${BSE}"]`).count()).toBe(0);

  await page.getByTestId('degree-picker').selectOption('C10026');
  await expect.poll(() => locked(page)).not.toContain(BSE);
  await press(page, BSE, /^Add to make Bachelor of Business Bachelor of Sustainability and Environment$/);
  await expect(page.getByTestId('degree-picker')).toHaveValue('C10411');
  // Removing Business removes the add-on half too.
  await press(page, 'C10026', /Chosen, part of .* \(remove\)/);
  await expect(page.getByTestId('degree-picker')).toHaveValue('');
});
