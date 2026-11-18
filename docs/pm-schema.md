# The `.pm/` folder — schema 1

Every p2kit project keeps its management data in `.pm/` at the root of its own repository,
committed with the code. The skills write it; the project desk reads it.

```
.pm/
  project.yaml              identity, stage, tolerances, roles, reporting, Board approvals
  brief.md                  Project Brief            (/pm-start-up)
  pid.md                    Project Initiation Documentation (/pm-initiate)
  roadmap.md                Now / Next / Later roadmap, internal (/pm-roadmap, generated)
  roadmap-external.md       the same roadmap for outside readers: no ids, risks or effort
  business-case.md          Business Case            (full profile, or inside pid.md in light)
  stages/<n>/plan.md        Stage Plan of stage n
  work-packages/WP-<nn>.md  one Work Package per file
  reports/<date>-<kind>.md  highlight, checkpoint, exception, end-stage, end-project reports
  presentations/WP-<nn>.md  presentation of a work package to its users and the Board (/pm-present), listed under Documents
  digests/<date>.md         weekly digests (/pm-digest), listed under Documents after the reports
  registers/risks.yaml      Risk Register
  registers/issues.yaml     Issue Register
  registers/commit-notes.yaml  internal notes on the commits of work-package branches (/pm-note)
  registers/iterations.yaml timeboxed iterations of the stage (/pm-iterate)
  registers/quality.yaml    Quality Register          (phase 2)
  registers/lessons.yaml    Lessons Log: retrospectives, lessons, actions (/pm-retro)
  registers/daily-log.yaml  Daily Log: the day's forge events, decisions, actions, problems, notes (/pm-log)
```

Stage baselines are git tags `pm/stage-<n>-approved`, set when the Board approves stage `n`'s plan.

## YAML subset

The desk is a Claude Code mod with no Node and no npm, so it parses YAML with its own small
reader (`hooks/yaml.ts`). Stay within:

- block maps (`key: value`) and block lists (`- item`, `- key: value`), indented with spaces;
- flow lists of scalars (`[a, b]`) and flow maps of scalars (`{ limit: 10, used: 2 }`);
- scalars: plain, `'single'` or `"double"` quoted; `true`/`false`, `null`/`~`, numbers; dates
  stay strings (`2026-11-03`), and so does a number that would not print back the same (`1.0`,
  `007`);
- a quote opens a quoted scalar only where the scalar starts, so a plain scalar may contain an
  apostrophe (`[Daniela D'Alessandro, Eva Neri]`); quote an item that holds a comma;
- no escapes inside quotes (`'it''s'` reads as `it''s`): a quoted value holding a `'` goes in
  double quotes (`"l'ordine, urgente"`);
- `#` comments.

No anchors, tags, multi-document streams or multi-line scalars: long text belongs in a Markdown
product, not in YAML.

## `project.yaml`

```yaml
schema: 1
name: Customer portal
code: PORTAL                    # short identifier, used in report names
profile: light                  # light | full | agile — agile: the light products plus iterations
status: delivery                # start-up | initiation | delivery | closing | closed
stage:
  current: 2                    # 0 = start-up, 1 = initiation stage, 2.. = delivery stages
  name: Build
  start: 2026-10-01
  planned_end: 2026-12-15        # empty or absent on a continuous stage
  continuous: false             # optional; true = a stage with no end (ongoing delivery)
tolerances:                     # project-level; a stage may tighten them in its plan
  time:  { limit: 10, used: 3, unit: days }     # used = current forecast deviation
  cost:  { limit: 5000, used: 4200, unit: EUR }
  scope: { limit: 0, used: 0, unit: must-have items dropped }
  effort: { limit: 16, used: 0, unit: hours }  # used computed from the work packages when they carry the figures (### Effort)
roles:
  executive: Anna Rossi
  senior_user: [Marco Bianchi]
  senior_supplier: [Davide Paci]
  project_manager: Davide Paci
  team_manager: []
  assurance: []
  support: []
team:                           # optional: forge logins and WIP limits of the people of the roles
  wip_limit: 3                  # project default; 3 when absent
  people:
    Davide Paci: { login: dgpaci, wip_limit: 4 }
    Marco Bianchi: { login: mbianchi }
readiness:                      # optional: headings an open forge issue must carry to be ready
  headings: [Why, What changes, Done when]      # the default when absent
documents:                      # optional: folders, relative to the repo, listed under Documents
  - anaci_app/report            #   .html, .md and .pdf files, subfolders up to 3 levels, titled by <title> / title / # heading
reporting:
  highlight_every_days: 14
  last_highlight: 2026-10-20    # date of the last highlight report, or null
approvals:                      # Board decisions, written only after the human states them
  - decision: authorize-initiation
    by: Anna Rossi
    date: 2026-09-15
    note: mandate accepted, brief approved
```

