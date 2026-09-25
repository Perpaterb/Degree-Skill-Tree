# User Stories

Degree-Skill-Tree: a Path of Exile style skill tree for planning a university degree.
Source of truth for scope and progress. Technical notes per story are in
[`TechFromUserStories.md`](TechFromUserStories.md). Background and architecture are in [`PLAN.md`](PLAN.md).

Status key: `[x]` done and verified, `[ ]` not done. Partial work is noted inline.

Approved 24 Sep 2026. Adjusted the same day for the hosting decision (GitHub Pages, no logins, no
personal data): US-007, US-011, US-012, US-014 changed; US-017 and US-018 added. Later the same day:
US-019 to US-023 added (several degrees on one map, circles as the selectable units); US-004 and
US-009 changed to match. Later again: circles stop overlapping (linked copies instead), rings by
depth, US-024 railway-style links added, and a "does not count" list added to US-022. 25 Sep 2026:
US-025 added (warn before marking completed without prerequisites); US-007 noted to match. Later:
US-026 and US-027 added (green / blue progress on circles and the degree outline); planned subjects
turn blue (US-009); numbered option ways counted properly (US-022). Then planned changed from blue
to purple (too much other blue on the map), and "what this unlocks" paths from purple to crimson.
Later: US-028 to US-032 added (progress on circle titles, view settings, light and dark mode,
progress on each outline way, what fills elective slots). US-030 ends "the tree is always dark".

---

## Data

### US-001 Pull the UTS handbook catalogue
As the project owner, I want the handbook's courses, areas of study and subjects pulled so the
tree is built from real data.
- [x] Lists all courses, areas of study and subjects for a handbook year, matching the search API totals (2026: 441 / 933 / 3,543)
- [ ] Fetches detail for every item in scope (POC scope: C10148 Bachelor of IT, 2027, and everything it reaches), cached so no page is fetched twice. *Partial: everything the handbook publishes was fetched; 1 area of study and 6 subjects in the structure return 404 in the 2027 handbook (see `data/reports/coverage-2027-C10148.json`). Decision pending on how to represent them.*
- [x] Stops the whole run on HTTP 403 and never retries against a block
- [x] Writes a coverage report: items in scope, fetched, failed (exits non-zero when anything in scope is missing)

### US-002 Pull prerequisites
As the project owner, I want every in-scope subject's requisites and anti-requisites as evaluable rules.
- [x] Parses the boolean rule into a tree (AND binds tighter than OR); malformed rules error rather than guess
- [x] Classifies items as subject, course, credit-point condition, or text
- [ ] Every `ref` in every parsed rule resolves to an item (checked across the whole dataset)
- [ ] Report of subjects whose requisites reference subjects missing from the dataset

