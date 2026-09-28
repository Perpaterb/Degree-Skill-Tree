# Tech From User Stories

One entry per story: what was actually built, and the files added or changed.
Stories are in [`UserStories.md`](UserStories.md).

---

### US-001 Pull the UTS handbook catalogue
- The handbook is a CourseLoop Next.js site. Item lists come from its search API
  (`POST /api/search/search-academic-items`, filter `implementationYear`, max page size 100). All
  results share one relevance score, so deep paging is unstable between requests; the lister repeats
  full passes and unions them until the count matches the reported total.
- Item detail is read from each page's embedded `__NEXT_DATA__` (`props.pageProps.pageContent`); only
  that JSON is cached, not the ~160 KB of HTML.
- Politeness: `robots.txt` disallows crawling, and CloudFront returned 403 after a few hundred requests
  at 4/s on 24 Sep 2026. All fetches are throttled (`SCRAPE_GAP_MS`), cached on disk under
  `data/raw/<year>/` (gitignored), and the first 403 raises `BlockedError`, which stops every queued
  request and exits with code 2.
- `slice <COURSE>` command pulls one course and everything it reaches (areas of study recursively,
  their subjects, requisites, one hop of requisite subjects) and writes a manifest.
- `report <COURSE>` summarises a slice (in scope / fetched / failed) to stdout and
  `data/reports/coverage-<year>-<course>.json`, exiting 1 if any in-scope item is missing.
- First slice, 24 Sep 2026, 2027 handbook, C10148 at 1 request / 3 s: 1 course, 28 areas of study,
  195 subjects, 64 requisite-only subjects. 404s: SMJ10196, 6 structure subjects, 36 requisite-only
  subjects (mostly retired subjects kept as OR alternatives in requisite rules).
- Files: `scraper/src/http.ts`, `scraper/src/handbook.ts`, `scraper/src/cli.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `data/reports/coverage-2027-C10148.json`.

### US-002 Pull prerequisites
- Requisites are not in the handbook; they come from
  `studentforms.uts.edu.au/evop/access/search.cfm?subjectcode=<code>` (no robots.txt on that host).
- `parseRule` is a precedence parser (OR of ANDs) over item refs such as `1`, `2a`; it throws on
  unbalanced or trailing tokens. `classifyItem` types each item as subject, course, credit-point
  condition (`min`, `scope`) or text.
- Tests use four real saved pages as fixtures. Verified the tests can fail: making OR parse as AND
  turns 4 of 10 tests red.
- Files: `scraper/src/access.ts`, `scraper/test/access.test.ts`, `scraper/test/fixtures/ac_*.html`.

### US-003 Normalise into the generic model
- Generic model in `core/model.ts`: `TreeDoc` (one degree), `Program`, `Subject`, `Container`
  ("complete N cp from these children and items"; `kind: 'free'` for free electives), `Rule`
  (and/or over subject, course, credit-point and text conditions) and `StudyPlan`.
- `scraper/src/normalize.ts` builds a `TreeDoc` from a pulled slice: resolves requisite refs into
  self-contained rules (`toRule`), follows programs recursively, adds one hop of requisite subjects,
  and keeps anything the handbook year lacks as `legacy: true` with the title the referrer used.
- `npm run scrape -- normalize <COURSE>` writes `web/public/trees/<id>.json` and `index.json`.
  C10148 (2027): 28 programs, 259 subjects, 42 legacy; ~500 KB.
- Tests read the committed tree (data checks, no network) and run `toRule` against a real fixture.
- Files: `core/model.ts`, `scraper/src/normalize.ts`, `scraper/src/cli.ts`, `scraper/test/normalize.test.ts`,
  `web/public/trees/uts-2027-C10148.json`, `web/public/trees/index.json`, `tsconfig.json`.

### Core engine (supports US-007, US-008, US-009)
- `core/engine.ts`: `ruleMet`, `computeStates` (completed / planned / available / reachable / locked /
  excluded / legacy), `missingFor` (cheapest subject set to unlock a node; OR branches by fewest extra
  cp, legacy subjects avoided), `unlockedBy`, `progress` (credit points per container, each subject
  claimed once in structure order, free electives take leftovers), `encodePlan` / `decodePlan`.
- Assumptions, documented in code: course conditions are met by the tree's own degree; credit-point
  conditions are checked against credit points held; free-text conditions count as met and are shown.
- `scripts/verify-tests-fail.sh` (`npm run test:verify-fails`) plants 7 known bugs one at a time and
  requires red for each. First run exposed that double counting was untested; fixed by listing a core
  subject in the test major. Result 24 Sep 2026: 7/7 caught.
- Files: `core/engine.ts`, `core/engine.test.ts`, `scripts/verify-tests-fail.sh`, `package.json`.

### US-004 Explore a degree as a skill tree
- `core/layout.ts` (pure, tested): degree hub at the origin with core subjects on orbits around it;
  each program (major/sub-major/stream) is a cluster centred on a program node, clusters on rings
  (the degree's named majors inner, option programs outer, nested programs further out). Within a
  cluster, orbits are by requisite depth, foundations inside. Requisite-only subjects join the
  cluster where most of their dependents live. Cluster size comes from a dry run of the real
  placement. An earlier overlap-relaxation pass was removed: the mutation check showed it never
  changed anything.
- `web/src/TreeCanvas.tsx`: PixiJS v8 + pixi-viewport (drag, pinch, wheel, decelerate, clamp zoom).
  Node looks per state in `web/src/theme.ts`; cross-cluster links drawn quietly unless relevant;
  labels hide when zoomed out. An in-app frame counter writes `document.body.dataset.fps`.
- Performance: `e2e/perf.spec.ts` (`npm run test:perf`) runs on the real GPU via headless Chromium
  with ANGLE on Vulkan. Functional E2E uses SwiftShader, whose frame rate (about 7fps) is meaningless.
- Files: `core/layout.ts`, `core/layout.test.ts`, `web/src/TreeCanvas.tsx`, `web/src/theme.ts`,
  `web/src/App.tsx`, `web/src/main.tsx`, `web/src/styles.css`, `web/index.html`, `vite.config.ts`,
  `e2e/perf.spec.ts`, `e2e/stories.spec.ts`.

### US-005 Inspect a subject
- `DetailPanel` in `web/src/Panels.tsx`: subject detail, plain-language requisite tree (`RuleView`;
  runs of identical credit-point alternatives collapse into one line), anti-requisites, "leads to",
  recommended study, description, learning outcomes, offerings, handbook link. Program and degree
  nodes show their structure. Legacy subjects explain they are not in this year's handbook.
- Files: `web/src/Panels.tsx`, `web/src/store.ts`.

### US-006 Search the tree
- `matchesFor` in `web/src/store.ts`: programs first, then code/title matches, then description
  matches. Matches glow on the canvas and everything else dims; Enter flies to the next match.
- Files: `web/src/store.ts`, `web/src/Panels.tsx` (`TopBar`), `web/src/TreeCanvas.tsx`.

### US-007 Mark what I have done
- Zustand store holds the plan; every change recomputes `computeStates` and saves to
  `localStorage` (`dst.plan.<treeId>`) and the URL hash (`#t=<tree>&c=...&p=...&m=...`, via
  `replaceState`). A link carrying a plan wins over local storage.
- Files: `web/src/store.ts`, `web/src/App.tsx`, `core/engine.ts`.

### US-008 See what unlocks what
- Hover (or selection) runs `missingFor` and `unlockedBy`; the canvas draws the missing chain in cyan
  and unlocks in violet and dims the rest. The panel lists the chain and non-subject conditions.
- Files: `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`.

### US-009 Plan a path to my degree
- Program nodes toggle "chosen" from the panel; `progress()` feeds the collapsible progress panel
  (done in gold, planned in green, per container).
- Files: `web/src/Panels.tsx` (`ProgressPanel`, `ProgramDetail`), `web/src/store.ts`.

### US-017 Host on GitHub Pages
- `vite.config.ts` builds to `dist/` with base `/Degree-Skill-Tree/`. `.github/workflows/deploy.yml`
  is manual (`workflow_dispatch`) with a `tests` input (`all` / `unit` / `none`), never cancels a
  running deploy (`concurrency: pages`, `cancel-in-progress: false`), and smokes the live URL after
  deploying.
- `scripts/smoke.sh --target <url>` checks the static files, then runs the E2E stories against the target.
- `scripts/story-coverage.mjs` reports stories with an E2E test (24 Sep 2026: 6/18).
- E2E stability: readiness waits get 20s (first load under parallel software GL can exceed 5s),
  and workers are capped at 4. Three consecutive full runs: 11/11.
