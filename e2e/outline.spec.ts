import { expect, test, type Page } from '@playwright/test';
import { goTo, openTree } from './helpers';

// US-027: the Bachelor of IT outline in the degree panel, coloured by progress.
// Compulsory (42cp): 31265 31268 31271 31269 41092 43030 31272.
// Options (48cp), way 2 "two sub-majors": Advertising Principles SMJ08198 (24210 52662 24109 24202)
// and Innovation and Entrepreneurship SMJ10156 (81547 81529 48080 81546).
const COMPULSORY = ['31265', '31268', '31271', '31269', '41092', '43030', '31272'];
const ADV = ['24210', '52662', '24109', '24202'];
const INN = ['81547', '81529', '48080', '81546'];

async function outline(page: Page, hash: string) {
  await openTree(page, `t=uts-2027&d=C10148&${hash}`);
  await goTo(page, 'C10148');
  // A search match glows too; clear it so glows come only from what the test hovers.
  await page.getByTestId('search').fill('');
  return page.getByTestId('detail-panel');
}
const heading = (panel: ReturnType<Page['getByTestId']>, title: string) =>
  panel.getByTestId('outline-heading').filter({ hasText: new RegExp(`^${title} \\(`) });
const way = (panel: ReturnType<Page['getByTestId']>, n: number) => panel.getByTestId('outline-way').nth(n);
/** Ways start closed (US-034); open one to see what fills it. */
async function openWay(panel: ReturnType<Page['getByTestId']>, n: number) {
  await way(panel, n).click();
  await expect(way(panel, n)).toHaveAttribute('data-open', 'true');
}

test('US-027: a compulsory block is untouched, started, planned-complete, then complete', async ({ page }) => {
  let panel = await outline(page, 'c=');
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'none');

  panel = await outline(page, `c=${COMPULSORY[0]}`);
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'started');

  panel = await outline(page, `c=${COMPULSORY.slice(0, 3).join('.')}&p=${COMPULSORY.slice(3).join('.')}`);
  await expect(heading(panel, 'Compulsory')).toHaveAttribute('data-status', 'planned');
  await expect(heading(panel, 'Compulsory')).toContainText('✓');

  panel = await outline(page, `c=${COMPULSORY.join('.')}`);
  const h = heading(panel, 'Compulsory');
  await expect(h).toHaveAttribute('data-status', 'complete');
  await expect(h).toContainText('✓');
  // Green, not the untouched grey.
  expect(await h.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(69, 209, 107)');
});

test('US-027 / US-022: the Options ways each get their own line, fill in as sub-majors are chosen, planned and done, and count 48/48', async ({ page }) => {
  let panel = await outline(page, 'c=');
  await expect(panel.getByTestId('outline-way')).toHaveText([/^one major \(48cp\)/, /^two sub-majors/, /^one sub-major \(24cp\) and four electives/, /^one transdisciplinary elective/]);
  for (let i = 0; i < 4; i++) await expect(way(panel, i)).toHaveAttribute('data-status', 'none');

  // Chosen, nothing done: the sub-major ways start, and the chosen sub-major line is yellow.
  panel = await outline(page, 'm=SMJ08198.SMJ10156');
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'started');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'none');
  await openWay(panel, 1);
  await expect(panel.locator('[data-testid="outline-program"][data-code="SMJ08198"]').first()).toHaveAttribute('data-status', 'started');

  // One done, one planned: blue with a tick, for the way and for Options.
  panel = await outline(page, `m=SMJ08198.SMJ10156&c=${ADV.join('.')}&p=${INN.join('.')}`);
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'planned');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'planned');

  // Both done: green with a tick, and the progress panel agrees at 48/48.
  panel = await outline(page, `m=SMJ08198.SMJ10156&c=${[...ADV, ...INN].join('.')}`);
  await openWay(panel, 1);
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'complete');
  await expect(way(panel, 1)).toContainText('✓');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'complete');
  await expect(panel.locator('[data-testid="outline-program"][data-code="SMJ08198"]').first()).toHaveAttribute('data-status', 'complete');
  await expect(heading(panel, 'Options').last().getByTestId('outline-cp')).toHaveText('(48/48cp)');
});

