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
  // Its requisite is 97102, which in turn needs 97101.
  await expect(warning.getByTestId('prereq-rule')).toContainText('97102');
  await expect(warning.getByTestId('needs-first')).toHaveText('needs 97101 first');

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

test('US-025: when any one of several subjects will do, the warning lists every one of them', async ({ page }) => {
  // 41001 Cloud Computing needs one of 48440, 31244, 31281, 31061, 48024, 31271.
  await openTree(page);
  await goTo(page, '41001');
  await page.getByTestId('detail-panel').getByRole('button', { name: 'Mark completed' }).click();
  const rule = page.getByTestId('prereq-warning').getByTestId('prereq-rule');
  await expect(rule).toContainText('One of:');
  for (const code of ['48440', '31244', '31281', '31061', '48024', '31271']) await expect(rule).toContainText(code);
  // 48024 has alternatives of its own, so its note gives an example rather than the only way.
  await expect(rule.getByTestId('needs-first').first()).toContainText('for example');
});
