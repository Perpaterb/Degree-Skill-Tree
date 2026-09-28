import { expect, test, type Page } from '@playwright/test';

// US-057: Dynamic mode measured on real hardware, reported rather than tuned into a pass. Needs the
// real GPU, so it only runs when asked: PERF=1 npx playwright test e2e/perf-dynamic.spec.ts --project=desktop
test.skip(!process.env.PERF, 'set PERF=1 to measure on real hardware');
test.setTimeout(300_000);

async function frames<T>(page: Page, during: () => Promise<T>) {
  await page.evaluate(() => {
    const w = window as any;
    const run = (w.__run = (w.__run ?? 0) + 1);
    w.__frames = [];
    const tick = (t: number) => {
      if (w.__run !== run) return;
      w.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const out = await during();
  const f: number[] = await page.evaluate(() => ((window as any).__run++, (window as any).__frames));
  const g = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  const q = (p: number) => g[Math.min(g.length - 1, Math.floor(g.length * p))];
  return { out, fps: `median ${(1000 / q(0.5)).toFixed(1)}fps, p95 ${(1000 / q(0.95)).toFixed(1)}fps, worst frame ${q(1).toFixed(0)}ms over ${g.length} frames` };
}

const settle = async (page: Page) => {
  const t = Date.now();
  await expect.poll(() => page.evaluate(() => !!window.__dyn?.settled()), { timeout: 60_000, intervals: [50] }).toBe(true);
  return Date.now() - t;
};

async function pan(page: Page) {
  const b = (await page.getByTestId('dynamic-canvas').boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 400, cy - 150, { steps: 40 });
    await page.mouse.move(cx + 300, cy + 200, { steps: 40 });
    await page.mouse.up();
    for (let z = 0; z < 3; z++) await page.mouse.wheel(0, i % 2 ? 60 : -60);
    await page.waitForTimeout(300);
  }
}

test('US-057: Dynamic mode, settling and panning, with nothing chosen and with a degree chosen', async ({ page }) => {
  const log = (s: string) => (console.log(s), test.info().annotations.push({ type: 'US-057', description: s }));
  await page.addInitScript(() => localStorage.setItem('dst.mode', 'dynamic'));
  const t0 = Date.now();
  await page.goto('./#t=uts-2027');
  const first = await frames(page, async () => {
    await page.waitForFunction(() => !!window.__dyn, undefined, { timeout: 60_000 });
    return settle(page);
  });
  log(`nothing chosen: open to settled ${Date.now() - t0} ms (settling ${first.out} ms), ${await page.evaluate(() => window.__dyn!.bodies().length)} circles; while settling ${first.fps}`);
  log(`nothing chosen, panning: ${(await frames(page, () => pan(page))).fps}`);

  const choose = await frames(page, async () => {
    await page.getByTestId('degree-picker').selectOption('C10242');
    await page.waitForTimeout(100);
    return settle(page);
  });
  log(`choose Bachelor of Science: settled in ${choose.out} ms, ${await page.evaluate(() => window.__dyn!.bodies().length)} circles; while settling ${choose.fps}`);
  await page.getByRole('button', { name: 'Close' }).click();
  log(`Bachelor of Science, panning: ${(await frames(page, () => pan(page))).fps}`);

  const back = await frames(page, async () => {
    await page.getByTestId('unchoose-degree').click();
    await page.waitForTimeout(100);
    return settle(page);
  });
  log(`unchoose: settled in ${back.out} ms; while settling ${back.fps}`);
  const s = await page.evaluate(() => window.__dyn!.stats());
  const r = [...s.relayouts].sort((a, b) => a - b);
  log(`re-layouts: ${r.length}, median ${r[r.length >> 1]?.toFixed(0)} ms, max ${r[r.length - 1]?.toFixed(0)} ms; one physics step ${s.tickMs.toFixed(1)} ms`);
});
