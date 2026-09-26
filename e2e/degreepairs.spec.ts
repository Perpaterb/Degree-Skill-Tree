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