### US-003 Normalise into the generic model
As a developer, I want the UTS data in the institution-agnostic format so the app never reads
CourseLoop shapes directly.
- [x] Subjects, programs (major/sub-major/stream), degrees and structure containers in the generic model
- [x] Structure rules keep their "select N cp" semantics (the source's AND/OR connector is always AND in practice; containers are modelled as "complete N cp from these")
- [x] Study plans kept as suggested sequences
- [x] Round-trip test: C10148 normalised structure totals 144cp and matches the handbook groups

## Tree viewer

### US-004 Explore a degree as a skill tree
As a student, I want to pan and zoom a PoE-style map of my degree so I can see the whole shape of it.
- [x] Smooth pan (drag) and zoom (wheel/pinch): a scripted Playwright pan/zoom over the largest course loaded holds a median of at least 55fps (in-app frame counter) on the dev machine. *24 Sep 2026, C10148 on Intel Iris Xe: median 59.9fps, p95 59.9fps (`npm run test:perf`).*
- [x] Degrees, majors, sub-majors and streams laid out automatically as circles enclosing their subjects (see US-020). *Changed 24 Sep 2026: was "degree hub and major clusters", which was built and verified; the circle model replaces it.*
- [x] Requisite links drawn between subjects; level of detail changes with zoom (subject codes hide when zoomed out; cluster titles grow)
- [ ] Works on a phone-width screen with touch. *Partial: phone-width layout (bottom sheet, no horizontal scroll) verified by E2E on a Pixel 7 profile; touch pan/pinch is enabled but not yet verified on a real device.*

### US-005 Inspect a subject
As a student, I want to click a node and see everything about it.
- [x] Panel shows code, title, credit points, description, learning outcomes, offerings (session/campus/mode)
- [x] Requisite rule shown in plain language, each referenced subject clickable (flies the camera to it)
- [x] Anti-requisites and recommended prior study shown
- [x] Link to the official handbook page

### US-006 Search the tree
As a student, I want to type a code or keyword and see matching nodes light up.
- [x] Matches by code, title and description; matches highlighted, the rest dimmed
- [x] Enter cycles the camera through matches

## Planner

### US-007 Mark what I have done
As a student, I want to mark subjects completed so the tree shows what is open to me now.
- [x] Click to toggle completed; completed nodes and links render as "allocated". *From 25 Sep 2026, a subject whose prerequisites are not met asks first (US-025).* *Toggled from the detail panel (click the node, then Mark completed). Gold rendering checked by screenshot, not by an automated assertion.*
- [x] Every other node recomputes available / locked / excluded from its requisite rule, including credit-point conditions
- [x] Plan kept in the browser (`localStorage`) with no account, and restorable after a reload
- [x] Plan encoded in a shareable URL that reproduces it exactly on another device (verified in a separate browser profile)

### US-008 See what unlocks what
As a student, I want hovering a node to show the chain needed to reach it and what it opens up.
- [ ] Hover a locked node: highlights the missing requisites back to my completed set; where a rule has OR branches, the branch needing the fewest additional credit points is shown. *Partial: branch choice is unit tested (`missingFor`); the canvas highlight is implemented but has no automated check yet.*
- [ ] Hover any node: highlights the subjects it directly unlocks. *Implemented and seen in a screenshot; no automated check yet.*
- [x] Explains in text why a locked node is locked

### US-009 Plan a path to my degree
As a student, I want to choose a major and plan future subjects and see progress to graduation.
- [x] Choose major/sub-majors/electives the course allows by clicking their circles (click the circle, then Choose in its panel; free electives are filled automatically from anything left over). *Changed 24 Sep 2026: choosing via the ◆ node panel was built and verified; choosing moves to circles (US-020, US-022).*
- [x] Mark subjects as planned; progress per structure container ("Core: 30/48cp") and overall (x/144cp)
- [x] Planned subjects are drawn purple (fill and outline), distinct from "Available now". *Added 25 Sep 2026: was green; green now means complete (US-026, US-027). Blue tried first, changed to purple the same day: too much other blue on the map.*
- [ ] Warn when a plan breaks a rule (anti-requisite, over-selecting an option group, requisite not met by the time it is planned)
- [ ] Optional session-by-session view using offerings

### US-010 See the cost
As a student, I want to see what my remaining plan will cost.
- [ ] Cost per subject and total for completed / planned / remaining, by student type (domestic CSP, international)
- [ ] Costs come from admin-maintained rate tables and are labelled as estimates with their year

## Multi-degree map

### US-019 Several degrees on one map
As a student, I want several degrees on one map so I can see where my subjects could take me.
- [x] Bachelor of Computing Science (C10476), Bachelor of Cybersecurity (C10471) and Bachelor of Business (C10026), 2027 handbook, pulled slowly alongside the Bachelor of IT (C10148)
- [x] One map holds all four degrees; a subject or program shared between degrees exists once
- [x] One plan covers the whole map; links made before this change (`#t=uts-2027-C10148&...`) still open with their plan

### US-020 Degrees and majors as enclosing circles
As a student, I want each degree, major, sub-major and stream drawn as a circle around everything in it, so I can see what belongs where.
- [x] Every circle whose structure lists a subject contains a copy of that subject; a program offered by one degree sits inside that degree's circle, and a program offered by several sits outside them all. *Changed 24 Sep 2026: circles no longer overlap (see below); the overlapping version was built and verified.*
- [x] Circles never overlap (a circle may only contain another); a subject listed by several groups appears as a copy in each, and all copies share one state: marking, hovering or selecting any copy lights up every copy. No lines join copies. *Changed 24 Sep 2026: was "circles may overlap; a shared subject sits in the overlap", built and verified, then found too cluttered.*
- [x] No centre node for programs: the circle itself is the selectable thing; hovering a circle makes it glow
- [x] Inside each circle, subjects sit on rings by prerequisite depth: foundations in the middle, the most advanced on the outside. Subjects that require each other in a loop share a ring.
- [x] Clicking empty space selects the smallest circle under the pointer (ties: nearest centre); clicking within 10px inside an outline selects that outline's circle, so circles fully covered by smaller ones stay selectable; clicking a subject still selects the subject. *Rim rule added 24 Sep 2026: without it, 4 real circles could not be selected at all.*

### US-021 Select a degree and work backwards
As a student, I want to pick the degree I am aiming for and see what it needs.
- [x] Clicking a degree circle selects it; it stays selected until another degree is selected or the selection is cleared
- [ ] The selected degree's remaining requirements stand out: its subjects I still need are highlighted, and the other degrees' outlines dim (their compatibility shading from US-023 stays visible). *Partial: implemented (gold rings on still-needed compulsory subjects, other degrees dimmed); checked by screenshot only, no automated check.*
- [x] The selected degree is part of the shareable link and survives a reload
- [x] Majors and sub-majors are chosen by clicking their circles while their degree is selected (the panel offers Choose only when the selected degree offers the program)

### US-022 Progress panel for the selected degree
As a student, I want progress shown for the degree I have selected, and to see which parts of the map each requirement means.
- [x] The progress panel appears only while a degree is selected
- [x] Hovering a row makes the circles or subjects it refers to glow (e.g. hovering "Majors" under the Bachelor of IT glows the major circles)
- [x] Completed subjects that do not count toward the selected degree are listed at the bottom of the panel, with a note saying they do not count
- [x] Where the handbook offers numbered ways to fill a requirement (e.g. Options: "1. one major (48cp); 2. two sub-majors (2 x 24cp); ..."), the requirement counts the best way, so two completed sub-majors give 48/48cp, not 24/48cp. *Added 25 Sep 2026: bug found in review; before, each heading stopped at its own credit points.*

### US-023 See which degrees are still open
As a student, I want to see, from what I have completed, which degrees I can still go for.
- [ ] With subjects completed, each degree circle's fill greys in proportion to the completed credit points that cannot count toward it (over its free-elective allowance, or clashing with one of its compulsory subjects); fully grey only when it can no longer be completed. Shown whether or not a degree is selected. *Partial: the fit (counting cp, grey fraction, impossible) is unit and E2E tested; the canvas shading itself is checked by screenshot only. Open question on the anti-requisite rule, see TechFromUserStories US-023.*
- [x] With no degree selected, degrees that are still open stay selectable (greyed ones too)
- [x] Selecting a greyed degree highlights the completed subjects that stand in its way and says why each one does not count (listed in its panel; red rings on the map)

### US-024 Railway-style connections
As a student, I want requisite links drawn like a railway map, so I can follow them without a tangle.
- [x] Links are curved paths made of radial and ring-following segments with rounded corners, not straight lines across the map
- [x] Where two links cross, they cross at between 45 and 135 degrees; links never run on top of each other. *Met 25 Sep 2026: 0 crossings under 45 degrees, 0 pairs running together, 0 links over a subject, asserted exactly in `core/layout.test.ts`.*
- [x] A link joins copies in the same circle; a subject's prerequisite that is not in that circle appears there as an entry copy, drawn distinctly, so links never have to leave their circle

### US-025 Warn before marking a subject completed without its prerequisites
As a student, I want a warning if I mark a subject completed before its prerequisites, so I notice gaps in my record. I can still mark it anyway, for example for credit from elsewhere or a waiver.
- [x] Clicking "Mark completed" on a subject whose prerequisites are not met by my completed subjects opens a pop-up instead of marking it straight away. Subjects that are only planned do not count as completed.
- [x] The pop-up lists what needs to be completed first: the subject's requisite rule in full, as in the Requisites section (every option of a "one of", with its state), and under any option that is not completed, what that option needs first in turn ("for example ..." when it has alternatives of its own). *Changed 25 Sep 2026: was the single cheapest route plus "other combinations would also work"; testing showed it hid the other options (41001 has six).*
- [x] Two buttons: "Close" changes nothing (Escape and clicking outside also close it); "Mark as completed anyway" marks it exactly as before.
- [x] No pop-up when the prerequisites are met, when the subject has no prerequisites, or when un-marking a completed subject. "Plan it" never warns. Anti-requisite clashes are out of scope.
- [x] An E2E test walks the flow through the real UI: pop-up on a locked subject lists what is missing; Close changes nothing; Mark anyway marks it and the mark survives a reload.

### US-026 Finished circles glow
As a student, I want circles I have finished, or will finish with my plan, to stand out, so I can see at a glance what is done.
- [x] A major, sub-major or stream circle gets a green glow around the outside when my completed subjects meet its requirements, and a purple glow when my completed plus planned subjects would meet them. Worked out the same way as the progress panel, whether or not the program is chosen.
- [x] A degree circle glows green when the degree is complete, purple when the plan completes it.
- [x] The glow is only around the outside; a chosen program keeps its yellow outline.
- [x] An E2E test: every subject of a sub-major completed glows it green; planned instead glows it purple; partly done does not glow.

### US-027 Degree outline shows progress
As a student, I want the degree outline to show what I have done and planned, so I can read off what is left.
- [x] Each requirement heading in the degree panel's outline (e.g. "Compulsory (42cp)") is green with a green tick when my completed subjects meet it, purple with a purple tick when completed plus planned subjects would meet it, yellow while started (something completed, planned or chosen), and unchanged when untouched.
- [x] Program lines (majors, sub-majors, streams) are yellow when chosen, purple with a tick when the plan completes them, green with a tick when complete.
- [x] Numbered ways in the handbook text ("1. one major (48cp); 2. two sub-majors ...") each go on their own line, coloured the same way: yellow once started, purple with a tick when the plan completes it, green with a tick when complete. The heading goes green (or purple) when any one way does. A line that cannot be interpreted is shown on its own line without colour.
- [x] The outline and the progress panel always agree (same calculation).
- [x] A chosen program counts in one place only: a second major listed under both "Major" and "Options > Majors" fills Options rather than being dropped. A subject shared by two chosen programs counts once, the outline names it under the second, and an extra subject from that program's options makes up the gap. *Added 25 Sep 2026 (bug: two completed majors showed Options 0/48).*
- [x] E2E tests cover untouched, started, planned-complete and complete, for a compulsory block and for the Options ways.

### US-028 Circle titles show progress
As a student, I want each circle's title to show how far along it is, so I can read progress straight off the map.
- [ ] Degree and program (major, sub-major, stream) titles sit a little higher above their circle than before
- [ ] Each title ends with completed / needed credit points (e.g. `Data Analytics 42/48cp`), with planned credit shown as the progress panel does (`42+6/48cp`)
- [ ] The completed number is not capped: extra subjects show above what is needed (e.g. `54/48cp`). For a degree, only completed subjects that count towards it are included
- [ ] A green tick when complete, a purple tick when the plan completes it (same status as the circle glows, US-026)
- [ ] The credit points can be turned off in view settings (US-029)

### US-029 View settings
As a student, I want to adjust how the map's text looks.
- [ ] A Settings button at the top right opens a small popup
- [ ] "Text grows with zoom" (on/off): on, circle titles and subject labels scale with zoom but stay between a minimum and maximum on-screen size; off, they stay one size on screen at every zoom
- [ ] "Text size" slider as a relative percentage (50%-200%), not pixels; it works in both modes
- [ ] "Show credit points on titles" (on/off, US-028)
- [ ] Settings are remembered in this browser and are not part of a shared plan link
- [ ] The US-004 pan/zoom performance target (median 55fps) still holds

### US-030 Light and dark mode
As a student, I want to switch between light and dark.
- [ ] A button at the top right, beside Settings, switches between light and dark
- [ ] The first visit follows the operating system's setting; after that the choice is remembered
- [ ] Light mode covers everything, the map included (background, circles, subject states, links, glows); every subject state stays distinguishable and text readable in both

### US-031 Progress on each way and heading in the outline
As a student, I want to see how far along each way of filling a requirement is.
- [ ] Each numbered way (e.g. "one major (48cp)") shows its own done / needed, with planned in purple, and a small bar
- [ ] Each requirement heading shows done / needed the same way (e.g. `Options 42/48cp`)

### US-032 See what can fill elective slots
As a student, I want to know what can go in an elective slot.
- [ ] Under a free-elective requirement ("Electives (18cp)", "Free Electives (24cp)"), the outline lists the completed and planned subjects counting there, each clickable
- [ ] It says any UTS subject not already counting elsewhere can go there, and hovering the line glows the subjects on this map that would count
- [ ] It does not list every UTS subject, only this map's, through the glow

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
- [ ] Merging to `main` builds and deploys the site through GitHub Actions. *Partial: deploys run through GitHub Actions but are started manually (by agreement: each deploy is deliberate, with its test scope chosen). First live deploy 24 Sep 2026.*
- [x] Works under the Pages sub-path (`/Degree-Skill-Tree/`), including deep links to a course and a shared plan (verified against the local production build)
- [x] `./scripts/smoke.sh --target <url>` passes against the deployed site before it is announced (run 35966554412, 24 Sep 2026)

### US-018 Usage analytics without personal data (later)
As the project owner, I want to know what people look at and do on the site, without collecting personal data.
- [x] All tracking goes through one `track(event, props)` hook, a no-op until a provider is chosen
- [ ] No cookies, no user IDs, no IP storage; provider chosen from cookieless options
- [ ] Events cover course opened, node inspected, subject marked done/planned, search used, plan shared
