import { expect, test } from '@playwright/test';
import { openTree } from './helpers';

// US-004 performance: needs real GPU rendering, so it only runs when asked (npm run test:perf).
// Software rendering (the default E2E setup) measures the emulated GPU, not the app.
test.skip(!process.env.PERF, 'set PERF=1 (npm run test:perf) to measure on real hardware');

test('US-004: scripted pan and zoom over the whole tree holds a median of at least 55fps', async ({ page }) => {
  await openTree(page);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  test.info().annotations.push({ type: 'renderer', description: String(renderer) });
  const b = (await page.getByTestId('tree-canvas').boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;

  // Count real animation frames while panning and zooming for ~6s.
  await page.evaluate(() => {
    (window as any).__frames = [];
    const tick = (t: number) => {
      (window as any).__frames.push(t);
      if ((window as any).__frames.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 400, cy - 150, { steps: 40 });
    await page.mouse.move(cx + 300, cy + 200, { steps: 40 });
    await page.mouse.up();
    for (let z = 0; z < 6; z++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
    await page.waitForTimeout(300);
  }
  const frames: number[] = await page.evaluate(() => (window as any).__frames);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const medianFps = 1000 / gaps[Math.floor(gaps.length / 2)];
  const p95Fps = 1000 / gaps[Math.floor(gaps.length * 0.95)];
  test.info().annotations.push({ type: 'fps', description: `median ${medianFps.toFixed(1)}, p95 ${p95Fps.toFixed(1)} (${frames.length} frames)` });
  console.log(`renderer: ${renderer}; median ${medianFps.toFixed(1)}fps, p95 ${p95Fps.toFixed(1)}fps over ${frames.length} frames`);
  expect(medianFps).toBeGreaterThanOrEqual(55);
});