test('US-027 / US-022: a second completed major counts under Options, and a subject shared with the first is named', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const ID = ['31260', '31777', '31080', '41019', '31263', '31264', '41889'];
  const program = (panel: ReturnType<Page['getByTestId']>, code: string, n: number) => panel.locator(`[data-testid="outline-program"][data-code="${code}"]`).nth(n);

  // 41759 is in both majors but counts once, so Interaction Design is 6cp short and the panel says why.
  let panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID].join('.')}`);
  await openWay(panel, 0);
  await expect(program(panel, 'MAJ02081', 0)).toHaveAttribute('data-status', 'complete');
  await expect(program(panel, 'MAJ02092', 0)).toHaveAttribute('data-status', 'started');
  await expect(program(panel, 'MAJ02092', 0).getByTestId('outline-shared')).toContainText('41759');
  await expect(program(panel, 'MAJ02092', 0).getByTestId('outline-shared')).toContainText('counts towards Data Analytics, not here');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'started');
  await expect(page.getByTestId('progress-total')).toHaveText('90/144cp');

  // One more Interaction Design option fills it: both majors green, Options way 1 green, 96cp in all.
  panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID, '31262'].join('.')}`);
  await openWay(panel, 0);
  await expect(program(panel, 'MAJ02092', 0)).toHaveAttribute('data-status', 'complete');
  await expect(program(panel, 'MAJ02092', 0)).toContainText('✓');
  await expect(way(panel, 0)).toHaveAttribute('data-status', 'complete');
  await expect(heading(panel, 'Options').last()).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('progress-total')).toHaveText('96/144cp');
});

test('US-031: each Options way and heading shows its own done / needed credit points', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const ID = ['31260', '31777', '31080', '41019', '31263', '31264', '41889'];
  const panel = await outline(page, `m=MAJ02081.MAJ02092&c=${[...DA, ...ID].join('.')}&p=31262`);
  // Way 1 (one major): Interaction Design is 42 done, and the planned extra option makes up the shared 6.
  await expect(way(panel, 0).getByTestId('outline-way-cp')).toHaveText('42+6/48cp');
  await expect(way(panel, 1).getByTestId('outline-way-cp')).toHaveText('0/48cp');
  await expect(heading(panel, 'Options').last().getByTestId('outline-cp')).toHaveText('(42+6/48cp)');
  await expect(heading(panel, 'Compulsory').getByTestId('outline-cp')).toHaveText('(0/42cp)');
  // The bar is drawn for each way it can read.
  await expect(way(panel, 0).locator('.bar-done')).toHaveAttribute('style', /width: 87\.5/);
});

test('US-032: a free-elective slot lists what fills it, and hovering its note lights up subjects you could take now', async ({ page }) => {
  // 31061 and 32130 are not listed anywhere in the Bachelor of IT, so they can only count as free electives.
  const panel = await outline(page, 'c=31061.32130');
  await openWay(panel, 3); // the electives fill "seven electives (42cp)"
  await page.mouse.move(5, 5); // off the way row, which glows what fills it (US-033)
  const free = panel.getByTestId('free-electives');
  await expect(free.first()).toContainText('31061');
  await expect(free.first()).toContainText('32130');
  const hint = panel.getByTestId('free-electives-hint').first();
  await expect(hint).toContainText('Any UTS subject');
  expect(await page.evaluate(() => window.__dst!.ringed().length)).toBe(0);
  await hint.hover();
  await expect.poll(() => page.evaluate(() => window.__dst!.ringed().length)).toBeGreaterThan(5);
  const n = Number((await hint.textContent())!.match(/the (\d+) subjects/)![1]);
  expect(await page.evaluate(() => window.__dst!.ringed().length)).toBe(n);
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => window.__dst!.ringed().length)).toBe(0);
});

test('US-027 / US-032: a transdisciplinary subject fills its own slot without choosing the stream, not the free electives', async ({ page }) => {
  // 95009 is in the Transdisciplinary Electives stream; 31061 and 32130 are listed nowhere in the degree.
  // The stream's slot is now the "one transdisciplinary elective (6cp)" part of way 4 (US-035).
  const panel = await outline(page, 'c=95009.31061.32130');
  await openWay(panel, 3);
  const tde = panel.locator('[data-testid="outline-part"][data-what="stream"]');
  await expect(tde).toHaveAttribute('data-status', 'complete');
  await expect(tde.getByTestId('outline-part-cp')).toHaveText('6/6cp');
  await expect(tde).toContainText('✓');
  const free = panel.getByTestId('free-electives').first();
  await expect(free).toContainText('31061');
  await expect(free).not.toContainText('95009');
  // With nothing done in it, the stream's slot is untouched rather than "started".
  const empty = await outline(page, 'c=');
  await openWay(empty, 3);
  await expect(empty.locator('[data-testid="outline-part"][data-what="stream"]')).toHaveAttribute('data-status', 'none');
});

