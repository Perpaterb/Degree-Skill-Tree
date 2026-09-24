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

TypeScript end to end, one repo.

```
scraper/        UTS handbook importer (CourseLoop adapter). Pulls, caches, normalises.
data/           Normalised datasets committed to git (raw cache is gitignored).
packages/core/  The generic model + rule engine + planner logic. No UI, fully unit tested.
apps/web/       Student tree viewer/planner and the admin editor (React + Vite).
apps/api/       API + persistence for the CMS (Node, Postgres).
```

### 2.1 Generic data model (institution-agnostic)

Nothing in the model says "UTS". The UTS importer is one adapter that writes into it.

- **Tree**: an institution + handbook year + version (draft or published).
- **Node**: `kind` = subject | container (group/rule) | program (major, sub-major, stream) | degree.
  Carries display fields (title, code, credit points, description, tags/"stats") plus free-form
  attributes so admins can add fields without code changes.
- **Requirement**: the rule tree from above: `and` / `or` over `{node}`, `{credit_points >= n in scope}`,
  `{text}` (shown, not evaluated). Plus anti-requisites.
- **Structure rule**: a container's "select N credit points from these children" (Path of Exile has
  no equivalent; this is how degree completion is computed).
- **Layout**: position per node per tree, plus PoE-style groups and orbits for clusters. Auto-generated
  first, then hand-tuned by admins and saved.
- **Cost model**: rate tables per student type, joined to subjects by band or override.

### 2.2 Rendering (the part that has to feel like PoE)

- WebGL canvas via **PixiJS** with a pan/zoom viewport. The DOM cannot handle thousands of nodes and
  edges smoothly; PoE's own web tree is canvas-based.
- Level of detail: at far zoom, degree regions and major clusters with labels; closer, subject nodes;
  closest, codes and titles on nodes.
- Node states, visually distinct: **completed**, **planned**, **available now** (requisites met),
  **locked** (not met), **excluded** (anti-requisite clash), **searched/matched**.