### Continuous stage

A project with no fixed end (ongoing delivery) runs one stage with `continuous: true` and no
`planned_end`: `stage: { current: 1, name: Delivery, start: 2026-01-10, continuous: true }`. The
desk shows it without a percentage and without an end: `since <start> · continuous` for the stage,
`<open> open · <completed> completed` for its work packages (`completed` counts the archived ones too;
cancelled ones excluded, counted over
all time) in the overview, the recap and the Work packages tab. Tolerances still show as set.
`continuous` absent is `false`; any value but `true` or `false` gives the error
`stage.continuous: expected true or false`. `/pm-start-up` and `/pm-initiate` offer it only when the
user says the project has no fixed end; they never infer it.

### Tolerances and the traffic light

Each tolerance is a flow map `{ limit, used, unit }`, both numbers in the same unit: `limit` is
the allowed deviation from plan, `used` the deviation currently forecast. The desk colours each
one and the project by its worst:

| used / limit | light |
|---|---|
| < 75 % | green |
| 75 % – < 100 % | amber — forecast close to the limit |
| ≥ 100 % | red — tolerance exceeded: an exception is due |

A tolerance with `limit: 0` is red as soon as `used > 0`. Any other tolerance area (quality,
risk, benefits) may be added the same way.

### Team and WIP

The team is the people of `roles`, once each, in role order, with the labels of every role they
hold. `team.people` maps a person, named exactly as in `roles`, to their forge `login` and an
optional `wip_limit` (else `team.wip_limit`, else 3). A `team.people` key naming nobody in the
roles is not added and gives the error `team.people: <name> is in no role`; an entry that is not a
flow map (`Davide Paci: dgpaci`) gives `team.people: <name>: expected { login, wip_limit }`.

When the origin is a forge — whether or not anyone has a login — the desk reads the repo once per
project, GET only, again after 5 minutes (at once on Refresh and `/pm-desk`): the open issues and
open pull requests, up to 5 pages each, and the open milestones, one page
(`milestones?state=open&per_page=100` on GitHub, `&limit=50` on Forgejo). An origin that is not a
forge reads nothing. Each person with a login gets the items that are theirs, with the status from
their point of view:

| status | item |
|---|---|
| `review` | open pull request authored by someone else, review requested from them |
| `inprogress` | open pull request they authored or are assigned: draft, or no review requested from others |
| `inprogress` | open issue assigned to them whose `state` (below) is `inprogress`: the work has started |
| `todo` | open issue assigned to them, not started yet |
| `waiting` | their open pull request with a review requested from someone else; their issue whose `state` is `review` |
| `stalled` | the same, untouched for more than 7 days |

Items are listed in that order, most recently updated first within one status. The WIP of a
person counts every item but `review`; over `wip_limit` the desk flags them. A forge failure is
the project error `team: <forge> issues|pulls: <reason>`; the team still shows, with no item.

### Activity

The same read fills the Activity tab — its count the open issues and pull requests — in three
blocks, open items only:

- **Milestones**: each open milestone, ordered by due day (none last), then title, with
  `closed/total` as the forge counts them (GitHub counts pull requests too, Forgejo only issues),
  its due day (`overdue` when past with open items), `stalled` — its open issues and pull requests
  untouched for more than 7 days — and `in review` — its open non-draft pull requests with a
  reviewer requested. Then its work package: the one whose frontmatter `milestone:` is the
  milestone's title, cancelled ones left out, the lowest id when several; a link to its work
  theme, or `no work package`.
- **Pull requests**: the open pull requests, most recently updated first, marked `draft` or
  `in review`.
- **Issues**: the open issues grouped by milestone — the open milestones in their order, then any
  other title (`closed`), then *No milestone*.

A failure to read the milestones is the project error `milestones: <forge> milestones: <reason>`;
the issues and pull requests still show.

From the same read, with no further request, each open pull request carries `assignees` (their
logins, `[]` when the forge sends none or `null`) and `closes`: the issue numbers its body names
after `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves` or `resolved`
followed by `#<n>`, any case, once each. Each open issue carries `assignees` and a `state`, the
first that holds:

| state | issue |
|---|---|
| `done` | closed (only when a closed issue is in the list) |
| `review` | an open non-draft pull request closes it |
| `inprogress` | a commit references it (its timeline shows one), or an open draft pull request closes it |
| `todo` | otherwise, assigned or not |

Assigning is the PM's plan, not work in progress: an issue becomes `inprogress` with its first
commit, the rule forge-desk reads too, so both desks agree on what is in progress. The desk reads
the timeline (`issues/<n>/timeline`, `per_page=100` on GitHub, `limit=100` on Forgejo) of each open
assigned issue no pull request closes, the most recently updated first, at most 50 per read of the
repo, in batches of 10; a commit is a `referenced` event with a `commit_id` on GitHub, a
`commit_ref` on Forgejo. An issue once seen started is not read again for the module's life. A
failed read is one error, `team: <forge> timeline: <message>`, and leaves the issue as it was.