test('US-033: the degree panel shows the total, and the chip brings it back while a subject is open', async ({ page }) => {
  const panel = await outline(page, 'c=41039&p=31265');
  await expect(panel.getByTestId('progress-total')).toHaveText('6+6/144cp');
  await expect(page.getByTestId('degree-chip')).toHaveCount(0); // not while the degree's own panel is open
  // Hovering the total glows the degree circle.
  expect(await page.evaluate(() => window.__dst!.glowing())).toEqual([]);
  await panel.getByTestId('degree-total').hover();
  await expect.poll(() => page.evaluate(() => window.__dst!.glowing())).toEqual(['C10148']);

  await goTo(page, '31268');
  const chip = page.getByTestId('degree-chip');
  await expect(chip).toContainText('Bachelor of Information Technology');
  await expect(chip.getByTestId('progress-total')).toHaveText('6+6/144cp');
  await chip.getByRole('button', { name: /Bachelor/ }).click();
  await expect(panel.locator('h2')).toHaveText('Bachelor of Information Technology');
  await expect(chip).toHaveCount(0);
});

test('US-033: hovering outline rows, program lines and subjects glows them on the map', async ({ page }) => {
  const panel = await outline(page, 'c=');
  const glowing = () => page.evaluate(() => window.__dst!.glowing().sort());
  const ringed = () => page.evaluate(() => window.__dst!.ringed().sort());
  expect([await glowing(), await ringed()]).toEqual([[], []]);
  // A heading glows everything it names, and everything named below it.
  await heading(panel, 'Compulsory').hover();
  await expect.poll(ringed).toEqual([...COMPULSORY].sort());
  // A program line glows its circle.
  await panel.locator('[data-testid="outline-program"][data-code="MAJ03444"]').first().getByRole('button').hover();
  await expect.poll(glowing).toEqual(['MAJ03444']);
  // A way glows everything that could fill it.
  await way(panel, 1).hover();
  await expect.poll(async () => (await glowing()).length).toBeGreaterThan(10);
  expect((await glowing()).every((c) => c.startsWith('SMJ'))).toBe(true);
  await page.mouse.move(5, 5);
  await expect.poll(glowing).toEqual([]);
});

test('US-034: headings and ways open and close, and ways start closed even when started', async ({ page }) => {
  const panel = await outline(page, 'm=SMJ08198&c=24210');
  // Way 2 has a chosen sub-major with a subject done, and still starts closed.
  await expect(way(panel, 1)).toHaveAttribute('data-status', 'started');
  for (let i = 0; i < 4; i++) await expect(way(panel, i)).toHaveAttribute('data-open', 'false');
  await expect(panel.getByTestId('outline-way-body')).toHaveCount(0);
  await way(panel, 1).click();
  await expect(panel.getByTestId('outline-way-body')).toContainText('Advertising Principles');
  await way(panel, 1).click();
  await expect(panel.getByTestId('outline-way-body')).toHaveCount(0);

  // Headings start open; closing one hides what is under it.
  const compulsory = heading(panel, 'Compulsory');
  await expect(compulsory).toHaveAttribute('data-open', 'true');
  await expect(panel.getByRole('button', { name: /31265/ })).toBeVisible();
  await compulsory.click();
  await expect(compulsory).toHaveAttribute('data-open', 'false');
  await expect(panel.getByRole('button', { name: /31265/ })).toHaveCount(0);
  // Keyboard works too.
  await compulsory.press('Enter');
  await expect(panel.getByRole('button', { name: /31265/ })).toBeVisible();
});