- Hover: highlight the requisite chain back to what you already have (PoE's "path to this node"),
  and what this node unlocks forward.
- Click: side panel with the full subject detail, requisite rule rendered readably, offerings,
  cost, and handbook link.

### 2.3 Layout strategy

Degrees sit as large hubs. Each major/sub-major is a cluster (PoE "group") arranged around its
degree, with subjects placed in rings by prerequisite depth: foundation subjects on the inner ring,
capstones on the outer. Study-plan year/session ordering breaks ties. Subjects shared across
majors sit between the clusters that use them. Admins can then drag anything and save it.

### 2.4 Admin CMS (updatable without code changes)

- Create a tree from scratch, or import (UTS handbook adapter, CSV/JSON).
- Visual editor on the same canvas: drag nodes, draw/remove requisite links, group into clusters.
- Form editors for node fields, requisite rules (visual AND/OR builder), structure rules and cost tables.
- Draft then publish, with version history and rollback. Students always see the published version.
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
| 4. Admin CMS | Accounts, tree editor, rule builder, cost tables, draft/publish | 1, API + DB |
| 5. Scale-out | All UTS courses, multi-year, re-import diffing, other CourseLoop institutions | 0-4 |

Phases 2-3 are where "feeling right" gets iterated; expect several passes on layout and visuals.

---

## 4. Proposed user stories (awaiting approval)

IDs are sequential `US-###`. Once approved these move into `docs/UserStories.md`, and tech notes go
into `docs/TechFromUserStories.md`.

### Data

**US-001 Pull the UTS handbook catalogue.** As the project owner, I want every 2026 course, area of
study and subject listed so the dataset is complete.
- [x] Lists all courses, areas of study and subjects for a handbook year, matching the search API totals (441 / 933 / 3,543)
- [ ] Fetches detail for every item in scope, cached so no page is fetched twice
- [x] Stops the whole run on HTTP 403 and never retries against a block
- [ ] Writes a coverage report: items in scope, fetched, failed

**US-002 Pull prerequisites.** As the project owner, I want every in-scope subject's requisites and
anti-requisites as evaluable rules.
- [x] Parses the boolean rule into a tree (AND binds tighter than OR); malformed rules error, not guess
- [x] Classifies items as subject, course, credit-point condition, or text
- [ ] Every `ref` in every parsed rule resolves to an item (checked across the whole dataset)
- [ ] Report of subjects whose requisites reference subjects missing from the dataset

**US-003 Normalise into the generic model.** As a developer, I want the UTS data in the
institution-agnostic format so the app never reads CourseLoop shapes directly.
- [ ] Subjects, programs (major/sub-major/stream), degrees and structure containers in the generic model
- [ ] Structure rules keep their "select N cp" semantics and AND/OR connectors
- [ ] Study plans kept as suggested sequences
- [ ] Round-trip test: C10148 normalised structure totals 144cp and matches the handbook groups

### Tree viewer

**US-004 Explore a degree as a skill tree.** As a student, I want to pan and zoom a PoE-style map of
my degree so I can see the whole shape of it.
- [ ] Smooth pan (drag) and zoom (wheel/pinch) at 60fps on a mid-range laptop with the largest course loaded
- [ ] Degree hub, major/sub-major clusters and subject nodes laid out automatically
- [ ] Requisite links drawn between subjects; level of detail changes with zoom
- [ ] Works on a phone-width screen with touch

**US-005 Inspect a subject.** As a student, I want to click a node and see everything about it.
- [ ] Panel shows code, title, credit points, description, learning outcomes, offerings (session/campus/mode)
- [ ] Requisite rule shown in plain language, each referenced subject clickable (flies the camera to it)
- [ ] Anti-requisites and recommended prior study shown
- [ ] Link to the official handbook page

**US-006 Search the tree.** As a student, I want to type a code or keyword and see matching nodes light up.
- [ ] Matches by code, title and description; matches highlighted, rest dimmed
- [ ] Enter cycles the camera through matches

### Planner

**US-007 Mark what I have done.** As a student, I want to mark subjects completed so the tree shows
what is open to me now.
- [ ] Click to toggle completed; completed nodes and links render as "allocated"
- [ ] Every other node recomputes available / locked / excluded from its requisite rule, including credit-point conditions
- [ ] Plan saved and restorable (browser for anonymous users; account later)

**US-008 See what unlocks what.** As a student, I want hovering a node to show the chain needed to
reach it and what it opens up.
- [ ] Hover a locked node: highlights the missing requisites back to my completed set (shortest route for OR branches)
- [ ] Hover any node: highlights the subjects it directly unlocks
- [ ] Explains in text why a locked node is locked

**US-009 Plan a path to my degree.** As a student, I want to choose a major and plan future subjects
and see progress to graduation.
- [ ] Choose major/sub-majors/electives the course allows
- [ ] Mark subjects as planned; progress per structure container ("Core: 30/48cp") and overall (x/144cp)
- [ ] Warn when a plan breaks a rule (anti-requisite, over-selecting an option group, requisite not met by the time it is planned)
- [ ] Optional session-by-session view using offerings

**US-010 See the cost.** As a student, I want to see what my remaining plan will cost.
- [ ] Cost per subject and total for completed / planned / remaining, by student type (domestic CSP, international)
- [ ] Costs come from admin-maintained rate tables and are labelled as estimates with their year

### Admin CMS

**US-011 Admin accounts.** As an admin, I want to sign in so only authorised people can edit trees.
- [ ] Admin login; students need no account to browse or plan
- [ ] Roles: admin (everything), editor (edit drafts, cannot publish)

**US-012 Create and import trees.** As an admin, I want to create a tree for my institution from
scratch or by import.
- [ ] Create empty tree (institution, year)
- [ ] Import from the UTS/CourseLoop adapter and from CSV/JSON
- [ ] Import report of what was created and anything that could not be mapped

**US-013 Edit the tree visually.** As an admin, I want to edit nodes, links and layout on the canvas.
- [ ] Drag nodes/clusters and save positions
- [ ] Add/edit/delete nodes and their fields, including custom fields, without code changes
- [ ] Visual AND/OR requisite builder; structure-rule editor ("select N cp from")
- [ ] Undo/redo

**US-014 Draft and publish.** As an admin, I want changes to go live only when I publish.
- [ ] Students only ever see the published version
- [ ] Version history with rollback

**US-015 Maintain cost tables.** As an admin, I want to edit fee rates so costs stay current without a deploy.
- [ ] Rate tables per year and student type; subject-to-band mapping with per-subject overrides

**US-016 Re-import changes.** As an admin, I want to re-run the handbook import and review what changed.
- [ ] Diff of added / changed / removed items; accept or reject per item
- [ ] Hand-tuned layout and manual edits preserved

---

## 5. Decisions needed

1. **How to continue the scrape**, given `robots.txt` says no and the CDN is now blocking:
   - (a) *Recommended:* POC slice only. Bachelor of IT (C10148), its majors/sub-majors and their
     subjects: roughly 300 requests, fetched at 1 request every 3 seconds (~15 min) once the block
     lifts. Enough to build and prove the whole experience. In parallel, ask UTS for a data export
     for the full dataset.
   - (b) Full pull, very slowly (1 request every 3-5 s, ~8 hours overnight, resumable).
   - (c) No more scraping until UTS agrees; build against the 117 courses already cached.
2. **Handbook year**: 2026 (current, what enrolled students follow) or 2027 (just published, what new
   students will follow). The model supports both; this is only about which to load first.
3. **Approval of the user stories above**, and of the stack (React + PixiJS web app, Node API, Postgres).
