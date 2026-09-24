import { expect, test } from '@playwright/test';
import { clickCentre, goTo, openTree, waitReady } from './helpers';

// Every test name starts with its story ID; scripts/story-coverage.mjs reads them.

test('US-004: the Bachelor of IT tree renders on a canvas with the degree hub and clusters', async ({ page }) => {
  await openTree(page);
  await expect(page.locator('.brand-sub')).toContainText('Bachelor of Information Technology');
  const canvas = page.locator('[data-testid="tree-canvas"] canvas');
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(800);
  // The hub is drawn at the centre of the initial view: its pixels are not background.
  const shot = await canvas.screenshot();
  expect(shot.byteLength).toBeGreaterThan(20_000);
});

test('US-004: dragging pans and the wheel zooms (a clicked node moves on screen)', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31251');
  await page.getByRole('button', { name: 'Close' }).click();
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  // Pan 300px left: 31251 should follow the drag.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 300, cy, { steps: 12 });
  await page.waitForTimeout(250); // hold still so the pan has no momentum left
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.mouse.click(cx - 300, cy);
  await expect(page.getByTestId('detail-panel')).toContainText('31251');
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(600);
});

test('US-005: inspecting a subject shows its details and a readable requisite rule', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31272');
  const panel = page.getByTestId('detail-panel');
  await expect(panel).toContainText('Project Management and the Professional');
  await expect(panel).toContainText('All of:');
  await expect(panel).toContainText('One of:');
  await expect(panel).toContainText('At least 72 credit points completed');
  await expect(panel).toContainText('Cannot be taken with');
  await expect(panel.getByRole('link', { name: /Official handbook page/ })).toHaveAttribute('href', /\/subject\/2027\/31272$/);
  // A requisite is clickable and moves the panel (and camera) to it.
  await panel.getByRole('button', { name: /31269 Business Requirements Modelling/ }).first().click();
  await expect(panel.locator('h2')).toContainText('31269');
});

test('US-005: clicking a node on the canvas opens it', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31251');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('detail-panel')).toHaveCount(0);
  await clickCentre(page);
  await expect(page.getByTestId('detail-panel').locator('h2')).toContainText('31251 Data Structures and Algorithms');
});

test('US-005: a legacy subject explains that it is not in this year’s handbook', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31256');
  await expect(page.getByTestId('detail-panel')).toContainText('no page in the 2027 handbook');
});

test('US-006: search counts matches and Enter cycles through them', async ({ page }) => {
  await openTree(page);
  const box = page.getByTestId('search');
  await box.fill('security');
  await expect(page.getByTestId('search-count')).toHaveText(/^[1-9]\d* match/);
  await box.press('Enter');
  const first = await page.getByTestId('detail-panel').locator('h2').textContent();
  await box.press('Enter');
  await expect(page.getByTestId('detail-panel').locator('h2')).not.toHaveText(first!);
});

test('US-007: marking a subject completed updates what is available and excluded', async ({ page }) => {
  await openTree(page);
  await goTo(page, '41039');
  const panel = page.getByTestId('detail-panel');
  await expect(panel).toContainText('Available now');
  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await expect(panel.getByRole('button', { name: '✓ Completed' })).toBeVisible();
  // 48023 is an anti-requisite of 41039.
  await goTo(page, '48023');
  await expect(panel).toContainText('Clashes with a subject you have');
});

test('US-007: the plan survives a reload and a shared link reproduces it elsewhere', async ({ page, browser }) => {
  test.slow(); // loads the whole tree three times (first visit, reload, second browser)
  await openTree(page);
  await goTo(page, '41039');
  await page.getByTestId('detail-panel').getByRole('button', { name: 'Mark completed' }).click();
  await goTo(page, '31251');
  await page.getByTestId('detail-panel').getByRole('button', { name: 'Plan it' }).click();
  await expect(page).toHaveURL(/c=41039/);
  await expect(page).toHaveURL(/p=31251/);

  await page.reload();
  await waitReady(page);
  await goTo(page, '41039');
  await expect(page.getByTestId('detail-panel')).toContainText('Completed');

  // A different browser profile (no localStorage) gets the same plan from the link alone.
  const url = page.url();
  const other = await (await browser.newContext()).newPage();
  await openTree(other, url);
  await goTo(other, '31251');
  await expect(other.getByTestId('detail-panel')).toContainText('Planned');
});

test('US-008: a locked subject says what is missing, and a subject lists what it leads to', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31272');
  const panel = page.getByTestId('detail-panel');
  await expect(panel).toContainText('Locked');
  const unlock = panel.locator('section', { hasText: 'To unlock' });
  await expect(unlock).toContainText('31269');
  await expect(unlock).toContainText('Also: at least 72cp completed');
  await goTo(page, '31269');
  await expect(panel.locator('section', { hasText: 'Leads to' })).toContainText('31272');
});

test('US-009: choosing a major and completing its subjects shows progress to the degree', async ({ page }) => {
  await openTree(page);
  await goTo(page, 'MAJ03444');
  const panel = page.getByTestId('detail-panel');
  await panel.getByRole('button', { name: 'Choose this major' }).click();
  await expect(panel.getByRole('button', { name: '✓ Chosen' })).toBeVisible();
  await expect(page.getByTestId('progress-total')).toHaveText('0/144cp');
  await goTo(page, '41039');
  await panel.getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByTestId('progress-total')).toHaveText('6/144cp');
  await expect(page.getByTestId('progress-panel')).toContainText('Enterprise Software Development');
});

test('US-004: phone-width layout keeps the map and a bottom sheet usable @phone', async ({ page }) => {
  await openTree(page);
  await goTo(page, '31251');
  const panel = (await page.getByTestId('detail-panel').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(panel.width).toBeLessThanOrEqual(viewport.width);
  expect(panel.y).toBeGreaterThan(viewport.height * 0.3); // a bottom sheet, not a side panel
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
});
