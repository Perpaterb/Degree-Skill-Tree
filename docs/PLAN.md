# Degree-Skill-Tree: Plan

Last updated: 24 Sep 2026

A Path of Exile style passive skill tree for university degrees. Subjects are nodes, prerequisites
are the wiring, and degrees (with their majors, sub-majors and electives) are the regions of the
map a student is working towards. Students pan and zoom around the tree, click nodes for details,
mark what they have done, and see what lights up next and what it will cost. Admins build and
maintain trees for any institution without code changes. UTS is the first dataset and the proof of
concept.

Reference: <https://www.pathofexile.com/passive-skill-tree>. We copy the interaction model (pan,
zoom, allocated vs available vs locked nodes, path highlighting on hover, search that lights up
matches). We do not reuse any Path of Exile art or assets.

---

## 1. What the UTS handbook actually gives us

Findings from inspecting and part-scraping <https://coursehandbook.uts.edu.au/> on 24 Sep 2026.

### Sources

| Data | Where it lives | Format |
|---|---|---|
| List of every course / area of study / subject | `POST coursehandbook.uts.edu.au/api/search/search-academic-items` (the handbook's own search API, max 100 per page) | JSON |
| Full detail per item | Each handbook page embeds its data as `__NEXT_DATA__` (`/course/2026/C10148`, `/aos/2026/MAJ03444`, `/subject/2026/31251`) | JSON |
| Prerequisites and anti-requisites | **Not in the handbook.** The handbook links to `studentforms.uts.edu.au/evop/access/search.cfm?subjectcode=31251` | HTML table with a boolean rule |
| Fees | **Not in the handbook** (`fees_description` is empty) | Needs a separate source (see 1.4) |

The site runs on CourseLoop (a commercial handbook platform used by several Australian
universities), so the importer is likely reusable for other CourseLoop universities later.

### Counts (2026 handbook)

| Type | Count |
|---|---|
| Courses (degrees) | 441 |
| Areas of study | 933 (Majors 324, Sub-majors 234, Streams 375) |
| Subjects | 3,543 |

The handbook also publishes 2025 and 2027 editions. Students must follow the handbook of the year
they commenced, so the data model is per-year from day one.

### Shape of the data (why this maps onto a skill tree so well)

- **Course curriculum structure** is a tree of containers, each with a rule, e.g. Bachelor of IT
  (C10148, 144cp):
  - Core (48cp): *Select 6cp from* {Programming 1, Programming Fundamentals} AND 7 compulsory subjects
  - Major (48cp): choose one of 5 majors
  - Options (48cp): a second major, OR sub-majors (24cp each, 22 to choose from), OR electives
- **Areas of study** (majors, sub-majors, streams) have the same container structure, ending in subjects.
- **Study plans**: suggested Year / Session sequences per major. Very useful for default layout
  and a "recommended path" overlay.
- **Subjects**: credit points, faculty/school, level, description, learning outcomes, offerings
  (session, campus, mode), recommended prior study.
- **Requisites** are proper boolean rules over numbered items, e.g. 31272:
  `(1 AND (2 OR 2a OR 2b) AND (3 OR 3a OR 3b OR 3c OR 3d OR 3e))` where items are
  - a subject (`31269 Business Requirements Modelling`),
  - a credit-point condition (`at least 72 credit points in Bachelor's Degree owned by FEIT`),
  - occasionally a course or free text.
  Anti-requisites (cannot take both) are listed the same way.

This is richer than Path of Exile's model ("adjacent to an allocated node"): a node can need an
AND/OR of several nodes plus a "points spent" threshold. The rule engine handles all three.

### Gaps and risks found

1. **The handbook asks not to be crawled, and blocked us.** `robots.txt` is `Disallow: /`. After
   a few hundred requests at up to 4 per second, CloudFront started returning HTTP 403. The scraper
   stopped. It has since been changed to halt the whole run on the first 403 rather than retry.
   What we hold now: the full item lists (all 4,917 items) and 117 of 441 course pages, including
   C10148 Bachelor of IT. **Decision needed, see section 5.**
2. **Fees are not in the handbook.** Cost has to be modelled:
   - Domestic (Commonwealth supported): student contribution = band rate for the subject's field
     of education x EFTSL (at UTS, 6cp = 0.125 EFTSL). Band rates are set federally each year. The
     handbook's field-of-education fields (`asced_*`) are empty in the samples seen, so the band
     per subject needs another source or an admin-maintained mapping.
   - International / full fee: per-course annual fee published on uts.edu.au course pages.
   - Either way, cost becomes an **admin-editable rate table**, not scraped truth.
3. **Credit-point requisites reference categories** ("Bachelor's Degree owned by FEIT"). The planner
   can evaluate them against the student's chosen course. For a POC they are shown and evaluated
   against total credit points in the planned course.
4. **The data is large for one map.** 3,543 subjects on one canvas is well beyond PoE's ~1,300
   nodes. The student view is scoped to one course (plus the majors and electives it allows);
   the all-of-UTS view is an admin/overview mode.

---

## 2. Architecture

Constraints (24 Sep 2026): hosted on **GitHub Pages**, **no logins and no personal data** for
students, usage analytics wanted later (still no personal data). So there is no application server
and no database: the site is static, the data is static JSON, and the CMS stores its changes in git.

```
scraper/          UTS handbook importer (CourseLoop adapter). Pulls, caches, normalises. Runs locally or in GitHub Actions.
core/             Generic model, requisite evaluator, planner, progress and layout. No UI, fully unit tested.
web/              The static site (React + PixiJS). web/public/trees/ holds the normalised tree JSON it serves.
e2e/              Playwright tests, named by story ID, run against the production build or any URL.
data/raw/         Scrape cache (gitignored). data/reports/ holds coverage reports.
```

### 2.1 What Path of Exile does (checked 24 Sep 2026)

`pathofexile.com/passive-skill-tree` is a **hand-written Canvas 2D renderer** (a ~108 KB bundle,
RequireJS/jQuery era, drawing sprites from an image atlas with `drawImage`; no WebGL, no framework)
fed by **one static JSON document** embedded in the page describing every node, group, orbit and
connection. The build lives in the URL. Its speed comes from static data, pre-baked sprite art and
drawing only what is on screen, not from exotic tech.

### 2.2 Proposed stack (for discussion)

| Concern | Choice | Why |
|---|---|---|
| Tree rendering | **PixiJS v8** (WebGL, WebGPU when available) + `pixi-viewport` | GPU-batched sprites and lines stay at 60fps with 10k+ objects, glow/filters give the lit-path look cheaply, built-in hit-testing, and pan/zoom/pinch/inertia/culling come ready-made. Hand-rolled Canvas 2D (PoE's approach) is fast enough for one course but we would rewrite hit-testing, culling and zoom ourselves, and effects cost CPU. |
| UI around the canvas (panels, search, admin forms) | **React + TypeScript + Vite** | Largest ecosystem for forms and components, easiest to find help for, fast builds. React never renders nodes; Pixi owns the canvas. |
| State | Zustand | Small and explicit; shared by the canvas and the panels. |
| Data | Static JSON per tree (index + one file per course), like PoE | Instant loads from the CDN, no server, cacheable, diffable in git. |
| Student plans | `localStorage` + plan encoded in the URL | No accounts and no personal data; a plan is shareable as a link, as in PoE. |
| Admin CMS | Editor inside the same app; saves by committing JSON through the GitHub API | Git gives drafts (branch/PR), publishing (merge, then auto-deploy), history and rollback for free. Editors are the repo's GitHub collaborators. |
| Hosting / deploy | GitHub Pages via GitHub Actions | Required. Every merge to `main` rebuilds and deploys. |
| Analytics (later) | Cookieless, no personal data (Plausible, Umami, GoatCounter or Cloudflare Web Analytics), behind our own `track()` hook | The hook exists from day one as a no-op, so adding a provider later changes one file. |
| Tests | Vitest (core + scraper), Playwright (E2E through the built site) | Per the testing rules: E2E tagged by story ID. |

Admin sign-in on a static host: GitHub's OAuth web flow needs a server-side secret, which Pages
cannot hold. For the POC the admin pastes a fine-grained GitHub token (scoped to this repo, kept in
`sessionStorage` only). If that becomes a chore, a tiny serverless OAuth exchange (e.g. a Cloudflare
Worker) can be added later without changing the editor.

### 2.3 Generic data model (institution-agnostic)

Nothing in the model says "UTS". The UTS importer is one adapter that writes into it.

- **Tree**: an institution + handbook year.
- **Node**: `kind` = subject | container (group/rule) | program (major, sub-major, stream) | degree.
  Carries display fields (title, code, credit points, description, tags/"stats") plus free-form
  attributes so admins can add fields without code changes.
- **Requirement**: the rule tree: `and` / `or` over `{node}`, `{credit_points >= n in scope}`,
  `{text}` (shown, not evaluated). Plus anti-requisites.
- **Structure rule**: a container's "select N credit points from these children" (PoE has no
  equivalent; this is how degree completion is computed).
- **Layout**: position per node, plus PoE-style groups and orbits for clusters. Auto-generated first,
  then hand-tuned by admins and saved.
- **Cost model**: rate tables per year and student type, joined to subjects by band or override.

### 2.4 Rendering (the part that has to feel like PoE)

- Level of detail: at far zoom, degree regions and major clusters with labels; closer, subject nodes;
  closest, codes and titles on nodes.
- Node states, visually distinct: **completed**, **planned**, **available now** (requisites met),
  **locked** (not met), **excluded** (anti-requisite clash), **searched/matched**.
- Hover: highlight the requisite chain back to what you already have (PoE's "path to this node"),
  and what this node unlocks forward.
- Click: side panel with the full subject detail, requisite rule in plain language, offerings, cost
  and handbook link.

### 2.5 Layout strategy

Degrees sit as large hubs. Each major/sub-major is a cluster (PoE "group") arranged around its
degree, with subjects placed in rings by prerequisite depth: foundation subjects on the inner ring,
capstones on the outer. Study-plan year/session ordering breaks ties. Subjects shared across
majors sit between the clusters that use them. Admins can then drag anything and save it.

### 2.6 Admin CMS (updatable without code changes)

- Create a tree from scratch, or import (UTS handbook adapter via a GitHub Action, CSV/JSON upload).
- Visual editor on the same canvas: drag nodes, draw/remove requisite links, group into clusters.
- Form editors for node fields, requisite rules (visual AND/OR builder), structure rules and cost tables.
- Save = commit to a draft branch; publish = merge to `main`, which redeploys. History and rollback are git.
- Re-import diff: when the handbook changes, show what changed and let the admin accept per item,
  without losing hand-tuned layout.

---

## 3. Phases

| Phase | Outcome | Depends on |
|---|---|---|
| 0. Data | Normalised UTS dataset for the chosen scope, with a coverage report | Scrape decision (section 5) |
| 1. Core engine | Generic model, requisite evaluator, degree-progress calculator, all unit tested | 0 |
| 2. Tree viewer | Pan/zoom WebGL tree for one course, node states, detail panel, search | 1 |
| 3. Planner | Mark completed/planned, availability updates live, path highlight, progress to degree, cost | 2 |
| 4. Admin CMS | GitHub-backed editing, tree editor, rule builder, cost tables, draft/publish | 1, 6 |
| 6. Hosting | GitHub Pages deploy pipeline and smoke suite (brought forward as soon as there is a page to show) | 2 |
| 5. Scale-out | All UTS courses, multi-year, re-import diffing, other CourseLoop institutions | 0-4 |

Phases 2-3 are where "feeling right" gets iterated; expect several passes on layout and visuals.

---

## 4. User stories

Approved 24 Sep 2026. They live in [`UserStories.md`](UserStories.md), with the technical log in
[`TechFromUserStories.md`](TechFromUserStories.md).

---

## 5. Decisions

Made 24 Sep 2026:

1. Scrape: **POC slice only** (Bachelor of IT, C10148, and everything it reaches), slowly. Ask UTS for
   a data export for the full catalogue.
2. Handbook year: **2027** first.
3. User stories US-001 to US-016 approved; adjusted for the hosting constraints below (see
   `docs/UserStories.md`), and US-017 / US-018 added.
4. Hosting: **GitHub Pages**. No student logins, no personal data. Usage analytics later, without
   personal data.

Open:

- Stack confirmed 24 Sep 2026: PixiJS + React. Legacy subjects shown greyed.

---

## 6. Long-term vision (after the MVP)

Recorded 24 Sep 2026. Not in current scope; it is here so today's choices do not close it off.

- **Every level of education, every institution.** Beyond university degrees: high school and
  college pathways, in institutions around the world. Domains held: degreeskilltree.com,
  universityskilltree.com, highschoolskilltree.com, collegeskilltree.com.
- **Pathway questions students actually ask.** For example: am I better off doing Unit 2 maths
  instead of Unit 1 if I want to get into a particular uni subject, or reach a particular UAI/ATAR?
- **Tracking from real marks.** A student enters the marks they are getting now in each subject;
  the tree shows how they are tracking towards their goal and what to work on.
- **Data.** A massive collection effort, started small and grown institution by institution.
- **Revenue.** Targeted advertising on the public site, and an institution-only (white-label)
  version that schools and universities embed on their own sites.

What this means for the MVP:

- Keep `core/model.ts` institution- and level-agnostic: nothing in core may assume "UTS" or
  "university". High school subjects, units and results must fit the same tree/rule model.
- Rules will need a new kind of condition, on marks and scores (e.g. "a Band 5 in Maths Advanced"),
  not just "completed"; the `Rule` union is where that goes.
- The planned Firebase admin model (per-institution trees published as links) is the seed of the
  white-label product.