- Files: `.github/workflows/deploy.yml`, `scripts/smoke.sh`, `scripts/story-coverage.mjs`,
  `playwright.config.ts`, `e2e/helpers.ts`, `vitest.config.ts`, `package.json`.

### US-018 Usage analytics without personal data (later)
- `web/src/analytics.ts`: `track(event, props)` no-op (logs in dev). Called for course opened, node
  inspected, subject marked, program toggled, search used, plan shared.
- Files: `web/src/analytics.ts`, `web/src/store.ts`, `web/src/Panels.tsx`.

### US-017 Host on GitHub Pages: first deploy (24 Sep 2026)
- Pages enabled with the Actions build type. Live at <https://perpaterb.github.io/Degree-Skill-Tree/>.
- Runs 35965382636 and 35965711410 (scope `all`) were blocked by the E2E gate: the share-link test
  (US-007) failed on the runner, first by running past its time limit, then by the app not showing
  its progress panel within 20s after a reload. Not reproducible locally, including on 2 pinned cores.
  Mechanism fixes: wait for readiness after the reload instead of navigating again, `test.slow()`,
  two CI workers; traces and screenshots are now kept and uploaded on failure.
- Run 35966554412 (scope `all`): build, deploy and live smoke all passed. **Open:** the reload failure
  is intermittent on CI and its cause is not yet known; the next failing run will have a trace.

### Local development in containers (tooling, no story)
- `Dockerfile` (Node 22, runs as uid 1000) and `docker-compose.yml`:
  `docker compose up` runs the Vite dev server on :5173 with polling file watch (`VITE_POLL`),
  verified to hot-update the browser from host edits; `docker compose run --rm test` runs unit and
  E2E in `mcr.microsoft.com/playwright:v1.63.0-noble` (38 + 11 passed) and hands its output back to
  uid 1000; `tools` runs any npm script. `@playwright/test` is pinned to exactly 1.63.0 to match the image.
- Files: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `vite.config.ts`, `package.json`,
  `package-lock.json`, `README.md`.

### US-019 Several degrees on one map
- Model: `TreeDoc` (one degree) became `MapDoc` (schema 2): `degrees`, shared `programs` and
  `subjects`, and an optional precomputed `layout`. `buildMap` in `scraper/src/normalize.ts` merges
  any number of pulled degrees; `normalize` writes `web/public/trees/uts-2027.json` (930 KB) and an
  index listing the degrees.
- Pulled 24 Sep 2026 at 1 request / 3 s, no blocks: C10476 (16 areas, 148 subjects), C10471
  (9, 119), C10026 (43, 235). Map: 4 degrees, 70 programs, 399 subjects (57 legacy). Reports in
  `data/reports/coverage-2027-*.json`.
- Scraper fixes found on the way: a rename broke the CLI mid-pull (two degrees finished, Business
  never started); per-course failure files replaced one shared file that each slice overwrote.
- Old links: `resolveMapId` turns `uts-2027-C10148` into map `uts-2027` with that degree selected.
- Files: `core/model.ts`, `scraper/src/normalize.ts`, `scraper/src/cli.ts`, `web/src/store.ts`,
  `web/src/App.tsx`, `scraper/test/normalize.test.ts`, `e2e/multidegree.spec.ts`.

### US-020 Degrees and majors as enclosing circles
- `core/layout.ts` rewritten as an Euler-diagram layout: a deterministic force simulation pulls each
  subject toward every group it belongs to (programs strongly, degrees weakly), anchors only subjects
  exclusive to one degree to that degree's region (anchoring shared ones stretched every group they
  were in), pushes apart programs that share nothing, and resolves collisions. Circles are minimal
  enclosing circles (Welzl): programs around their subjects and nested programs, degrees around their
  subjects and program circles, so containment holds by construction. Twin programs (identical
  circles) are grown apart by 24 units. Runs at build time (~1 s) and is stored in the map.
- Quality measure `foreignInside` (subjects inside a circle that does not list them) has a regression
  budget in `core/layout.test.ts`: 2069 on the first four-degree layout, 2087 after separating twins.
- Picking: `circleAt` (smallest containing circle, ties by nearest centre; within a 10 px rim band,
  the nearest outline wins). Pixi's own draw-order hit test was dropped: equal radii hid whole
  circles. A unit test proves every circle on the real map has a spot that resolves to it.
- Hover: Pixi listens for pointer moves on the whole document, so hover over DOM panels leaked to
  the canvas underneath; hover now only counts when the native target is the canvas, and clears
  on pointer leave.
- Files: `core/layout.ts`, `core/layout.test.ts`, `web/src/TreeCanvas.tsx`, `web/src/theme.ts`.

- **Replaced 24 Sep 2026** by a railway-map layout (the overlapping Euler version was too cluttered).
  `core/layout.ts`: circles never overlap; a program listed by one degree or program nests inside it,
  one listed by several sits at the top level. Each circle gets its own copy of every subject it lists
  (`LayoutNode.id` is `<circle>/<code>`, `copiesOf` finds them); copies share one state on the canvas.
  Inside a circle, subjects sit on rings by prerequisite depth (loops in the source data broken by a
  depth-first walk). Circles are packed with `d3-hierarchy` (new dependency). `foreignInside` is gone.
- Canvas: selecting or hovering one copy lights every copy; copies inside the selected degree stay
  bright, the rest fade. Unit tests cover containment, no partial overlap, no overlapping copies,
  determinism against the stored layout; E2E test "selecting a subject lights up every copy".
- Files: `core/layout.ts`, `core/layout.test.ts`, `web/src/TreeCanvas.tsx`, `web/public/trees/uts-2027.json`,
  `scraper/src/cli.ts`, `package.json`, `package-lock.json`, `e2e/multidegree.spec.ts`.

- 25 Sep 2026, feedback from testing:
  - Copies of a marked (completed or planned) subject now all look the same: entry copies use the
    full state look (keeping only a thin outer line as the doorway mark), and marked copies are not
    faded for being outside the selected degree.
  - Every copy of the hovered subject grows (at least 1.4x, and at least 18 px radius on screen at any
    zoom), is raised above other subjects, gets a cyan halo and shows its code; copies of the selected
    subject do the same at 1.25x / 14 px. Scaling lives in `applyLod`, so it follows zoom.
  - Each subject's pointer hit area is its own disc (`hitArea`), not its glow and rings, so hover ends
    as soon as the pointer leaves the enlarged circle. E2E test moves just outside the disc, inside the
    glow, and expects hover to end; it fails without the hit area.
  - Circle titles moved above their circles. The layout wraps each title (`titleBox`, generous glyph
    width) and packs every circle by the disc around the circle and its title, so a title cannot touch
    another circle, title or subject, and stays inside the circles around it. Degree titles are now a
    fixed 160 world units instead of growing when zoomed out. The map grew from about 9820 x 9599 to
    11284 x 10641 world units.
  - Tests: layout tests for title placement and clearance; E2E tests that all 18 copies of 41039 look
    the same once completed (with a degree selected) and that hovering one pops out all 18. Both E2E
    tests were seen to fail with the old drawing; two packing mutations added to the mutation check.
  - Files: `core/layout.ts`, `core/layout.test.ts`, `web/src/TreeCanvas.tsx`, `e2e/multidegree.spec.ts`,
    `scripts/verify-tests-fail.sh`, `web/public/trees/uts-2027.json`.

### US-021 Select a degree and work backwards
- `Plan.degree` (URL `d=`), `selectDegree` in the store; course conditions are evaluated against the
  selected degree (any degree on the map when none is selected). Top-bar picker (alphabetical) and
  degree circles both select. Selected degree: other degrees dim; still-needed compulsory subjects of
  the degree and chosen programs get gold rings; subjects outside it fade.
- Program panel offers Choose only when the selected degree offers the program, otherwise lists the
  degrees that do.
- Files: `core/engine.ts`, `web/src/store.ts`, `web/src/Panels.tsx`, `web/src/TreeCanvas.tsx`.

### US-022 Progress panel for the selected degree
- `progress(map, degree, plan)`; each row carries `refs` (programs and subjects it names). The panel
  renders only with a degree; hovering or focusing a row sets `glow`, which the canvas draws in cyan.
- Files: `core/engine.ts`, `web/src/Panels.tsx`, `web/src/store.ts`, `web/src/TreeCanvas.tsx`.

- 25 Sep 2026: completed subjects that do not count (`compatibility(...).wasted`) are listed at the
  bottom of the panel under "Completed, but not counting", each with its reason as a tooltip.
  E2E: "completed subjects that do not count are listed under the selected degree".
