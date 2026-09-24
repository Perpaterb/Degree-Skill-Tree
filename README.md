# Degree Skill Tree

Plan a university degree the way you plan a Path of Exile build. Subjects are nodes, prerequisites
are the links, and majors are clusters around the degree. Mark what you have done, see what opens
up, and track progress to graduation.

**Live:** <https://perpaterb.github.io/Degree-Skill-Tree/>

The first dataset is the UTS Bachelor of Information Technology (C10148) from the 2027 handbook.

## Local development

### In containers (recommended)

Needs Docker with Compose.

```bash
docker compose up                    # dev server with hot reload
```

Then open <http://localhost:5173/Degree-Skill-Tree/>. Edits on your machine reload in the browser.

```bash
docker compose run --rm test         # unit tests + E2E stories against a production build
docker compose run --rm tools npm run story-coverage
docker compose run --rm tools npm run scrape -- slice C10148
docker compose down                  # stop
```

### Without containers

Needs Node 20.19+ (22 recommended).

```bash
npm ci
npm run dev                          # http://localhost:5173/Degree-Skill-Tree/
npm test                             # unit tests
npm run test:e2e                     # E2E stories (npx playwright install chromium first)
npm run test:perf                    # frame-rate check on the real GPU
npm run test:verify-fails            # plants known bugs; every one must turn the suite red
npm run story-coverage               # which user stories have an E2E test
./scripts/smoke.sh --target <url>    # smoke any deployed environment
```

## Data

`scraper/` pulls a degree from the UTS handbook and normalises it into the generic tree format in
`core/model.ts`. The handbook asks not to be crawled, so the scraper is slow, caches every page
under `data/raw/` (gitignored), and stops at the first refusal.

```bash
HANDBOOK_YEAR=2027 SCRAPE_GAP_MS=3000 SCRAPE_CONCURRENCY=1 npm run scrape -- slice C10148
HANDBOOK_YEAR=2027 npm run scrape -- report C10148
HANDBOOK_YEAR=2027 npm run scrape -- normalize C10148   # writes web/public/trees/
```

## Deploying

`.github/workflows/deploy.yml` builds, tests and publishes to GitHub Pages. It is started manually
(Actions, Deploy to GitHub Pages, Run workflow) with a test scope: `all`, `unit` or `none`.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md): findings, architecture and phases
- [`docs/UserStories.md`](docs/UserStories.md): stories and acceptance criteria
- [`docs/TechFromUserStories.md`](docs/TechFromUserStories.md): what was built for each story