test('US-035: each Options way lists its parts and what fills them, and the grouping Electives heading is gone', async ({ page }) => {
  const panel = await outline(page, `m=SMJ08198&c=${ADV.join('.')}.32130&p=95009`);
  // The Bachelor of IT groups "Electives (18cp)" and "Transdisciplinary Electives (6cp)" under "Electives (24cp)".
  await expect(heading(panel, 'Electives')).toHaveCount(0);
  await expect(heading(panel, 'Transdisciplinary Electives')).toHaveCount(0);
  await expect(heading(panel, 'Free Electives')).toHaveCount(0);
  await expect(heading(panel, 'Majors')).toHaveCount(0);
  await expect(heading(panel, 'Sub-Majors')).toHaveCount(0);

  // Way 3: a sub-major part and an electives part, each with its own numbers.
  await openWay(panel, 2);
  const parts = panel.getByTestId('outline-part');
  await expect(parts).toHaveCount(2);
  await expect(parts.nth(0)).toContainText('one sub-major (24cp)');
  await expect(parts.nth(0).getByTestId('outline-part-cp')).toHaveText('24/24cp');
  await expect(parts.nth(0)).toHaveAttribute('data-status', 'complete');
  await expect(parts.nth(1)).toContainText('four electives (24cp)');
  await expect(parts.nth(1).getByTestId('outline-part-cp')).toHaveText('6/24cp');
  await expect(way(panel, 2).getByTestId('outline-way-cp')).toHaveText('30/48cp');
  const body = panel.getByTestId('outline-way-body');
  await expect(body.locator('[data-testid="outline-program"][data-code="SMJ08198"]')).toHaveAttribute('data-status', 'complete');
  await expect(body.getByTestId('free-electives')).toContainText('32130');

  // Way 4: the stream part lists the stream, planned in purple.
  await way(panel, 2).click();
  await openWay(panel, 3);
  const stream = panel.locator('[data-testid="outline-part"][data-what="stream"]');
  await expect(stream.getByTestId('outline-part-cp')).toHaveText('0+6/6cp');
  await expect(stream).toHaveAttribute('data-status', 'planned');
  await expect(panel.getByTestId('outline-way-body').locator('[data-testid="outline-program"][data-code="CBK92069"]')).toBeVisible();

  // Way 1 has one part, so its majors are listed straight under it.
  await way(panel, 3).click();
  await openWay(panel, 0);
  await expect(panel.getByTestId('outline-part')).toHaveCount(0);
  await expect(panel.getByTestId('outline-way-body').getByTestId('outline-program')).toHaveCount(6);
});

test('US-035: degrees without numbered ways keep their headings', async ({ page }) => {
  await openTree(page, 't=uts-2027&d=C10476');
  await goTo(page, 'C10476');
  const panel = page.getByTestId('detail-panel');
  await expect(panel.getByTestId('outline-way')).toHaveCount(0);
  await expect(heading(panel, 'Electives')).toHaveCount(2); // the 24cp group and the 18cp free electives inside it
  await expect(heading(panel, 'Transdisciplinary Elective')).toHaveCount(1);
});

test('US-036: a major counting under one requirement is not listed under another', async ({ page }) => {
  const program = (panel: ReturnType<Page['getByTestId']>, code: string) => panel.locator(`[data-testid="outline-program"][data-code="${code}"]`);
  // Nothing chosen: Data Analytics is in both "Major - Information Technology" and way 1's majors.
  let panel = await outline(page, 'c=');
  await openWay(panel, 0);
  await expect(program(panel, 'MAJ02081')).toHaveCount(2);
  await expect(program(panel, 'MAJ02092')).toHaveCount(2);

  // Data Analytics counts under Major, Interaction Design under Options: each is listed once.
  panel = await outline(page, 'm=MAJ02081.MAJ02092');
  await openWay(panel, 0);
  await expect(program(panel, 'MAJ02081')).toHaveCount(1);
  await expect(program(panel, 'MAJ02092')).toHaveCount(1);
  await expect(panel.getByTestId('outline-way-body').locator('[data-code="MAJ02081"]')).toHaveCount(0);
  await expect(heading(panel, 'Major - Information Technology').locator('xpath=..').locator('[data-code="MAJ02092"]')).toHaveCount(0);
  await expect(panel).not.toContainText('counts under');
});

