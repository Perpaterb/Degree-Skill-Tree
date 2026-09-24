import { expect, test } from '@playwright/test';
import { goTo, openTree, waitReady } from './helpers';

// Chinese Language and Culture 3 (97103) needs 97102, which needs 97101 (which needs nothing).

test('US-025: marking a subject completed before its prerequisites asks first, and can go ahead anyway', async ({ page }) => {
  // Planned prerequisites do not count as completed.
  await openTree(page, 't=uts-2027&p=97101.97102');
  await goTo(page, '97103');
  const panel = page.getByTestId('detail-panel');
  const warning = page.getByTestId('prereq-warning');

  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await expect(warning).toBeVisible();
  await expect(warning.getByTestId('prereq-missing').locator('li')).toHaveText([/97101/, /97102/]);

  // Close changes nothing; so do Escape and a click outside.
  await warning.getByRole('button', { name: 'Close' }).click();
  await expect(warning).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Mark completed' })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await page.keyboard.press('Escape');
  await expect(warning).toBeHidden();
  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await page.mouse.click(5, 300);
  await expect(warning).toBeHidden();
  await expect(page).not.toHaveURL(/c=97103/);

  // Mark anyway marks it, and it survives a reload.
  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await warning.getByRole('button', { name: 'Mark as completed anyway' }).click();
  await expect(warning).toBeHidden();
  await expect(panel.getByRole('button', { name: '✓ Completed' })).toBeVisible();
  await expect(page).toHaveURL(/c=97103/);
  await page.reload();
  await waitReady(page);
  await goTo(page, '97103');
  await expect(page.getByTestId('detail-panel').getByRole('button', { name: '✓ Completed' })).toBeVisible();

  // Un-marking never asks.
  await page.getByTestId('detail-panel').getByRole('button', { name: '✓ Completed' }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByTestId('detail-panel').getByRole('button', { name: 'Mark completed' })).toBeVisible();
});

test('US-025: no warning when the prerequisites are completed, or there are none', async ({ page }) => {
  await openTree(page);
  const panel = page.getByTestId('detail-panel');
  for (const code of ['97101', '97102']) {
    await goTo(page, code);
    await panel.getByRole('button', { name: 'Mark completed' }).click();
    await expect(page.getByTestId('prereq-warning')).toBeHidden();
    await expect(panel.getByRole('button', { name: '✓ Completed' })).toBeVisible();
  }
});
