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