test('US-037: choosing 2 majors crosses out every other major and sub-major, and unchoosing one brings them back', async ({ page }) => {
  const program = (panel: ReturnType<Page['getByTestId']>, code: string) => panel.locator(`[data-testid="outline-program"][data-code="${code}"]`).first();
  // Programs crossed out by US-037's rules; not locked degrees (US-047) or what only a double offers (US-048).
  const locked = () =>
    page.evaluate(() => {
      const why = window.__dst!.lockReasons();
      return window.__dst!.locked().filter((c) => why[c] && why[c] !== 'pairing').sort();
    });
  // Nothing locked with one major.
  let panel = await outline(page, 'm=MAJ02081');
  await openWay(panel, 1);
  await expect(program(panel, 'SMJ08198')).not.toHaveAttribute('data-status', 'locked');
  // With one major there is room for everything; only programs sharing its subjects are out.
  const oneMajor = await locked();
  expect(oneMajor).toEqual(['MAJ02080', 'SMJ02065']);

  // Data Analytics and Interaction Design: no room for a third major or any sub-major.
  panel = await outline(page, 'm=MAJ02081.MAJ02092');
  await openWay(panel, 1);
  await expect(program(panel, 'SMJ08198')).toHaveAttribute('data-status', 'locked');
  await expect(program(panel, 'SMJ08198')).toContainText('✗');
  await expect(program(panel, 'SMJ08198')).toHaveAttribute('title', /^No room: with .*Data Analytics \(major\).*Interaction Design \(major\)/);
  await expect(program(panel, 'MAJ03444')).toHaveAttribute('data-status', 'locked');
  await expect.poll(async () => (await locked()).length).toBe(25);
  expect(await locked()).toEqual(expect.arrayContaining(['MAJ03444', 'SMJ08198', 'SMJ10156']));
  expect(await locked()).not.toContain('MAJ02081');

  // Its own panel says why and will not let it be chosen.
  await goTo(page, 'MAJ03444');
  const detail = page.getByTestId('detail-panel');
  await expect(detail.getByTestId('lock-note')).toHaveAttribute('data-why', 'room');
  await expect(detail.getByRole('button', { name: 'Choose this major' })).toBeDisabled();

  // Unchoose Interaction Design: the others come back, as they were with one major.
  await goTo(page, 'MAJ02092');
  await detail.getByRole('button', { name: '✓ Chosen' }).click();
  await expect.poll(locked).toEqual(oneMajor);
  await goTo(page, 'MAJ03444');
  await expect(detail.getByTestId('lock-note')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Choose this major' })).toBeEnabled();
});

test('US-037: a completed sub-major locked out by the major that shares its subjects shows a cross, not a green tick or glow', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  // Every Data Analytics sub-major subject (bar the unpublished 31256) is done, so on its own it is complete.
  await outline(page, `m=MAJ02081&c=${DA.join('.')}`);
  expect(await page.evaluate(() => window.__dst!.finished()['SMJ02065'])).toBeUndefined();
  expect(await page.evaluate(() => window.__dst!.finished()['MAJ02081'])).toBe('complete');
  expect(await page.evaluate(() => window.__dst!.locked())).toContain('SMJ02065');
  expect((await page.evaluate(() => window.__dst!.title('SMJ02065')))!.progress).toMatch(/✗$/);
  await goTo(page, 'SMJ02065');
  const note = page.getByTestId('detail-panel').getByTestId('lock-note');
  await expect(note).toHaveAttribute('data-why', 'overlap');
  await expect(note).toContainText('Data Analytics (major)');

  // With no degree selected, no program is crossed out by US-037's rules (add-on halves and what only a
  // double offers stay locked: US-048, US-049), and it glows green on its own again.
  await page.getByTestId('degree-picker').selectOption('');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const why = window.__dst!.lockReasons();
        return window.__dst!.locked().filter((c) => why[c] && why[c] !== 'pairing');
      }),
    )
    .toEqual([]);
  expect(await page.evaluate(() => window.__dst!.finished()['SMJ02065'])).toBe('complete');
});

test('US-038: a chosen sub-major that cannot count is shown locked, counts nothing, and can be unchosen', async ({ page }) => {
  const DA = ['33116', '31250', '31005', '32146', '42050', '41759', '48024', '42028'];
  const panel = await outline(page, `m=MAJ02081.SMJ02065&c=${DA.join('.')}`);
  // Only the major's 48cp count; the sub-major adds nothing.
  await expect(panel.getByTestId('progress-total')).toHaveText('48/144cp');
  await expect(heading(panel, 'Options').last().getByTestId('outline-cp')).toHaveText('(0/48cp)');
  await goTo(page, 'SMJ02065');
  const detail = page.getByTestId('detail-panel');
  await expect(detail.getByTestId('lock-note')).toContainText('Chosen, but cannot count towards Bachelor of Information Technology');
  await detail.getByTestId('unchoose').click();
  await expect(page).not.toHaveURL(/SMJ02065/);
  await expect(detail.getByTestId('lock-note')).toContainText('Cannot count towards');
  await expect(detail.getByRole('button', { name: 'Choose this sub-major' })).toBeDisabled();
});
