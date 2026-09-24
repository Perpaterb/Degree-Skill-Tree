# User Stories

Degree-Skill-Tree: a Path of Exile style skill tree for planning a university degree.
Source of truth for scope and progress. Technical notes per story are in
[`TechFromUserStories.md`](TechFromUserStories.md). Background and architecture are in [`PLAN.md`](PLAN.md).

Status key: `[x]` done and verified, `[ ]` not done. Partial work is noted inline.

Approved 24 Sep 2026. Adjusted the same day for the hosting decision (GitHub Pages, no logins, no
personal data): US-007, US-011, US-012, US-014 changed; US-017 and US-018 added.

---

## Data

### US-001 Pull the UTS handbook catalogue
As the project owner, I want the handbook's courses, areas of study and subjects pulled so the
tree is built from real data.
- [x] Lists all courses, areas of study and subjects for a handbook year, matching the search API totals (2026: 441 / 933 / 3,543)
- [ ] Fetches detail for every item in scope (POC scope: C10148 Bachelor of IT, 2027, and everything it reaches), cached so no page is fetched twice
- [x] Stops the whole run on HTTP 403 and never retries against a block
- [ ] Writes a coverage report: items in scope, fetched, failed

### US-002 Pull prerequisites
As the project owner, I want every in-scope subject's requisites and anti-requisites as evaluable rules.
- [x] Parses the boolean rule into a tree (AND binds tighter than OR); malformed rules error rather than guess
- [x] Classifies items as subject, course, credit-point condition, or text
- [ ] Every `ref` in every parsed rule resolves to an item (checked across the whole dataset)
- [ ] Report of subjects whose requisites reference subjects missing from the dataset

### US-003 Normalise into the generic model
As a developer, I want the UTS data in the institution-agnostic format so the app never reads
CourseLoop shapes directly.
- [ ] Subjects, programs (major/sub-major/stream), degrees and structure containers in the generic model
- [ ] Structure rules keep their "select N cp" semantics and AND/OR connectors
- [ ] Study plans kept as suggested sequences
- [ ] Round-trip test: C10148 normalised structure totals 144cp and matches the handbook groups

## Tree viewer

### US-004 Explore a degree as a skill tree
As a student, I want to pan and zoom a PoE-style map of my degree so I can see the whole shape of it.
- [ ] Smooth pan (drag) and zoom (wheel/pinch): a scripted Playwright pan/zoom over the largest course loaded holds a median of at least 55fps (in-app frame counter) on the dev machine
- [ ] Degree hub, major/sub-major clusters and subject nodes laid out automatically
- [ ] Requisite links drawn between subjects; level of detail changes with zoom
- [ ] Works on a phone-width screen with touch

### US-005 Inspect a subject
As a student, I want to click a node and see everything about it.
- [ ] Panel shows code, title, credit points, description, learning outcomes, offerings (session/campus/mode)
- [ ] Requisite rule shown in plain language, each referenced subject clickable (flies the camera to it)
- [ ] Anti-requisites and recommended prior study shown
- [ ] Link to the official handbook page

### US-006 Search the tree
As a student, I want to type a code or keyword and see matching nodes light up.
- [ ] Matches by code, title and description; matches highlighted, the rest dimmed
- [ ] Enter cycles the camera through matches

## Planner

### US-007 Mark what I have done
As a student, I want to mark subjects completed so the tree shows what is open to me now.
- [ ] Click to toggle completed; completed nodes and links render as "allocated"
- [ ] Every other node recomputes available / locked / excluded from its requisite rule, including credit-point conditions
- [ ] Plan kept in the browser (`localStorage`) with no account, and restorable after a reload
- [ ] Plan encoded in a shareable URL that reproduces it exactly on another device

### US-008 See what unlocks what
As a student, I want hovering a node to show the chain needed to reach it and what it opens up.
- [ ] Hover a locked node: highlights the missing requisites back to my completed set; where a rule has OR branches, the branch needing the fewest additional credit points is shown
- [ ] Hover any node: highlights the subjects it directly unlocks
- [ ] Explains in text why a locked node is locked

### US-009 Plan a path to my degree
As a student, I want to choose a major and plan future subjects and see progress to graduation.
- [ ] Choose major/sub-majors/electives the course allows
- [ ] Mark subjects as planned; progress per structure container ("Core: 30/48cp") and overall (x/144cp)
- [ ] Warn when a plan breaks a rule (anti-requisite, over-selecting an option group, requisite not met by the time it is planned)
- [ ] Optional session-by-session view using offerings

### US-010 See the cost
As a student, I want to see what my remaining plan will cost.
- [ ] Cost per subject and total for completed / planned / remaining, by student type (domestic CSP, international)
- [ ] Costs come from admin-maintained rate tables and are labelled as estimates with their year

## Admin CMS

### US-011 Admin access
As an admin, I want only authorised people to be able to change a tree, without the site holding any accounts.
- [ ] Students need no account to browse or plan
- [ ] Editing requires a GitHub identity with write access to the repo; the site stores no accounts or personal data
- [ ] Roles follow repo permissions: write access can save drafts; merging to `main` (publishing) follows the repo's branch rules

### US-012 Create and import trees
As an admin, I want to create a tree for my institution from scratch or by import.
- [ ] Create an empty tree (institution, year)
- [ ] Import from the UTS/CourseLoop adapter, run as a GitHub Action (the browser cannot scrape the handbook), and from CSV/JSON upload
- [ ] Import report of what was created and anything that could not be mapped

### US-013 Edit the tree visually
As an admin, I want to edit nodes, links and layout on the canvas.
- [ ] Drag nodes/clusters and save positions
- [ ] Add/edit/delete nodes and their fields, including custom fields, without code changes
- [ ] Visual AND/OR requisite builder; structure-rule editor ("select N cp from")
- [ ] Undo/redo

### US-014 Draft and publish
As an admin, I want changes to go live only when I publish.
- [ ] Saving commits to a draft branch; students only ever see what is on `main`
- [ ] Publishing merges the draft, which redeploys the site
- [ ] Version history and rollback through git (list of published versions, one-click revert)

### US-015 Maintain cost tables
As an admin, I want to edit fee rates so costs stay current without a code change.
- [ ] Rate tables per year and student type; subject-to-band mapping with per-subject overrides

### US-016 Re-import changes
As an admin, I want to re-run the handbook import and review what changed.
- [ ] Diff of added / changed / removed items; accept or reject per item
- [ ] Hand-tuned layout and manual edits preserved

## Platform

### US-017 Host on GitHub Pages
As the project owner, I want the site published on GitHub Pages automatically so there is nothing to run.
- [ ] Merging to `main` builds and deploys the site through GitHub Actions
- [ ] Works under the Pages sub-path (`/Degree-Skill-Tree/`), including deep links to a course and a shared plan
- [ ] `./scripts/smoke.sh --target <url>` passes against the deployed site before it is announced

### US-018 Usage analytics without personal data (later)
As the project owner, I want to know what people look at and do on the site, without collecting personal data.
- [ ] All tracking goes through one `track(event, props)` hook, a no-op until a provider is chosen
- [ ] No cookies, no user IDs, no IP storage; provider chosen from cookieless options
- [ ] Events cover course opened, node inspected, subject marked done/planned, search used, plan shared