- Files: `web/src/Panels.tsx`, `web/src/styles.css`, `e2e/multidegree.spec.ts`.

### US-023 See which degrees are still open
- `compatibility(map, degree, plan)`: a completed subject counts if the degree (or any program it
  offers) lists it, else while free-elective room remains; impossible if it is an anti-requisite of a
  compulsory subject. Ignores option-group caps inside programs, so it can overstate, never understate.
  Grey = wasted cp / completed cp (1 when impossible). Degree panel lists what is in the way and why.
- Real-data check: six compulsory Business subjects count 36/36 toward Business and 18/36 toward
  Computing Science and Cybersecurity (18 cp of free electives each).
- **Open question:** anti-requisites often mark equivalent subjects that faculties accept in place of
  each other (e.g. 48023 is an anti-requisite of 41039, which Computing Science requires). The
  approved "impossible" rule therefore marks degrees impossible that are, in practice, usually fine.
- Files: `core/engine.ts`, `core/engine.test.ts`, `web/src/Panels.tsx`, `web/src/TreeCanvas.tsx`, `e2e/multidegree.spec.ts`.

### US-024 Railway-style connections
- Links are routed in `core/layout.ts` as railway lines: out along a spoke, along a ring-following
  track in the gap between rings, in along a spoke, with rounded corners (path commands M/L/A/Q).
  Tracks are assigned by interval scheduling so no two arcs share a track; parallel spokes are spread
  apart; links that skip rings go through corridors between subjects. A prerequisite not listed by a
  circle appears inside it as a hollow "entry" copy, so no link leaves its circle.
- `core/linkQuality.ts` measures crossings, crossing angles, pairs running together and links passing
  over a subject; the build prints it. First measured 25 Sep 2026: 9 shallow crossings, 19 pairs
  running together, 34 links over a subject.
- 25 Sep 2026, all three brought to 0 (asserted exactly in `core/layout.test.ts`):
  - Loops in the source data (e.g. Japanese 97207 to 97210 each accept any of the others) were broken
    into a chain of rings stacked at one angle, so loop links ran back across the subjects in between
    (all 34 "over a subject" cases). Loops are now found as strongly connected groups (Tarjan) and a
    whole group shares one ring, so loop links only run sideways on the track outside it.
  - A link skipping rings picked a corridor clear of subjects on the rings it passes through, but not
    of the other subjects on its start and end rings, whose spokes share those gaps. It now keeps off
    them too (`clearEnd`); this removed the last shallow crossing and the last pairs running together.
  - The "running together" measure used the distance to a segment's extended line, so short pieces in
    line but up to 18 units apart counted (the earlier budget of 43 was 19 real pairs). It now uses the
    real distance between segments (`segmentGap`). `core/linkQuality.test.ts` proves each measure fires
    on a known bad case, and does not fire on in-line segments 15 units apart.
  - Tried and dropped: shrinking corners that sit beside another link's spoke. After the two fixes
    above it changed no measure, so it was not kept.
- Known clutter: a loop of n subjects draws n(n-1) links (12 for the Japanese four), as a bundle of
  parallel tracks. Correct, but busy; could be drawn as one "any of these" group later.
- Mutation check (`scripts/verify-tests-fail.sh`) gained layout mutations for ring spacing wrap, entry
  copies, loop grouping, corridor end clearance, and the running-together measure; all 18 caught on
  25 Sep 2026. Loop grouping and corridor clearance were also checked to turn the quality tests red on
  their own, not only the stored-layout comparison.
- Files (25 Sep 2026): `core/layout.ts`, `core/linkQuality.ts`, `core/linkQuality.test.ts`,
  `core/layout.test.ts`, `scripts/verify-tests-fail.sh`, `web/public/trees/uts-2027.json`.
- Files: `core/layout.ts`, `core/linkQuality.ts`, `core/layout.test.ts`, `web/src/TreeCanvas.tsx`,
  `scraper/src/cli.ts`, `scripts/verify-tests-fail.sh`.

### Dev container reinstalls after dependency changes (tooling, no story)
- `node_modules` lives in a Docker volume that outlives image rebuilds, so a new dependency (d3-hierarchy)
  was missing in the container. `scripts/dev-entrypoint.sh` reinstalls when `package-lock.json` differs
  from the stamp saved at the last install.
- Files: `Dockerfile`, `scripts/dev-entrypoint.sh`.

### US-025 Warn before marking completed without prerequisites
- `prerequisiteGap(map, code, completed, enrolled)` in `core/engine.ts`: null when the requisite rule
  is met by completed subjects alone (planned ones do not count), else `missingFor`'s subjects and
  notes plus `alternatives` (the rule has an OR). It tests the rule directly, not the node state,
  because a planned subject's state is "planned" whatever its prerequisites.
- `missingFor` no longer lists a credit-point condition that is already met (it did, which would have
  put a false "at least 72cp completed" in the dialog and in "To unlock").
- `PrerequisiteWarning` in `web/src/Panels.tsx`: the Mark completed button calls it when there is a
  gap. Close, Escape and a click on the backdrop close it; "Mark as completed anyway" marks. Rendered
  through a portal on `document.body`: inside the panel, the panel's `backdrop-filter` confines a
  fixed-position backdrop to the panel, and a click beside the dialog reached the map (caught by the
  E2E test).
- 25 Sep 2026, after testing with 41001 (six alternatives, the dialog showed one): the dialog now
  renders the requisite rule in full (`PrerequisiteRule`, like `RuleView` with state dots), and under
  each option not yet completed a note from `prerequisiteGap` for that option: "needs 97101 first",
  or "needs its own prerequisites first, for example 48023" when it has alternatives of its own.
  `prerequisiteGap` still decides whether the dialog opens. New E2E: all six 41001 options listed.
- Tests: unit tests for `prerequisiteGap` and the met credit-point note; `e2e/prerequisites.spec.ts`
  walks the flow (planned prerequisites still warn, Close/Escape/outside change nothing, Mark anyway
  survives a reload, un-marking never asks, no warning when prerequisites are met or absent). The
  main E2E test was seen to fail with the warning disabled. Dialog checked by screenshot at desktop
  and phone widths.
- Files: `core/engine.ts`, `core/engine.test.ts`, `web/src/Panels.tsx`, `web/src/styles.css`,
  `e2e/prerequisites.spec.ts`.

### US-022 counting numbered ways and "one of the following" (25 Sep 2026)
- `progress()` is now a wrapper over `measure()` in `core/engine.ts`, which `programProgress()` shares.
  A container described as "... one of the following ..." counts its best child, not the sum. A
  container whose text lists numbered ways (`parseWays`: "1. one major (48cp); 2. two sub-majors
  (2 x 24cp); ...") is read into parts (majors, sub-majors, transdisciplinary streams, elective cp)
  and counts its best way; each way's done / planned is kept on `Progress.ways`. A way the parser
  cannot read is kept, marked not understood, and not counted.
- Before and after on real data (all four degrees, five plans each, 243 progress rows): only the
  "two sub-majors" plans changed. Bachelor of IT Options 24/48 -> 48/48; Bachelor of Business Options
  24/48 -> 42/48 (Advertising and Advanced Advertising share a subject, which counts once).
- Normaliser: a structure's root container took its id from an object (`[object Object]` on every
  program); it now uses `structure_cl_id`. All 278 container ids on the map are unique (tested).
- Tests: `core/progress.test.ts` (both real options texts parsed exactly, two sub-majors, electives
  way, planned on top of the best way, best child of a choice, statuses); mutation check gained
  choose-one, ways and way-chosen mutations (23 of 23 caught). The fixture's Sub-Majors heading is
  worth one sub-major, as in the handbook; with 24cp it did not tell the two counts apart.
- Files: `core/engine.ts`, `core/progress.test.ts`, `scraper/src/normalize.ts`,
  `scraper/test/normalize.test.ts`, `scripts/verify-tests-fail.sh`, `web/public/trees/uts-2027.json`.

### US-009 planned subjects blue (25 Sep 2026)
- `stateLook.planned` is fill `#16295c`, ring `#4c8dff` (was green); CSS `--planned`, `--planned-deep`
  replace `--green` for the Plan it button, planned numbers and progress bars. "Available now" keeps
  its dark fill and pale `#86b6ff` ring. E2E checks the drawn fill and ring of a planned copy.
- Files: `web/src/theme.ts`, `web/src/styles.css`, `e2e/multidegree.spec.ts`.

