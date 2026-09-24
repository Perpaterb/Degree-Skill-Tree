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