A pull request closing an issue of another repo with `owner/repo#n` is not read as closing it.

The browser page can also start a package; it never writes. Checking issues and pull requests shows
a bar with **Create package**, a link that opens a new Claude Desktop session in the project's folder
asking for the pm-package skill on the picked references (`#12 #15 PR #18`); on a milestone with no
work package, **Create work package** opens one on `--milestone '<title>'`. The linked prompt is plain
text naming the skill, not `/p2kit:pm-package`: Claude Desktop turns the leading `/` of a linked
prompt into `／`, so a link never runs a command. The session needs p2kit loaded. The pane shows the
same blocks, without the selection: there `/pm-package` is typed in a session. `/pm-package` shows its plan and writes to
the forge — the milestone and the milestone of each item — and the work package file only after
the user's OK.

### Board

The Board tab (`hooks/lanes.ts`) shows, from the same read, one swimlane per work package whose
frontmatter `milestone:` names a milestone and which owns it (the rule of Activity: cancelled left
out, the lowest id when several), by id. An archived work package gets a lane only while its
milestone has open items. Each lane heads with the id, title, status and the milestone's
`closed/total` (when it is among the open milestones read), then four columns: **To do**,
**In progress**, **In review** hold the milestone's open issues by their `state` (`todo` when
missing) and its open pull requests (a draft in progress, else in review); **Done** is the
milestone's closed count, closed items are not read. Each card is `#n` (or `PR #n`), its title
linked, and the assignees' logins or a red `unassigned`. A completed or archived work package with
open items is flagged `reopened: N open`. The last lane, *Unplanned*, holds the open issues and
pull requests with no milestone or a milestone of no work package; its size is the tab count.
Lanes carry `data-wp` (`''` for Unplanned) and cards `data-number`, for drag and drop to come. The
pane shows the same lanes as text, one line per non-empty column.

### Metrics

For every registered project whose origin is a forge, the desk also reads, GET only, the closed
issues and pull requests of the last 90 days: GitHub `issues?state=closed&since=<now − 90 d>` and
`pulls?state=closed&sort=updated&direction=desc`, Forgejo `issues?state=closed&type=issues&since=…`
and `pulls?state=closed&sort=recentupdate`, up to 10 pages each, the pull pages stopping at the first
page that ends before the 90 days. For each pull request merged in the 90 days it reads
`pulls/<n>/reviews` once — at most 100 per read, 10 at a time — and keeps its first review, the
earliest submitted review that is not by the author — a pending review and a Forgejo review request
(`REQUEST_REVIEW`) do not count —, for the life of the mod. The
closed lists are read again after 60 minutes, or on `/pm-desk`. The result is the project's `flow`
(`null` when the origin is not a forge):

| Field | Meaning |
|---|---|
| `windows` | the last 30 and the last 90 days, in that order |
| `windows[].leadTime` | issues closed in the window: opened → closed |
| `windows[].firstReview` | pull requests merged in the window: opened → first review (a pull with no review is left out) |
| `windows[].merge` | pull requests merged in the window: opened → merged (closed unmerged pulls are left out) |
| `windows[].throughput` | per UTC ISO week, `week` its Monday, oldest first: `issues` closed and `pulls` merged |
| `closedIssues`, `mergedPulls` | the items of the 90 days, most recently closed first: `number`, `title`, `url`, `closedAt` (day), `milestone` |

Each figure is `{ count, median, p90 }` in days, one decimal — the median the mean of the two middle
values on an even count, p90 the nearest rank — `null` with a count of 0. Every closed issue counts:
Forgejo has no close reason to tell completed from not planned.

The Metrics tab — its count the pull requests merged in the last 30 days — shows the three figures
as `median · p90 (count)` for 30 and 90 days, `—` when nothing was counted, then the weekly
throughput of the 90 days: stacked CSS bars on the browser page, one line per week in the pane.
`No forge data.` when `flow` is null. A failed read is the project error
`flow: <forge> issues|pulls|reviews: <reason>`; the figures are built from what was read.

### Readiness

An open issue is ready when its body carries every heading of `readiness.headings` (default
`[Why, What changes, Done when]`) as a Markdown heading line — `#` to `######`, a space, the text;
level, case, a trailing `:` and closing `#`s do not matter. An issue missing one is `notready`: a
pill naming what is missing in the Activity and Team tabs, a "Not ready only" filter on the
issues of the Activity tab, `notready <N>` on the project and `<N> issues not ready` in the recap. Pull requests
are not checked, and nothing is written to the forge. A `readiness` that is not a map, or
`headings` that is not a non-empty list, is the project error
`readiness.headings: expected a list of headings` and the default applies.

### Approval decisions