### Transdisciplinary stream counted without choosing it (US-022, US-027; 25 Sep 2026)
- Bug: "Transdisciplinary Electives (6cp)" names only the stream CBK92069, which nobody "chooses",
  so `measure` never walked it and a completed 950xx subject fell into free electives. The stream's
  own line was ticked (worked out alone) while its slot showed 0/6cp.
- `measure` in `core/engine.ts` treats a program that is a requirement's only item as chosen and
  marks its node `implied`. An implied program does not make its way or parents "started" until
  something in it is done or planned (`hasChosen`, way `chosenHere`, `programStatus` in
  `web/src/Panels.tsx`). In the 2027 data this only applies to the transdisciplinary streams.
- Tests: `core/progress.test.ts` (fails on the old engine), `e2e/outline.spec.ts`. The
  `core/engine.test.ts` "unchosen major" test now uses a local degree with two majors, since its
  shared fixture's single major now counts unchosen; its assertions are unchanged.

### US-028 Circle titles show progress
- `titleCp` in `core/engine.ts`: not capped. A program counts the completed and planned subjects it
  lists; a degree counts `compatibility(...).countingCp`, with and without the planned subjects.
  The store (`derive` in `web/src/store.ts`) keeps a `titles` map for every degree and program.
  `toggleProgram` now re-derives too, since a chosen program changes a degree's counting.
- `web/src/TreeCanvas.tsx`: each circle gets a second Text (`progress`) after the last line of its
  title (measured with `CanvasTextMetrics`), coloured by the same status as the glow, ticked when
  complete or planned. Titles are lifted by `TITLE_LIFT` (degree 40, program 8 world units).
- Test hook `window.__dst.title(id)`. E2E: `e2e/view.spec.ts` "US-028" (complete, planned, uncapped
  54/48, part done, degree total, lift).

### US-029 View settings
- `web/src/view.ts`: `ViewSettings` (grow, textSize 0.5-2, showCp), stored under `dst.view` in
  localStorage, never in the hash. `textPx(kind, natural, view)` gives the on-screen font size:
  within `TEXT_PX` bounds while growing, a fixed size otherwise, times the text size.
- `applyLod` in `web/src/TreeCanvas.tsx` scales every title, credit-point text and subject label to
  its `textPx`. A subject label shows only while it fits its disc (`LABEL_FIT`), or when popped.
- `ViewSettingsButton` in `web/src/Panels.tsx`, styles `.view-popup` in `web/src/styles.css`.
- Tests: `web/src/view.test.ts` (vitest now includes `web/src/**/*.test.ts`), `e2e/view.spec.ts`
  "US-029" (bounds, fixed size, 200%, credit points off, reload, not in link, labels hide, phone).
  Both geometry tests were seen to fail with `LABEL_FIT` and `TITLE_LIFT` broken.

### US-030 Light and dark mode
- `web/src/theme.ts`: dark and light sets for `canvas`, `stateLook` and `degreeHues`, exported as
  live `let` bindings switched by `setThemeColours`. New `selectRing` colour (was hard-coded white).
- `web/src/styles.css`: every colour is a token on `:root`; `:root[data-theme='light']` overrides
  them. `web/index.html` sets `data-theme` before first paint (stored choice, else system).
- Store `theme` / `setTheme` (`dst.theme` in localStorage); `restyle` in `TreeCanvas.tsx` recolours
  the renderer background and titles, then repaints. `ThemeButton` in `Panels.tsx`.
- `playwright.config.ts`: tests default to a dark system (`colorScheme: 'dark'`), since Playwright
  otherwise reports light and older tests assert dark colours. E2E: `e2e/view.spec.ts` "US-030".

