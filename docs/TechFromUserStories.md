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