`authorize-initiation`, `authorize-project`, `authorize-stage-<n>`, `exception-plan-<n>`,
`authorize-closure`, or free text. `by` must be the Executive or a Board member named in `roles`.

## Work themes

The work themes of a stage run in parallel, each one a work package linked to a forge issue, a
milestone or a branch by the link keys of its frontmatter (see *Work packages*). `/pm-link` writes
them. A work package with an `issue`, a `milestone` or a `branch` is *linked*. `project.yaml` no
longer carries `stages:`: a file that still does gets the error
`.pm/project.yaml: stages: is no longer read — link the work packages with /pm-link (docs/pm-schema.md)`.

For each linked work package with a `branch` whose status is neither `archived` nor `cancelled`,
of any stage, the desk reads that branch with local git only — never a fetch: the ref is
`branch`, else `origin/<branch>`; on it, the plan is the one `.phased/active/<slug>/plan.md`, else
`.phased/done/<issue>-*/plan.md`. Its phase lines `- [m] **Phase N**: title` give the work
package's progress: `x` done, `>` in progress, ` ` to do, `!` failed, `~` blocked. The overview
shows, per work theme of the current stage, `WP-<nn> · phases <done>/<total>` and its current
phase; a branch that resolves neither way is the error `WP-<nn>: branch <branch> not found`
(not for a `completed` work package, whose branch is often deleted after the merge).

The work theme's detail lists each phase with **what it adds**: the phase's `> Done:` summary once
the phase closed, else its `- Done:` criterion, the opening check (`… GREEN — `) and code quotes
dropped; above the phases, the plan's `## Objective` paragraph. The commits of the branch are not
listed: only the ones carrying a note (below).

With no phased plan, a work package linked to a `milestone` shows a bar of the milestone's items
closed (closed issues and merged or closed pull requests) over all of them, `<closed>/<total>
closed`, from the item list when read, else from the milestone's counts; with neither, `no plan`.

The desk also reads the branch's commits over its base — `git log <base ref>..<branch ref>`, the
base resolved like the branch (`base`, else `origin/<base>`; `''` →
`git symbolic-ref --short refs/remotes/origin/HEAD`) — each with its notes from
`registers/commit-notes.yaml`, and shows the commits that carry a note. A base that does not resolve is the error
`WP-<nn>: base <base> not found`. Notes whose `wp` is absent or names no linked work package are
listed apart, under *Notes without a work theme*, since open blockers are counted over the whole
register.

For the work themes — the linked work packages of the current stage whose status is neither
`archived` nor `cancelled` — at most every 5 minutes per work package (the Refresh button and `/pm-desk` read it
at once), the desk reads the forge of the repo's `origin` (`github.com` → GitHub through `gh api`;
any other host → Forgejo REST with the `fj` token of that host from
`~/Library/Application Support/forgejo-cli.forgejo-cli/keys.json`). GET only — reading never
writes to a forge; the one desk action that does is *Create package* (see *Desk actions*). `issue` → the issue's title and state; `milestone` → the milestone with that
title, shown `<title> <closed>/<open+closed>` with its due day — the count covers issues and pull
requests alike — and every issue and pull request in it, any state (GitHub
`issues?milestone=<number>&state=all`, Forgejo `issues?state=all&milestones=<id>`, up to 5 pages),
the open ones named first as `still open`; `branch` → the pull requests whose
head is the branch, open, merged or closed (GitHub filters by head; Forgejo has no such filter, so
the 250 most recently updated pull requests are searched). Git and forge calls give up after
30 s. A work package is `ready to close` when at least one pull request is merged and none is
open; closing the milestone stays a human act. A project with no such work package does not ask
git for its origin; no origin, or an origin that is not a repo URL, reads nothing; a forge failure
is the error `WP-<nn>: <forge> <what>: <reason>`, and the local data still shows.

## Markdown products

Every product starts with a YAML frontmatter block:

```markdown
---
title: Project Brief
product: brief            # brief | pid | business-case | stage-plan | work-package | report | digest | roadmap | presentation
version: 0.1
status: draft             # draft | submitted | approved | superseded
updated: 2026-11-03
---
```

### Brief objectives

`brief.md` carries an `## Objectives` section, a checklist that is the project's yardstick:

```markdown
- [ ] **O-2** Nothing gets lost — every open issue is on the desk. *Done when:* <check>.
- [x] **O-1** Management products prepared by skills. *Done when:* <check>. <date>, <who>.
```

Ids are never renumbered; a dropped objective is struck through (`~~…~~`). An entry is ticked only
after the user states in chat that the Board considers it met. Work packages name the objectives
they serve with `objectives:`; `/pm-digest` and `/pm-report` read both to say, per objective, which
work packages serve it, how far they are, and which objectives no work package serves.