### US-031 Progress on each way and heading in the outline
- `Cp` and `Bar` in `web/src/Panels.tsx` (shared with the progress panel's rows) render "42+6/48cp"
  and the done / planned bar. `OutlineSection` puts them on every heading of the degree outline (in
  place of the bare "(48cp)") and on each way the engine could read (`WayProgress`).
- Styles: `.way-num`, `.ways .bar` in `web/src/styles.css`.
- E2E: `e2e/outline.spec.ts` "US-031", with two majors and a planned replacement subject.

### US-032 See what can fill elective slots
- `measure` in `core/engine.ts` records `Progress.fills` on free-elective nodes: the completed and
  planned subjects it assigned there.
- `FreeElectives` in `web/src/Panels.tsx`, under each free container of the outline: the filling
  subjects as links, and a note that any UTS subject can go there. Hovering the note glows the
  subjects in state `available` (requisites met, not taken) through the existing `setGlow`.
- Test hook `window.__dst.ringed()` (`web/src/TreeCanvas.tsx`): subjects drawn with the glow ring.
- Tests: `core/progress.test.ts` (fills), `e2e/outline.spec.ts` "US-032".

### Two majors counted in both places (US-022, US-027; 25 Sep 2026)
- Bug: in the Bachelor of IT, two chosen majors both landed under "Major - Information Technology"
  (one of the following, so only the best counted) and again under "Options > Majors" with 0cp, as
  their subjects were already claimed. Options showed 0/48, the second major never went green.
- `measure` in `core/engine.ts` now places each chosen program once: a "one of the following"
  container takes one program (fewest other listings first, then choice order), the rest go to the
  next list that names them. `claimed` records who a subject counts towards; a program container that
  lists a subject claimed elsewhere gets `Progress.elsewhere`. In the roll-up a program's shared credit
  points can be made up by its own extra option subjects (credit beyond a child's cap).
- `DegreeOutline` / `OutlineSection` in `web/src/Panels.tsx`: program status comes from where the
  program actually counts (`within`); elsewhere it shows "(counts under ...)". Shared subjects are
  listed under the program with what makes up their credit points.
- Tests: `core/progress.test.ts` (two majors, real data; both fail on the old engine),
  `e2e/outline.spec.ts` (outline statuses, shared-subject note, totals 90 then 96 of 144).

### Planned purple, unlock paths crimson (US-009, US-026, US-027; 25 Sep 2026)
- Blue for planned was lost among the other blues (available rings, cyan glows, the IT degree's hue).
  Planned is now purple: fill `#33175c`, ring and glow `#b36bff` (`stateLook.planned`,
  `canvas.plannedGlow`, CSS `--planned` / `--planned-deep`, which also colour the outline's planned
  lines and ticks). The "what this unlocks" links and rings (`canvas.edgeUnlock`), which were purple,
  are crimson `#dc143c`. Stories reworded from blue to purple.
- Files: `web/src/theme.ts`, `web/src/styles.css`, `e2e/multidegree.spec.ts`, `docs/UserStories.md`.

### US-026 Finished circles glow
- The store derives `finish` (a `Status` per degree and program, from `progress` / `programProgress`)
  with the plan, so repaints do not recompute it. The canvas draws three soft rings outside a finished
  circle: `canvas.complete` green or `canvas.plannedGlow` blue; the chosen-program gold outline stays.
  `window.__dst.finished()` exposes what was drawn, for tests.
- E2E: Innovation and Entrepreneurship (SMJ10156) complete glows green, half done plus half planned
  glows blue, half done alone does not glow.
- Files: `web/src/store.ts`, `web/src/TreeCanvas.tsx`, `web/src/theme.ts`, `e2e/multidegree.spec.ts`.

### US-027 Degree outline shows progress
- `DegreeOutline` / `OutlineSection` in `web/src/Panels.tsx` replace the plain outline in the degree
  panel: headings, program lines and way lines take `st-complete` (green, tick), `st-planned` (blue,
  tick), `st-started` (yellow) from `progressStatus`. A chosen program is at least started; an unchosen
  one shows only complete or planned (from `finish`). Way text is split onto its own numbered lines.
  Program panels keep the plain outline.
- E2E (`e2e/outline.spec.ts`): the Bachelor of IT Compulsory block through none, started, planned and
  complete (and its computed colour); the Options ways through none, chosen, planned and complete,
  with the progress panel showing Options 48/48.
- Files: `web/src/Panels.tsx`, `web/src/styles.css`, `core/engine.ts`, `e2e/outline.spec.ts`.

### Rendering on demand (supports US-004, US-007)
- Pixi redrew every frame even when idle, saturating the main thread: under 4 parallel test browsers
  a reload took ~6.9 s just to start, which was the intermittent CI failure in the US-007 share-link
  test (7 of 8 repeats failed locally). The canvas now redraws only after a change or while the camera
  moves. Same load: reload ~1.8 s, 8 of 8 repeats pass, full E2E suite 1.6 min (was 2.3). Real-GPU
  pan/zoom still median 59.9 fps.
- Files: `web/src/TreeCanvas.tsx`.

### US-033 The degree panel holds the progress
- `ProgressPanel` (the top-left card) is removed. `DegreeDetail` in `web/src/Panels.tsx` shows the
  degree's total (`progress()` root, `Cp` + `Bar`, test id `degree-total` / `progress-total`) and
  takes over the "choose a major" hint. The "In the way" list and the card's "Completed, but not
  counting" list are one list (`not-counting`) inside `degree-fit`, each subject with its reason.
- `DegreeChip` (replaces `ProgressPanel` in `web/src/App.tsx`): shown while a degree is selected and
  its panel is not open; the title and total reopen the panel (`select(degree)`), × clears the degree.
- `useGlowOn(ids)` gives any row pointer and focus handlers that set the store's `glow`: the total
  (degree circle), headings (`codesUnder`: everything named at and below), ways and way parts
  (everything that could fill them), program lines (`ProgramLink`) and subjects (`SubjectLink`, so
  this also applies in subject and program panels). `DetailPanel` clears the glow when its selection
  changes, since a row that disappears never gets its mouseleave.
- Tests: `e2e/outline.spec.ts` "US-033" (total, chip round trip, hover glows); existing tests moved
  from the card to the panel and chip with the same assertions (`e2e/helpers.ts` `chooseDegree`,
  `openDegreeFromChip`; `e2e/multidegree.spec.ts`, `e2e/stories.spec.ts`).
- Files: `web/src/Panels.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `e2e/*.ts`.

### US-034 Expand and collapse the outline
- `toggleProps(open, setOpen)` in `web/src/Panels.tsx`: role button, `aria-expanded`, `data-open`,
  click and Enter / Space. Headings (`OutlineSection`, starts open) and understood ways (`WayRow`,
  starts closed) use it. The arrow is CSS (`.outline-toggle::before`, ▸ / ▾), so it is not in the
  row's text. State is component state, never in the plan or link.
- Tests: `e2e/outline.spec.ts` "US-034"; tests that look inside a way now open it first (`openWay`).
- Files: `web/src/Panels.tsx`, `web/src/styles.css`, `e2e/outline.spec.ts`.

### US-035 Each way lists what fills it
- `core/engine.ts`: `parseWays` keeps each part's text; `measure` records `WayProgress.parts`
  (`WayPartProgress`: text, what, required, done, planned), the same numbers it already summed per way.
- `web/src/Panels.tsx`: under a requirement with understood ways, `leavesOf` looks through headings
  that only group others, and `offers` says what each remaining container provides (majors,
  sub-majors, a stream, or free electives), matching the pools the engine counts. `WayRow` shows a
  `WayPartRow` per part (or the contents directly for one part); `PartBody` lists the programs
  (`ProgramLine`) or the electives filling it (`FreeElectives`, now given the merged `fills`).
  Containers no way uses are still rendered after the ways. Requirements without ways are unchanged.
- Blast radius, checked on the 2027 data: numbered ways appear only in the Bachelor of IT and the
  Bachelor of Business Options. Business's two "Electives" wrappers (42 + 6, 18 + 6) are dropped the
  same way; its transdisciplinary stream is not named by any Business way, so it stays after the ways.
- Tests: `core/progress.test.ts` "each part of a way" (real data; parts add up to their way);
  `e2e/outline.spec.ts` "US-035" (BIT parts and contents, grouping headings gone; Computing Science
  keeps its headings). Mutation check: making `leavesOf` return the children as they are turns the
  BIT test red.
- Files: `core/engine.ts`, `core/progress.test.ts`, `web/src/Panels.tsx`, `web/src/styles.css`, `e2e/outline.spec.ts`.

### US-036 A program is listed in one place only
- `countsElsewhere` in `web/src/Panels.tsx`: a program whose `within` (where the engine counted it)
  is another requirement is left out of this list, in plain lists and in way contents. Replaces the
  "(counts under ...)" note.
- Tests: `e2e/outline.spec.ts` "US-036". Mutation check: making `countsElsewhere` always false turns it red.
- Files: `web/src/Panels.tsx`, `e2e/outline.spec.ts`.

### US-037 Programs that can no longer fit are crossed out
- `core/engine.ts`:
  - `programsFit(map, degree, codes)` places each program in a requirement that lists it (trying
    every placement; a handful at most) and checks the structure: a requirement with numbered ways
    takes what one understood way allows per kind; any other takes programs up to its credit points
    (skipped under a ways requirement, whose ways govern).
  - `programLocks(map, degree, plan)` returns `{ accepted, locks }`. For each major and sub-major the
    degree lists: `room` (does not fit beside the accepted ones), `overlap` (subjects still free, i.e.
    not compulsory in the degree or an accepted program and not counted by a requirement, fall below
    `min(its cp, all its listed cp)`, so gaps in the handbook data never lock) and `clash` (a compulsory
    subject clashes with one taken). Each `Lock` has a sentence and its blockers.
  - Bug fix: `measure` tracks who a subject counts towards by key (program code or container id), not
    title; the Data Analytics major and sub-major share a title, which hid the "counts towards" note.
    The root `Progress` now carries `claims` (subject -> key) for the overlap check.
- `web/src/store.ts`: `locks` derived with the plan while a degree is selected; a locked program's
  `finish` is `none`, so it never glows. ~10-35 ms per plan change for the whole derive.
- `web/src/TreeCanvas.tsx`: locked circles drawn grey with a red outline and cross; title ends ✗ in
  red. `window.__dst.locked()` for tests.
- `web/src/Panels.tsx`: `ProgramLine` greyed, struck through, ✗, reason as tooltip (`data-status`
  `locked`); `LockNote` in the program panel with blockers as links; Choose disabled.
- Tests: `core/locks.test.ts` (each degree's limits, room, overlap, data gap, other degree, no degree,
  the title bug on a synthetic map; the bug test fails on the old title comparison);
  `e2e/outline.spec.ts` "US-037" x2. Mutation check: with the store's locks forced empty, all three
  US-037 / US-038 E2E tests go red.
- Files: `core/engine.ts`, `core/locks.test.ts`, `web/src/store.ts`, `web/src/TreeCanvas.tsx`,
  `web/src/Panels.tsx`, `web/src/styles.css`, `e2e/outline.spec.ts`, `docs/UserStories.md`.

### US-038 A chosen program that cannot count
- `programLocks` walks `plan.programs` in choice order; one that does not fit beside those accepted
  before it is locked. `progress()` measures with `accepted` only, so it counts nothing.
- `ProgramDetail` shows "Chosen, but cannot count towards ..." and an Unchoose button (`unchoose`).
- Tests: `core/locks.test.ts` (order, counts nothing); `e2e/outline.spec.ts` "US-038".
- Files: `core/engine.ts`, `web/src/Panels.tsx`, `e2e/outline.spec.ts`.

### Double degree pulled (US-019, US-037; 25 Sep 2026)
- Pulled C10219 Bachelor of Information Technology Bachelor of Business (2027) at 1 request / 3 s, no
  blocks: 14 areas of study, 153 subjects in scope, 53 requisite-only subjects; 404s: 1 structure
  subject (48033) and 29 requisite subjects (retired ones, in line with the other degrees). Almost
  every page was already cached. Report: `data/reports/coverage-2027-C10219.json`.
- Structure (192cp): the IT half (Majors - IT one of 5, Core - IT 48cp) and the Business half (Core -
  Business 48cp, Majors - Business one of 9). No new programs or subjects. `programsFit` reads it as
  one IT major plus one Business major; choosing both locks the other 12.
- Map: 5 degrees, 70 programs, 399 subjects, 1080 subject copies. IT and Business majors are now
  offered by two degrees each, so by the US-020 rule they sit outside every degree circle.
  Pan/zoom still median 59.9 fps (`npm run test:perf`).
- Fixes found on the way: a double degree's faculty arrived as "A<br />B" (`faculty()` in
  `scraper/src/normalize.ts` joins with a comma); the degree-picker grew to the longest title and
  pushed the phone layout sideways (`.topbar select` capped); the third degree hue was red, which now
  means locked out, so it is magenta.
- Tests adjusted for the new data, same checks: 5 degrees in the picker and in `normalize.test.ts`,
  Programming 1 has 19 copies (the 19th in C10219), a degree button matched by its full title.
- Files: `scraper/src/normalize.ts`, `scraper/test/normalize.test.ts`, `web/public/trees/*.json`,
  `web/src/theme.ts`, `web/src/styles.css`, `e2e/multidegree.spec.ts`, `data/reports/coverage-2027-C10219.json`.

### US-039 Degrees in their faculty's colour
- `web/src/theme.ts`: `contrast` (WCAG ratio), `readable(colour, background, min = 3)` (moves HSL
  lightness only as far as needed, keeping hue and saturation), `facultyColour(hex)` for the current
  theme, `backgrounds`, `neutralDegree`. The per-degree hue list (`degreeHues`) is gone.
- `web/src/TreeCanvas.tsx`: `degreeHue` gives each degree its first faculty's readable colour, used
  for the circle outline and tint and the credit points; `titleColours` sets each title's fill, and
  `restyle` redoes both on a theme change. Test hook `title(id)` now returns `fill`, `parts`, `tags`.
- `web/src/Panels.tsx`: `DegreeTitle` renders the panel heading in the same colours.
- Tests: `web/src/theme.test.ts` (every UTS colour reaches 3:1 on both maps and keeps its hue within
  8 degrees; fails with the adjustment switched off); `e2e/view.spec.ts` "US-039".
- Files: `web/src/theme.ts`, `web/src/theme.test.ts`, `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`, `e2e/view.spec.ts`.

### US-040 Double degrees in both colours
- `scraper/src/facultyColours.ts`: `splitTitle` cuts a title at each "Bachelor of" / "Master of" /
  "Diploma in" ...; `titleParts` pairs the parts with the handbook's faculties (comma separated,
  in order), or keeps the title whole with the first faculty when the counts differ.
- `web/src/TreeCanvas.tsx`: `taggedTitle` wraps each part's words in `<pN>` tags per wrapped line,
  drawn by Pixi's `tagStyles` with one fill per part.
- Tests: `scraper/test/facultyColours.test.ts` (splitting, mismatched counts); `e2e/view.spec.ts`
  "US-040" (map tags and panel spans; fails when the tags are dropped).
- Files: `scraper/src/facultyColours.ts`, `core/model.ts` (`Degree.titleParts`, `TitlePart`),
  `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`.

### US-041 A standard faculty-colour lookup for any university
- `docs/FacultyColours.md`: the procedure (brand colours, then academic dress, then a fallback
  palette), how to get a hex (published, or sampled from the university's hood photo), and the rules
  format.
- `data/faculty-colours/uts.json`: UTS from academic dress, 25 Sep 2026. No faculty brand colours
  exist publicly. Six hood colours are named in the gallery's image descriptions; IT (blue), Law
  (violet), Science (yellow) and Transdisciplinary (terracotta) only in photos. All ten hex values are
  medians of the hood fabric in the official Bachelor photos. Rules: Engineering and IT awards are
  scarlet if the title says Engineering, else IT blue; only the EIT and Business rules are checked
  against degrees on the map.
- `buildMap` takes the table and sets `Degree.titleParts`; `normalize` in `scraper/src/cli.ts` reads
  `data/faculty-colours/uts.json` and warns for any part without a colour (none today).
- Tests: `scraper/test/facultyColours.test.ts` (the table is complete, rules point at real colours,
  every degree on the map has a colour for every title part).
- Files: `docs/FacultyColours.md`, `data/faculty-colours/uts.json`, `scraper/src/facultyColours.ts`,
  `scraper/src/normalize.ts`, `scraper/src/cli.ts`, `scraper/test/facultyColours.test.ts`, `web/public/trees/uts-2027.json`.

### Full 2027 handbook pulled (US-001; 25-26 Sep 2026)
- Overnight at 1 request / 3 s per host, the handbook and the requisite pages in separate processes
  (the throttle is per process, and they are different hosts): `list`, then `pages` and `access`.
  22:59 to 02:36, no 403, no failures. 2027 lists 444 courses, 957 areas of study, 3,299 subjects
  (search totals matched); all fetched, plus 3,309 requisite pages. 4,700 handbook pages, all valid
  JSON; 138 MB in `data/raw/2027/` (gitignored). Summary: `data/reports/full-2027.json`.
- Only the data: the map still holds 5 degrees. Putting the whole handbook on one map needs the map
  split by faculty or loaded on demand first.


### US-043 The whole handbook on one map (experiment, `big-map` branch)
- The map is 15,682 subject copies, 14,897 links and 1,086 circles over a world of 184,000 x 28,000
  units. Drawn the old way (one Pixi object tree, Pixi's culler, Pixi's hit testing, every link in
  one shape), the main thread was 66-87% busy while panning, hover took ~125 ms and marking a
  subject ~900 ms.
- Renderer reworked like a game engine (26 Sep 2026):
  - Subject codes are `BitmapText` from one shared glyph atlas, tinted per state (a canvas texture per
    label cost gigabytes). Below 6 px across, subjects are one shape of dots.
  - The viewport is a Pixi render group, so moving the camera changes one GPU transform instead of
    every object's transform on the CPU.
  - The map is cut into 2,500-unit tiles. Each tile holds its subjects and the links drawn in it;
    `cull` shows only tiles, circles and titles whose box overlaps the screen (plus a margin), one box
    test each. Subjects are sized for the zoom tile by tile as their tile comes on screen.
  - Pixi's hit testing is off for the map's children (it walked every object on each pointer move,
    including hit tests along all 14,897 links). A 200-unit grid finds the subject under the pointer
    (`nodeAt`); circles still use `circleAt`. Nothing hovers while the map is being dragged.
  - Copies of the hovered or selected subject move to a pop layer above every tile.
  - Only what changed is redrawn: a subject's shape when its look key changes, a circle when its look
    key changes, and a tile's links only when one of its link styles changes. Links lit by a hover or
    search are drawn in a separate small shape over the faded base.
- Measured on the whole-handbook map (`e2e/bench.tmp.spec.ts`, unminified build, real GPU: Intel Iris
  Xe via ANGLE/Vulkan; frame timing and CPU profile on separate passes, because starting the profiler
  stalls the page), before -> after:
  - main thread busy while panning, far / mid / near zoom: 66% / 80% / 83% -> 27% / 31% / 16%
  - slowest frame while panning, far / mid / near: 133 / 117 / 117 ms -> 67 / 17 / 17 ms; p95 at mid
    and near 30 fps -> 60 fps
  - hover to highlight 118 ms -> 35 ms; mark completed to redrawn 885 ms -> 169 ms
  - JS heap 829 MB -> 520 MB; open to first frame 3.1 s -> 2.3 s
- E2E on the whole-handbook map: 14 failed before the rework, 8 after; none newly failing. Of the 8,
  four are counts from the bigger data (US-019 expects 5 degrees, the three US-020 tests expect 19
  copies of a subject and get 107); US-027 (x2), US-037 and US-029's settings test are not yet
  explained.
- Files: `web/src/TreeCanvas.tsx`. Scratch measurement specs (not committed): `e2e/bench.tmp.spec.ts`,
  `e2e/trace.tmp.spec.ts`, `e2e/perf-layers.tmp.spec.ts`, `e2e/perf-zoomed.tmp.spec.ts`,
  `e2e/interact.tmp.spec.ts`.

### US-044 Titles never pile up (`big-map` branch)
- `declutter` in `web/src/TreeCanvas.tsx` runs after each zoom (from `applyLod`, which also runs at the
  end of every paint). Every readable title (program titles only above zoom 0.12, as before) is
  ranked: selected degree, glowing circle, degree, program, then bigger circle first. Titles are
  placed greedily in that order; one that would overlap an already placed title (with 4 px of air)
  is hidden, except the selected degree and glowing circles, which always show. Placed boxes sit in a
  grid of 300-screen-pixel cells, so each check looks at a handful of boxes.
- Decided for the whole map rather than the screen, so panning never changes which titles show.
- The title box includes the credit points when they are drawn, and is measured once per zoom
  (`CircleView.titleBox`), shared with culling.
- Test hook `__dst.titles()`: every circle's title with whether it is shown, its screen box and its
  circle's centre.
- Tests: `e2e/titles.spec.ts` (US-044): no overlaps at the far zoom and the selected degree shown; a
  hidden title shows after zooming in on it; panning leaves the shown set unchanged; hovering a
  circle shows its hidden title. Each was seen to fail with the behaviour broken (placing every
  title; deciding per screen and again on every pan; ignoring hover).
- Measured (`e2e/bench.tmp.spec.ts`, three runs): far zoom 27-28% busy, slowest frame 67-83 ms;
  mid 29-31%, 33-67 ms; near 17-18%, 17 ms. Within run-to-run noise of before.
- E2E: 6 of 61 fail, none newly; US-027 (compulsory block) and US-037 passed this run after failing
  in the last two.
- Files: `web/src/TreeCanvas.tsx`, `e2e/titles.spec.ts`, `docs/UserStories.md`.

### US-050 Offshore degrees in their own areas (`degree-pairs` branch)
- Data: `Degree.locations` (the handbook's `availabilities[].location`, deduplicated) and
  `MapDoc.locations` (a `LocationTable`: home locations, and away locations each with an area title),
  read in `buildMap` from `data/locations/uts.json`. The build warns for a location in neither list.
  UTS home: City campus, Moore Park Precinct, Online campus. Away: China ("Offered only in China";
  5 of its 7 courses name Shanghai University, 2 only say "offered offshore") and Vietnam ("Offered only
  in Ho Chi Minh City, Vietnam"). Map rebuilt with `HANDBOOK_YEAR=2027 npm run scrape -- normalize --all`.
- `awayArea(map, degree)` in `core/layout.ts`: the location a degree is offered only in, when every one
  of its locations is away. `layoutMap` places everything else as before, then each away location's
  courses (and programs offered only by them) with `placeTops(..., together = true)` (one centre, not
  spread by faculty), to the right of the main map; `Layout.areas` holds each frame and its one-line title.
- Canvas: each area is a rounded frame behind the circles and a title that always shows, sized by a new
  `area` text kind (`web/src/view.ts`). Area titles are placed first in decluttering (US-044), so other
  titles make way for them. Test hook `__dst.areas()`.
- Tests: `core/layout.test.ts` (US-050, on real data: 7 China and 2 Vietnam courses found from their
  locations; each inside its area with its title; offshore-only programs and subject copies inside;
  nothing else inside an area; areas right of the main map, titles above their frames). Seen to fail
  with areas switched off. `e2e/offshore.spec.ts`: both titles, and the offshore Bachelor of Business
  inside the China frame once zoomed out.
- `e2e/titles.spec.ts`: the US-044 panning test's drag cut from 30 steps to 5, because it hit the 45 s
  limit under software GL with 4 workers; still fails with per-screen decluttering.
- E2E: 8 of 64 fail; the US-044 panning timeout is fixed as above, US-027's compulsory block test flips
  between runs, and the other 6 are the known ones (US-043).
- Files: `core/model.ts`, `core/layout.ts`, `core/layout.test.ts`, `scraper/src/normalize.ts`,
  `scraper/src/cli.ts`, `data/locations/uts.json`, `web/src/TreeCanvas.tsx`, `web/src/view.ts`,
  `e2e/offshore.spec.ts`, `e2e/titles.spec.ts`, `web/public/trees/uts-2027.json`.

### US-046 Choose a degree, don't just click it (`degree-pairs` branch)
- `web/src/TreeCanvas.tsx`: a click on a degree circle only opens its panel (`select`), no longer
  `selectDegree`. `web/src/Panels.tsx`: the degree panel's button reads "Choose this degree" /
  "✓ Chosen (clear)" (`data-testid="choose-degree"`). The picker, the chip's clear button and the
  program panel's "select a degree that offers it" links are unchanged.
- Tests: `e2e/degreepairs.spec.ts` (US-046: click opens without choosing; Choose; clear from the panel
  and the chip). Seen to fail with click-to-choose restored. `e2e/multidegree.spec.ts`: the two tests
  that chose a degree by clicking its circle now click Choose in its panel.
- Files: `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`, `e2e/degreepairs.spec.ts`, `e2e/multidegree.spec.ts`.

### US-047, US-048, US-049 Double degrees from two halves, locking and add-on halves (`degree-pairs` branch)
- `core/pairs.ts` (institution-agnostic, run in the map build before the layout):
  - `pairDegrees(map)`: each double's title parts are matched to a stand-alone degree with that title
    (the home one where two share a title), or to an add-on half found as the double's top-level
    section named after it. 91 of 92 doubles get `Degree.halves`; Education Futures + Master of
    Teaching in Primary Education has neither and keeps its circle.
  - Add-on halves become degrees `A-<slug>` with `addOn.combined`, built from the section most of their
    doubles share (containers re-id'd, since progress is keyed by container id).
  - What a double adds beyond its halves (items in its section for that half; for doubles without a
    section per half, the half whose faculty teaches most of the item's subjects) is grouped per half
    by exactly which doubles add it: synthetic programs `X-<half>-<doubles>` titled "With <partner> or
    ...", with `onlyWith`, listed in the half's `Degree.extras`. 43 groups, 93 items on 2027 data.
  - `chosenDegrees`, `combinedOf`, `partnersOf`; `degreeLocks(map, degree)` (US-047, US-049) and
    `pairingLocks(map, plan)` (groups and what they hold, unless one of their doubles is chosen and
    unless a stand-alone degree also offers it; programs chosen under a half the chosen double drops).
    `Lock.why` gains `'pairing'`.
- The plan still stores the double's own code once both halves are chosen, so links are unchanged.
- `core/layout.ts`: degrees with halves get no circle; a degree's circle also lists its `extras`;
  `facultyOrder` counts only degrees drawn; an add-on half's title adds "(only as part of a double
  degree)". Map: circles 1,086 to 1,041, subject copies 15,682 to 14,467, links 14,897 to 13,512.
- Store (`web/src/store.ts`): `locks` merges `programLocks` with `pairingLocks`; new `degreeLocks`.
- Canvas: a locked degree is drawn like a locked program; both halves of a chosen double look chosen;
  copies inside either half count as inside the chosen degree; flying to a double goes to its first half.
  Test hook `__dst.lockReasons()`.
- Panels: `DegreeActions` (Choose / Add to make <double> / Chosen, part of <double> (remove) / Locked
  with the reason and a clear button; notes for a double's halves and an add-on half's partners); the
  lock note handles pairing locks with no degree chosen; group panels offer no Choose; the picker and
  the degree count leave out add-on halves.
- Tests: `core/pairs.test.ts` (real data: halves, partners, circles removed, groups inside their half,
  add-on halves, degree locks with nothing / an undergraduate / a double / a postgraduate course chosen,
  pairing locks, a program a stand-alone degree also offers never locks, carry-over lock).
  `e2e/degreepairs.spec.ts` (US-047, US-048 x2, US-049, and US-046's picker-with-a-locked-degree case).
  Seen to fail with no degree locks, no partners, chosen halves ignored, and the shared-program fix
  removed. Updated for the new model: `core/layout.test.ts` (no circle for doubles with halves;
  listers include extras; faculty order measured from the main map's centre, since US-050's areas widen
  the bounds), `scraper/test/normalize.test.ts` (444 courses plus 3 add-on halves), `e2e/view.spec.ts`
  (US-040's two colours checked on the panel title), `e2e/outline.spec.ts` (US-037's lock counts leave
  out degree and pairing locks).
- Files: `core/pairs.ts`, `core/pairs.test.ts`, `core/model.ts`, `core/engine.ts`, `core/layout.ts`,
  `core/layout.test.ts`, `scraper/src/cli.ts`, `scraper/test/normalize.test.ts`, `web/src/store.ts`,
  `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`, `e2e/degreepairs.spec.ts`, `e2e/view.spec.ts`,
  `e2e/outline.spec.ts`, `web/public/trees/uts-2027.json`.

### US-047 changed, US-051 Unchoose degree (`degree-pairs` branch, 27 Sep 2026)
- `degreeLocks` (`core/pairs.ts`): with any degree chosen, every degree that is not it, one of its halves
  or one of its partners is locked, whatever its level; the message is "This is not connected to your
  chosen degree. You'll need to unchoose <degree> before choosing this. You can also use Unchoose degree
  or Reset at the top right." With nothing chosen only the add-on halves lock, as before.
- Panels: the locked degree's panel link reads "Unchoose <degree>"; the top bar has an **Unchoose
  degree** button (`data-testid="unchoose-degree"`) beside Reset while a degree is chosen; picker
  options for locked degrees are disabled (`pickerLocked`: a double only while nothing, or one of its
  halves, is chosen), and picking a partner makes the double.
- Tests: `core/pairs.test.ts` (Science chosen locks a bachelor, a master's and a PhD it does not pair
  with, not its partners, a master's among them; a double chosen; a master's chosen). `e2e/degreepairs.spec.ts`
  (US-047 rewritten on the Bachelor of Science: map, panel message, disabled picker entries, partner in
  the picker makes C10162, Unchoose; US-051: Unchoose clears C10219 and keeps 31251 completed). Seen to
  fail with the undergraduate-only rule and with the button hidden. `e2e/multidegree.spec.ts`: US-021
  and US-023 unchoose before choosing a degree that does not pair.
- Files: `core/pairs.ts`, `core/pairs.test.ts`, `web/src/Panels.tsx`, `e2e/degreepairs.spec.ts`,
  `e2e/multidegree.spec.ts`, `docs/UserStories.md`.

### US-045 Requisite lines missing for some subjects (bug, `degree-pairs` branch, 27 Sep 2026)
- Canvas (`web/src/TreeCanvas.tsx`): the focus's requisite lines now light from every subject its rule
  names (`ruleSubjects`), whichever alternative it is in; an unmet one is also ringed as on the chain, a
  met one lights in the done colour. The deeper chain still comes from `missingFor`. Test hook
  `__dst.litEdges()` ("from>to" codes).
- Engine (`core/engine.ts`): `Missing.unchecked` counts conditions on a route the map cannot check (free
  text; a course requirement with no degree chosen), and `missingFor` ranks each at 500, so a route
  through subjects beats an admission-only one; with nothing else, the text route is still the answer.
  This also changes which subjects the US-025 prompt lists for such rules (subjects, not the admission
  note). Alone it lit 134 of the 421 dark subjects; lighting every named requisite covers the rest.
- Tests: `core/engine.test.ts` (subjects route beats an admission-only one; the text route stands when
  it is the only one), `e2e/requisites.spec.ts` (76024, 70317, 77889, and 70107 as a control, each
  lights all its drawn requisite lines). Seen to fail with each change removed (all four E2E, including
  70107, which lit one of its two).
- Files: `core/engine.ts`, `core/engine.test.ts`, `web/src/TreeCanvas.tsx`, `e2e/requisites.spec.ts`,
  `docs/UserStories.md`.

### US-021 addition: fly to the copy that matters (`degree-pairs` branch, 28 Sep 2026)
- `copyFor` (`web/src/TreeCanvas.tsx`), used by every camera flight (search, panel subject and program
  links, the picker) and by the `pointFor` test hook, ranks a subject's copies: inside a chosen degree
  (`chosenDegrees`, so either half of a double) and with no locked circle (program or degree lock) above
  it; then not locked; then inside; then listed rather than entry. Before, only "inside `plan.degree`'s
  circle" and entry counted, and a chosen double has no circle. Test hook `__dst.flewTo()`.
- Measured on 2027 data: a more relevant copy for 181 subjects with nothing chosen, 989 with C10219 and
  799 with C10242.
- Tests: `e2e/flyto.spec.ts` (81511 with nothing chosen; 23115 and 21513 with C10219; a click on 23115 in
  Business's panel). All three fail with the old ranking; the nothing-chosen one also fails without the
  lock check.
- Files: `web/src/TreeCanvas.tsx`, `e2e/flyto.spec.ts`, `docs/UserStories.md`.

### US-052 Layers above the detail card (`degree-pairs` branch, 28 Sep 2026)
- Store: `copy`, the subject copy clicked on the map (`TreeCanvas` pointertap) or flown to (`flyTo`).
- `web/src/Panels.tsx`: `DetailPanel` renders a `.detail-column` holding `Layers` above the card.
  `layersOf` walks up from the copy's circle (a subject) or the circle's parent (a program or degree),
  adds the chosen double on top when the chain reaches one of its halves, and reverses to outermost
  first. Each button (`data-testid="layer"`, `data-code`) shows its kind and title, is struck through
  with a red cross when locked (as in the outline, `.st-locked`), and opens that circle with a flight.
- `web/src/TreeCanvas.tsx`: `copyFor` first prefers a copy inside the circle whose panel the link was
  clicked in (the previous selection), so a subject opened from a major keeps that major as its layer;
  flying to a double frames both of its halves.
- `web/src/styles.css`: `.detail-column` takes the card's old place (and the phone bottom sheet's); the
  card fills what the buttons leave; `.layer` buttons are gold, the card's width.
- Tests: `e2e/layers.spec.ts` (US-052): with C10219 chosen, 21513's layers are C10219, C10148,
  MAJ08966, each the card's width above it; up to the degree, then to the double (both halves framed);
  a subject link from Business's panel keeps Business, one from Software Engineering (MAJ03523) keeps
  C09066 > MAJ03523 rather than the copy another major would get; a map click shows the clicked copy's
  chain; closing removes the buttons. Seen to fail with the buttons removed, the double left off the
  top, and links ignoring the circle they came from. Checked by screenshot on desktop and phone.
- The scratch `e2e/interact.tmp.spec.ts` (not committed) failed once in a full run while waiting for a
  hover highlight; it passed 4 of 4 on the commit before and 14 of 15 after, so it is an intermittent
  timing flake under load, not this change.
- Files: `web/src/store.ts`, `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`, `web/src/styles.css`,
  `e2e/layers.spec.ts`, `docs/UserStories.md`.

### US-043 follow-up: the US-027 and US-029 E2E failures (28 Sep 2026)
- US-027 (two outline tests): each reloads the whole 2027 map four or five times; alone they took 35 s
  and 39 s of the 45 s limit, and timed out with 4 workers. Marked `test.slow()` with the reason; what
  they assert is unchanged. Still needed: they are the only checks of the outline's progress colours.
- US-029 (settings): it read the Bachelor of IT title size at the zoom the map opens at. Over 444
  degrees that zoom leaves the title at its 16 px minimum, and one wheel step does not lift it off, so
  "the title changes with zoom" failed. The test now flies to C10148 first; the assertions are
  unchanged, and it still fails with text growth switched off.
- Full E2E: 70 passed, 4 failed (all counts), 5 skipped.
- Files: `e2e/outline.spec.ts`, `e2e/view.spec.ts`, `docs/UserStories.md`.

### US-053 to US-057 Dynamic mode (`dynamic-map` branch, 28 Sep 2026; static tagged `static-map-2026-09-28`)
- `core/layout.ts`: `layoutMap(map, { only, hide })` lays out one top-level circle centred on (0, 0) with
  some programs left out; the placement and output code moved into `emitAll`. The static layout is
  unchanged: re-laid out, the 6 MB stored layout compares equal.
- `core/dynamic.ts`: `hiddenCircles` (locked, inside something hidden, or a shared program with every
  offering degree hidden), `topOf`, `centreOf` (last chosen while still chosen, else the last program,
  else a chosen degree). Tests `core/dynamic.test.ts` on real data (114 / 63 / 558 top-level circles).
- Store: `mode` (remembered in `localStorage` as `dst.mode`, `web/src/view.ts`), `last` (set by
  `selectDegree` to the degree just added, and by choosing a program). `ModeSwitch` in the top bar.
- `web/src/DynamicCanvas.tsx`: each shown top-level circle is a body (a Pixi container drawn once in
  its own coordinates) in a d3-force simulation: pulled to the centre (0.03 sideways, 0.1 up and down,
  velocity decay 0.55), the centre's circle pinned at (0, 0); with nothing chosen, pulled sideways to
  its static x; offshore bodies to anchors right of the main cluster, framed and titled. Collision on
  circle-and-title radius plus 120. Physics runs on its own 16 ms timer, up to 6 ms of steps a time,
  so settling does not wait on slow frames (under software GL a frame took over a second and stalled
  it). New bodies start outside the cluster on a wide ellipse and fade in; hidden ones fade out. A body
  that loses part of its contents is drawn at once without them and laid out again in
  `web/src/layoutWorker.ts`. Titles are decluttered as bodies move (US-044's rule). Subject labels
  appear per body when zoomed in. Clicks find the body, then a subject or the smallest circle; the
  copy clicked feeds the layers above the detail card. Test hook `window.__dyn`.
- `web/src/TreeCanvas.tsx`, `App.tsx`: the static canvas stays mounted and hidden while Dynamic is on,
  skipping its repaints and camera flights, and catches up on the way back.
- Tests: `e2e/dynamic.spec.ts` (US-053 to US-056; each seen to fail with Dynamic as the default,
  nothing hidden, no centre, and no re-layouts). `e2e/perf-dynamic.spec.ts` (US-057, PERF only,
  reports numbers). Full E2E: 75 passed, 4 failed (the known counts), 6 skipped.
- Files: `core/layout.ts`, `core/dynamic.ts`, `core/dynamic.test.ts`, `web/src/DynamicCanvas.tsx`,
  `web/src/layoutWorker.ts`, `web/src/App.tsx`, `web/src/TreeCanvas.tsx`, `web/src/Panels.tsx`,
  `web/src/store.ts`, `web/src/view.ts`, `web/src/styles.css`, `e2e/dynamic.spec.ts`,
  `e2e/perf-dynamic.spec.ts`.
