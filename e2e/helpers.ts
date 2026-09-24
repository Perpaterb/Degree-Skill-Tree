import { expect, type Page } from '@playwright/test';

// First load fetches ~500 KB of tree JSON and lays it out; with several software-GL browsers
// running in parallel that can take well over the default 5s, so readiness gets its own allowance.
const LOAD_TIMEOUT = 20_000;

/** Open the app at `./#hash`, or at an absolute URL, and wait until the tree has drawn. */
export async function openTree(page: Page, hashOrUrl = '') {
  await page.goto(/^https?:/.test(hashOrUrl) ? hashOrUrl : hashOrUrl ? `./#${hashOrUrl}` : './');
  await waitReady(page);
}

/** Wait until the page that is already loading has fetched, laid out and drawn the tree. */
export async function waitReady(page: Page) {
  await expect(page.locator('.brand-sub')).toContainText('degrees', { timeout: LOAD_TIMEOUT });
  // Wait for the canvas to exist and draw a few frames.
  await expect(page.locator('[data-testid="tree-canvas"] canvas')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => Number(document.body.dataset.fps ?? 0) > 0, undefined, { timeout: LOAD_TIMEOUT });
}

/** Search for a code, press Enter (flies the camera to it and selects it). */
export async function goTo(page: Page, code: string) {
  const box = page.getByTestId('search');
  await box.fill(code);
  await box.press('Enter');
  await expect(page.getByTestId('detail-panel')).toContainText(code);
  await page.waitForTimeout(800); // camera flight
}

/** Click the middle of the canvas, where the camera just flew to. */
export async function clickCentre(page: Page) {
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Pick a degree from the top bar (the same as clicking its circle), then close the panel it opens. */
export async function chooseDegree(page: Page, code: string) {
  await page.getByTestId('degree-picker').selectOption(code);
  await expect(page.getByTestId('progress-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
}

/** Click a circle through the real canvas, at a spot that belongs to it and nothing smaller. */
export async function clickCircle(page: Page, id: string) {
  const point = await page.evaluate((c) => window.__dst?.pointFor(c) ?? null, id);
  if (!point) throw new Error(`no clickable point on screen for circle ${id}`);
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.click(b.x + point.x, b.y + point.y);
}