The desk reads the checklist of `.pm/brief.md` (`hooks/objectives.ts`): an entry is
`- [ ] **O-<n>** <title> — …` or `… . *Done when:* …`, the title running up to ` — ` or
`*Done when`, `[x]` met, `~~…~~` dropped; lines of the entry after the first are not read. Per
objective it lists the work packages naming it that are not cancelled and how many of them are
`completed` or `archived`. An id a work package names that the checklist lacks is the error
`WP-<nn>: objectives: O-<n> is not in the brief`; a brief without the section shows nothing and no
error. Shown: the overview row and the pane, `objectives <bar> <met>/<total>` after the stage (the
dropped ones not counted); the recap, an *Objectives* section right after the cards, before
*Tolerances* and *Needs attention*; a work package's page, the objectives it serves above its
phases. The progress of a work package is not measured on its objectives.

### Work packages

`work-packages/WP-<nn>.md`, frontmatter:

```yaml
id: WP-03
title: Payment gateway integration
product: work-package
stage: 2
status: in-progress       # draft | authorized | in-progress | completed | archived | cancelled
team_manager: Luca Verdi
due: 2026-11-20
issue: 498                # link keys, optional (/pm-link or /pm-issue): forge issue number, or absent
milestone: ''             # forge milestone title, or absent / '' (/pm-link or /pm-package)
branch: feature/498-pay   # the branch the work package is worked on
base: develop             # '' = the repo's default branch
estimate: 24              # optional: estimated effort, hours
actual: 18                # optional: effort spent so far, hours, entered by hand
horizon: now              # optional: now | next | later (/pm-roadmap)
rank: 2                   # optional: order inside the horizon, 1 = first
objectives: [O-2, O-3]    # optional: the brief objectives this work package serves
```

Progress of a stage = WPs of that stage with status `completed` or `archived` / WPs of that stage
that are not `cancelled`.

`archived` follows `completed`: the work is delivered and the Board has seen it. A `completed`
work package stays a work theme — in the overview, the theme bar and the recap, with a `completed`
pill — until `/pm-archive` sets it `archived`, after the user's explicit OK; an archived one is
listed only in the Work packages tab. The desk never changes a status by itself.

`id` is unique in the project: two files carrying the same one are the error
`duplicate work package id <id> (<file>, <file>)`.

### Effort

`estimate` and `actual` are hours, both optional; `actual` is typed by hand — there is no time
tracker. A value that is not a number (a word, a quoted `'3'`) is the error
`WP-<nn>: estimate is not a number` (resp. `actual`) and reads as missing.

The **deviation** of a work package, in hours:

| work package | deviation |
|---|---|
| `completed`, `archived` | `actual − estimate` (negative = a saving) |
| any other open status | `max(0, actual − estimate)` — only an overrun is known before the end |
| `cancelled`, or a figure missing | none |

The **stage effort** sums estimate, actual and deviation over the work packages of the current
stage that are not cancelled and carry both figures; none counted, no stage effort.

When the stage effort exists, the `effort` tolerance of `project.yaml` (`{ limit, used, unit:
hours }`) takes `used = max(0, stage deviation)` in place of the written one, and its light is
recomputed: the desk marks it `from work packages`. Without the figures the written `used`
stands. No other tolerance area is touched.

