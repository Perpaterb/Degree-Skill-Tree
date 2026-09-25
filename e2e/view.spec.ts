import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-028 circle title progress, US-029 view settings, US-030 light and dark mode.
const ADV = ['24210', '52662', '24109', '24202']; // Advertising Principles sub-major SMJ08198, 24cp
const DA_CORE = ['33116', '31250', '31005', '32146', '42050', '41759', '48024']; // Data Analytics MAJ02081 core, 42cp
const DA_OPTIONS = ['42028', '41040']; // two of its 6cp options

const title = (page: Page, id: string) => page.evaluate((i) => window.__dst!.title(i)!, id);
const DARK = { complete: 0x45d16b, planned: 0xb36bff, background: 0x0b0d12 };
const LIGHT = { background: 0xf4f1ea };

async function zoomBy(page: Page, dy: number) {
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(700);
}

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('US-028: a program title shows completed / needed credit points with a green or purple tick, uncapped', async ({ page }) => {
    await openTree(page, `t=uts-2027&c=${ADV.join('.')}`);
    let t = await title(page, 'SMJ08198');
    expect(t.progress).toBe('24/24cp ✓');
    expect(t.progressColour).toBe(DARK.complete);

    await openTree(page, `t=uts-2027&p=${ADV.join('.')}`);
    t = await title(page, 'SMJ08198');
    expect(t.progress).toBe('0+24/24cp ✓');
    expect(t.progressColour).toBe(DARK.planned);

    // Two options where one is needed: 54 of 48, not capped at 48.
    await openTree(page, `t=uts-2027&c=${[...DA_CORE, ...DA_OPTIONS].join('.')}`);
    t = await title(page, 'MAJ02081');
    expect(t.progress).toBe('54/48cp ✓');

    // Part done: no tick.
    await openTree(page, `t=uts-2027&c=${ADV.slice(0, 2).join('.')}`);
    expect((await title(page, 'SMJ08198')).progress).toBe('12/24cp');
  });

  test('US-028: a degree title counts the completed subjects that count towards it', async ({ page }) => {
    await openTree(page, `t=uts-2027&d=C10148&c=${[...DA_CORE, ...DA_OPTIONS].join('.')}`);
    expect((await title(page, 'C10148')).progress).toBe('54/144cp');
  });

  test('US-028: titles sit clear above their circle', async ({ page }) => {
    await openTree(page, 't=uts-2027');
    await goTo(page, 'MAJ02081');
    const t = await title(page, 'MAJ02081');
    const zoom = await page.evaluate(() => window.__dst!.zoom());
    // The layout leaves an 8-unit gap for program titles; they now sit a further 8 higher.
    expect(t.circleTop - t.bottom).toBeGreaterThanOrEqual(15 * zoom);
  });

  test('US-029: settings change text growth, size and credit points, persist in this browser, and stay out of the link', async ({ page }) => {
    await openTree(page, `t=uts-2027&c=${ADV.join('.')}`);
    await page.getByTestId('view-settings-button').click();
    const popup = page.getByTestId('view-settings');
    await expect(popup).toBeVisible();
    await expect(page.getByTestId('view-grow')).toBeChecked();
    await expect(page.getByTestId('view-size-value')).toHaveText('100%');

    // Growing: the degree title changes with zoom, within 16 to 72px.
    const a = (await title(page, 'C10148')).px;
    await zoomBy(page, -600);
    const b = (await title(page, 'C10148')).px;
    expect(b).not.toBeCloseTo(a, 0);
    for (const px of [a, b]) {
      expect(px).toBeGreaterThanOrEqual(16 - 0.01);
      expect(px).toBeLessThanOrEqual(72 + 0.01);
    }

    // Not growing: 26px at every zoom; at 200%, 52px.
    await page.getByTestId('view-grow').uncheck();
    expect((await title(page, 'C10148')).px).toBeCloseTo(26, 1);
    await zoomBy(page, 600);
    expect((await title(page, 'C10148')).px).toBeCloseTo(26, 1);
    await page.getByTestId('view-size').fill('200');
    await expect(page.getByTestId('view-size-value')).toHaveText('200%');
    expect((await title(page, 'C10148')).px).toBeCloseTo(52, 1);

    // Credit points off hides them.
    expect((await title(page, 'SMJ08198')).progress).toBe('24/24cp ✓');
    await page.getByTestId('view-cp').uncheck();
    expect((await title(page, 'SMJ08198')).progressVisible).toBe(false);

    // Escape closes the popup.
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();

    // Remembered after a reload, and not in the shared link.
    expect(page.url()).not.toMatch(/grow|size|showCp/);
    await page.reload();
    await page.waitForFunction(() => !!window.__dst?.title('C10148'));
    expect((await title(page, 'C10148')).px).toBeCloseTo(52, 1);
    expect((await title(page, 'SMJ08198')).progressVisible).toBe(false);
    await page.getByTestId('view-settings-button').click();
    await expect(page.getByTestId('view-grow')).not.toBeChecked();
  });

  test('US-029: subject labels follow the text size, and hide rather than overflow their disc', async ({ page }) => {
    await openTree(page, 't=uts-2027');
    await goTo(page, '31251');
    const id = await page.evaluate(() => window.__dst!.copies('31251')[0]);
    const label = () => page.evaluate((i) => window.__dst!.subjectLabel(i)!, id);
    await page.getByTestId('view-settings-button').click();
    await page.getByTestId('view-grow').uncheck();
    await page.mouse.move(5, 5);
    expect((await label()).px).toBeCloseTo(12, 0);
    await page.getByTestId('view-size').fill('50');
    expect((await label()).px).toBeCloseTo(6, 0);
    // Zoomed well out at fixed size the code no longer fits its disc, so it hides.
    await page.getByTestId('view-size').fill('100');
    await page.keyboard.press('Escape');
    await page.getByTestId('search').fill('');
    await page.getByRole('button', { name: 'Close' }).click();
    // Between 0.42 (below which labels always hide) and about 0.64 (where a 12px code stops fitting its disc).
    while ((await page.evaluate(() => window.__dst!.zoom())) > 0.6) await zoomBy(page, 60);
    // Off the subject: a hovered subject always shows its code.
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await label()).visible).toBe(false);
    expect(await page.evaluate(() => window.__dst!.zoom())).toBeGreaterThan(0.42);
  });
});

test.describe('light and dark (US-030)', () => {
  test.use({ colorScheme: 'light' });

  test('US-030: the first visit follows the system, the button switches the whole app, and the choice is remembered', async ({ page }) => {
    await openTree(page, 't=uts-2027');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => window.__dst!.background())).toBe(LIGHT.background);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 241, 234)');
    const lightDot = await page.locator('.legend .dot').first().evaluate((el) => getComputedStyle(el).borderColor);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => window.__dst!.background())).toBe(DARK.background);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 13, 18)');
    expect(await page.locator('.legend .dot').first().evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(lightDot);

    // The system still says light, but the choice wins after a reload.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForFunction(() => !!window.__dst);
    expect(await page.evaluate(() => window.__dst!.background())).toBe(DARK.background);
  });
});

test('US-029: the settings popup stays on screen at phone width @phone', async ({ page }) => {
  await openTree(page, 't=uts-2027');
  await page.getByTestId('view-settings-button').click();
  const box = (await page.getByTestId('view-settings').boundingBox())!;
  const width = await page.evaluate(() => innerWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
});