The desk shows `effort <actual>/<estimate>h <deviation>h` in the project row (red when the
`effort` tolerance is red), the stage line `Stage <n> effort: …` and per work package its
estimate, actual and deviation in the Work packages tab. `/pm-report` reports them from the
snapshot (`effort`, each work package's `estimate` / `actual` / `deviation`).

## Roadmap

The roadmap lives in the work packages: `horizon` (`now`, `next` or `later`) and `rank` (an
integer, 1 = first), both optional, written by `/pm-roadmap` after the user's OK. Another horizon is
the error `WP-<nn>: horizon <value> is not now, next or later` and reads as none; a rank that is not
a number is `WP-<nn>: rank is not a number` and reads as none.

Only the open work packages (neither `completed`, `archived` nor `cancelled`) are on the roadmap. Within a
horizon they are ordered by rank, the ones with no rank last, then by id; the open ones with no
horizon are *not on the roadmap*, by id.

`/pm-roadmap` also generates two products from it, frontmatter `product: roadmap`:

- `roadmap.md`, title `Roadmap` — per horizon id, title, stage, status, due and the effort figures,
  the stage effort line, the open high risks and the open issues;
- `roadmap-external.md`, title `Roadmap (external)` — per horizon title, status and due only: no
  ids, no risks, no effort.

Nothing reads them back but the Documents list. The desk's Roadmap tab shows the Now, Next and
Later blocks from the work packages, and the open ones not on the roadmap; the snapshot carries
`roadmap: { now, next, later, unplaced }` (ids).

## Registers

### `registers/risks.yaml`

```yaml
risks:
  - id: R-001
    title: Payment provider changes API before go-live
    category: threat              # threat | opportunity
    probability: medium           # low | medium | high
    impact: high                  # low | medium | high
    owner: Marco Bianchi
    status: open                  # open | closed
    response: reduce              # avoid | reduce | fallback | transfer | accept | share | exploit | enhance
```

Score = probability × impact with low = 1, medium = 2, high = 3. The desk counts as **high** an
open risk scoring 6 or more (high × medium, high × high).

### `registers/issues.yaml`

```yaml
issues:
  - id: I-001
    title: Senior User asks for SSO in scope
    type: request-for-change      # request-for-change | off-specification | problem
    priority: high                # low | medium | high
    status: open                  # open | closed
    raised: 2026-10-28
```

### `registers/commit-notes.yaml`

Internal notes on the commits of a work package's branch, written by `/pm-note`; never posted to
the forge.

```yaml
notes:
  - { sha: 3f2a9c1, wp: WP-03, kind: blocker, status: open, text: 'waiting for the print template', date: 2026-11-11 }
```

- `wp`: the work package the note belongs to. Notes written before work themes carry `stage:`
  instead; the desk lists them, with any note naming no linked work package, apart.

- `sha`: 7 or more hex characters, short or full; a note belongs to a commit when one sha is a
  prefix of the other, case aside.
- `kind`: `follow-up` | `blocker` | `remark`; `status`: `open` | `closed`.
- Notes of a work package matching no commit of its branch (after a squash merge, say) are listed apart.
- The overview counts the open blockers of the whole register: `blockers N`, in red.

### `registers/iterations.yaml`

Timeboxed iterations inside a stage, opened and closed by `/pm-iterate`; never on the forge. The
`agile` profile documents the practice, but the desk reads the register whatever the profile.

```yaml
iterations:
  - number: 2
    goal: Checkout end to end
    start: 2026-11-10
    end: 2026-11-21
    stage: 2
    status: open                  # open | closed; absent = open
    work_packages: [WP-01, WP-02]
  - number: 1
    goal: Login
    start: 2026-10-27
    end: 2026-11-07
    stage: 2
    status: closed
    work_packages: [WP-04]
    delivered: [WP-04]            # written at close
    result: login shipped to staging
```

- `number` (int), `start` / `end` ISO days, `stage` the stage number; `delivered` and `result` are
  written when the iteration closes.
- The **current iteration** is the open one, the highest number when several are open. Its progress
  is `done/planned`: its work packages with status `completed` or `archived` over those that exist and are not
  `cancelled`. Past its `end` it is overdue.
- Errors: a parse failure `iterations.yaml: <reason>`; several open `iterations: more than one open
  (3, 4)`; a `work_packages` id naming no work package `iterations: <number>: unknown work package
  <id>`.
- The desk: `iteration <n> · <done>/<planned> WPs · ends <end>` in the overview row after the WPs
  fact (red and `overdue` past its end), an Iteration card in the recap, `Iteration <n> past its
  end (<end>)` in Needs attention, and an Iterations tab after Work packages, newest first.

### `registers/lessons.yaml`

The Lessons Log, written by `/pm-retro`: the retrospectives held, what they taught, and the actions
they decided. Three lists, each entry a flow map:

```yaml
retrospectives:
  - { date: 2026-11-21, iteration: 2, stage: 2 }
lessons:
  - { id: L-001, date: 2026-11-21, iteration: 2, kind: keep, text: 'short daily sync' }
  - { id: L-002, date: 2026-11-21, iteration: 2, kind: change, text: 'review pull requests within a day' }
actions:
  - { id: A-001, date: 2026-11-21, text: 'add a review reminder', issue: 512, status: open }
```

- `kind` is `keep` or `change`; `iteration` and `stage` are numbers, absent when the retrospective
  covered a stage without iterations. An action's `issue` is the forge issue `/pm-retro` opened for
  it, after the user's OK; `status` is `open` or `done`, absent = `open`.
- The **last retrospective** is the latest `retrospectives[].date`.
- Errors: the file is parsed once, a parse failure is one error `lessons.yaml: <reason>` and the
  three lists stay empty.
- The desk: `last retro <date>` (or `—`) in the overview row after the next report fact, one line
  per open action in Needs attention (`<id> <text> #<issue>`), and a Lessons tab after Iterations,
  its count the open actions: the last retrospective, the actions open first, the lessons newest
  first. On the page an action's issue links to the forge.

### `registers/daily-log.yaml`

The Daily Log, written by `/pm-log`: the project manager's diary, one entry per line in one list.

```yaml
entries:
  - { id: D-001, date: 2026-11-17, kind: event, source: forge, text: 'issue closed: Fix login', ref: '#41' }
  - { id: D-002, date: 2026-11-17, kind: decision, source: meeting, text: 'the export keeps the old layout until January' }
  - { id: D-003, date: 2026-11-17, kind: action, source: meeting, text: 'send the revised price list', owner: Marco Bianchi, due: 2026-11-21, status: open }
  - { id: D-004, date: 2026-11-17, kind: problem, source: meeting, text: 'test server down since Friday', register: I-004 }
```

- `kind` is `event`, `decision`, `action`, `problem` or `note`; `source` is `forge` (an event read
  from the desk's snapshot), `meeting` or `manual`, absent = unknown.
- An `action` has `status` `open` or `done`, absent = `open`, an optional `owner` (a person of the
  roles when it is one) and `due`; the other kinds have no status. An open action past its `due`
  is **overdue**.
- `ref` is the forge item a `forge` event is about (`'#41'`, quoted: a `#` would start a
  comment); `register` the Issue or Risk Register entry an entry was moved to, `issue` the forge
  issue opened for it — both written by `/pm-log` after the user's OK.
- The forge events of a day are the snapshot's `forgeIssues` / `forgePulls` with that `createdAt`
  and `flow.closedIssues` / `flow.mergedPulls` with that `closedAt`, UTC days; an item opened and
  closed on the same day shows only as closed. The **last log** is the latest `date`.
- Errors: a parse failure is one error `daily-log.yaml: <reason>` and the list stays empty.
- The desk: one red line per overdue action in Needs attention (`<id> <text> · <owner> · due
  <due>`), and a Daily log tab after Roadmap, its count the open actions: a block per day, newest
  first, the entries in file order with kind and source, text and ref, issue, owner, due and
  status; an overdue due is red, a done action dimmed.

## Next report due

`reporting.last_highlight + reporting.highlight_every_days`; with no highlight yet,
`stage.start + highlight_every_days`. Past today, the desk marks it overdue.

`/pm-report` drafts the Highlight Report for the period `last_highlight` (or `stage.start`) →
today and, after the user's OK, saves it as `reports/<date>-highlight.md` and sets
`reporting.last_highlight` to today, which moves the next report date.

## Desk actions

What acts directly and what opens a session is set in [scope.md](scope.md). An action changes one
line of one `.pm/` file — or, for a package, the forge and one new work package file — only after a
preview the PM confirms; nothing is committed.

| Action | Change | Allowed |
|---|---|---|
| Archive | `status: completed` → `archived` | a `completed` work package |
| Mark completed | `status:` → `completed`, the Board's decision stated by the PM | `authorized` or `in-progress` |
| Horizon, rank | `horizon:` (`now` / `next` / `later`, or removed), `rank:` (1–999, or removed) | any work package |
| Link | `issue:` (a number), `milestone:` (a title, quoted within the YAML subset), `branch:` | any work package |
| Close / reopen a note | `status:` of the note of `commit-notes.yaml` with that `sha` and that exact `text` | a flow-map note line |
| Create package | the milestone (created or reused), its items, a new `WP-<nn>.md` (`status: draft`) | open issues and pull requests |
| Create work package | a new `WP-<nn>.md` for an existing milestone, listing its open items | a milestone no work package carries |
| Assign / unassign | `PATCH issues/<n>` with the full `assignees` list, the login added or removed (pull requests too, both forges) | an open item; a login of `team.people` |
| Assign to many | one `PATCH issues/<n>` per picked item, the login added to its `assignees` | open items not already held by that login (1–50); a login of `team.people` |
| New issue | `POST issues` with `title`, `body`, and optionally `milestone` (the work package's, `number` on GitHub, `id` on Forgejo) and `assignees` (one login) | a title; a work package whose `milestone:` exists on the forge; a login of `team.people` |
| Attach to a work package | `PATCH issues/<n>` with `milestone:` the key of the work package's milestone (`number` on GitHub, `id` on Forgejo) | an open item; a work package whose `milestone:` exists on the forge |

A missing key is added before the closing `---`; a key written twice, a value already set, or a note
matching no line or more than one is refused, and so is a change to a file that changed since its
preview. Items already in another milestone move only when ticked in the preview.

**Assign.** `{ kind: 'assign', number, login, op: 'add' | 'remove' }`. The preview reads the item
(`GET issues/<n>`) and shows its reference, title and kind with the assignees before and after; the
hash covers them, so a change of the assignees on the forge between preview and confirm is refused.
A login outside `team.people`, a closed item, adding someone already assigned or removing someone
who is not are refused. The browser page offers it as an *Assign…* select on the open issues and
pull requests of the Activity and Team tabs: each team member with a login, `+` to add or `−` to
remove by the item's assignees (both when they are not known). No action is accepted — and no
select is shown — when the checkout has no `.pm/` (`.pm/` read from git: the desk is read-only).

**Assign to many.** `{ kind: 'assign-many', numbers: [<n>, …], login }`, from the *Assign to…*
select of the Activity tab's selection bar (the checked issues and pull requests). The preview reads
every item and lists each with its assignees before and after; closed items and those the login
already holds are listed as *Left out* instead of refusing the whole action, which is refused only
when nothing is left. Confirm patches the items in order and stops at the first failure, saying
which were done. Only `add`: unassigning stays per item.

**Attach to a work package.** `{ kind: 'issue-milestone', number, wp: 'WP-<nn>' }`. The preview
reads the work package's `milestone:`, finds that milestone on the forge and reads the item; it
shows the item's reference, title and kind, its milestone now and the new one, and the forge. An
item in another milestone is shown as a move; a closed milestone is allowed and flagged. The hash
covers the item's current milestone, so a change on the forge between preview and confirm is
refused. Refused: a closed item, an item already in that milestone, a work package without
`milestone:` (link one with `/pm-link`, or group the items with *Create package*), a milestone
missing on the forge. The browser page offers it as an *Attach to…* select on the open issues and
pull requests of the Activity tab, listing the work packages with a milestone that are not
archived or cancelled, less the one the item is already in; hidden on a read-only project.

**New issue.** `{ kind: 'issue-create', title, body?, wp?, login? }`, from the *New issue* button of
the Board tab or a lane's *+ issue* (its work package picked). The preview shows the forge, the
title and body, the milestone and the assignee, and says that an issue cannot be deleted once
created. Refused: a title empty, longer than 200 characters or of more than one line, a body over
20000 characters, a login outside `team.people`, a work package without `milestone:` or whose
milestone is missing on the forge; a closed milestone is allowed and flagged. The dialog links the
`pm-issue` skill for an issue drafted with the readiness headings. Starting the work is not a desk
action: the developer does it from their forge desk's Solve. Hidden on a read-only project.

**Browser page.** `server/desk_server.py`, standard-library Python 3, serves the page on
`127.0.0.1` at a random port. The mod starts it on *Open in browser* (or reuses one another session
started) and writes nothing else; the helper writes `~/.claude/p2kit/desk-server.json`
(`{ port, pid }`). `GET /` is the page with a per-session token, `GET /desk.json` the snapshot;
`POST /action` returns `{ preview, hash }`, and the same request with `confirm: <hash>` applies it
only if the preview, computed again, has the same hash. A request is refused (403) unless its
`Host` is `127.0.0.1:<port>` or `localhost:<port>`, its `Origin` the same, and its `X-P2kit-Token`
the page's token; only projects of the registry are touched. After a write the helper prints
`changed <path>` and stamps `~/.claude/p2kit/desk-changed.json` (`{ at, project }`, `at` in epoch ms);
the mod reads the projects again, and the page reloads once the snapshot's `refreshedAt` moves.
Every other session reads the forge again, past its cache, when the stamp is newer than its last
read, so none writes the desk back with the state before the change. Forge writes use `gh api` on GitHub and the `fj` token on Forgejo. With no
`python3`, *Open in browser* opens the file: Archive, Link, Create package and note buttons become
links to a session with their skill, and the others are not offered.

**Pane.** The Desktop pane writes the file itself (`hooks/edits.ts`, the helper's rules, checked
by both suites on `server/edit-cases.mjs`): Archive and Mark completed in a work theme, close /
reopen on a note, move / place in the Roadmap tab, each confirmed in a dialog showing the line.

## The desk snapshot

Every time the mod writes the browser board, it also writes `~/.claude/p2kit/desk.json`, the data
`/pm-digest` and `/pm-report` read, so they count stalled, waiting, in review and blockers as the
desk does:

```json
{
  "version": 1,
  "refreshedAt": "2026-11-13T12:00:00.000Z",
  "errors": [],
  "projects": [ { "path": "/Users/me/src/customer-portal", "name": "Customer portal", "...": "..." } ]
}
```

`projects` holds each project as the desk does (the `Project` type of `types/index.d.ts`: team,
milestones, forge issues and pulls, flow, registers, next report, …). The desk refreshes it every
minute while a session has p2kit loaded; the skills look a project up by `path`, the repo's
top level, and flag a snapshot older than 10 minutes. A failed write is logged and never stops the
board.

## The project registry

The desk lists the projects named in `~/.config/p2kit/projects.yaml` (written by `/pm-register`):

```yaml
projects:
  - path: /Users/me/src/customer-portal
    added: 2026-11-03
```

`.pm/` is read from the working tree of `path`. When the checkout has no `.pm/` — a branch cut
before `.pm/` was committed, a hotfix branch — the desk reads it from git instead: from
`pm_branch` when the entry sets it (`pm_branch: develop`; the local branch, else `origin/<name>`),
otherwise from the branch `origin/HEAD` points to. Read from a ref, the project is **read-only**:
the form says so and the actions that write `.pm/` fail, since they write the working tree. Commit
`.pm/` to the default branch so every checkout carries it.
