# The `.pm/` folder — schema 1

Every p2kit project keeps its management data in `.pm/` at the root of its own repository,
committed with the code. The skills write it; the project desk reads it.

```
.pm/
  project.yaml              identity, stage, tolerances, roles, reporting, Board approvals
  brief.md                  Project Brief            (/pm-start-up)
  pid.md                    Project Initiation Documentation (/pm-initiate)
  business-case.md          Business Case            (full profile, or inside pid.md in light)
  stages/<n>/plan.md        Stage Plan of stage n
  work-packages/WP-<nn>.md  one Work Package per file
  reports/<date>-<kind>.md  highlight, checkpoint, exception, end-stage, end-project reports
  registers/risks.yaml      Risk Register
  registers/issues.yaml     Issue Register
  registers/commit-notes.yaml  internal notes on the commits of stage branches (/pm-note)
  registers/quality.yaml    Quality Register          (phase 2)
  registers/lessons.yaml    Lessons Log               (phase 2)
  registers/daily-log.yaml  Daily Log                 (phase 2)
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
- `#` comments.

No anchors, tags, multi-document streams or multi-line scalars: long text belongs in a Markdown
product, not in YAML.

## `project.yaml`

```yaml
schema: 1
name: Customer portal
code: PORTAL                    # short identifier, used in report names
profile: light                  # light | full
status: delivery                # start-up | initiation | delivery | closing | closed
stage:
  current: 2                    # 0 = start-up, 1 = initiation stage, 2.. = delivery stages
  name: Build
  start: 2026-10-01
  planned_end: 2026-12-15
stages:                         # optional: stages worked as an issue or a milestone on a branch
  - number: 2
    name: Build
    issue: 498                  # forge issue number, or absent
    milestone: ''               # forge milestone title, or ''
    branch: feature/498-build   # the branch the stage is worked on
    base: develop               # '' = the repo's default branch
tolerances:                     # project-level; a stage may tighten them in its plan
  time:  { limit: 10, used: 3, unit: days }     # used = current forecast deviation
  cost:  { limit: 5000, used: 4200, unit: EUR }
  scope: { limit: 0, used: 0, unit: must-have items dropped }
roles:
  executive: Anna Rossi
  senior_user: [Marco Bianchi]
  senior_supplier: [Davide Paci]
  project_manager: Davide Paci
  team_manager: []
  assurance: []
  support: []
reporting:
  highlight_every_days: 14
  last_highlight: 2026-10-20    # date of the last highlight report, or null
approvals:                      # Board decisions, written only after the human states them
  - decision: authorize-initiation
    by: Anna Rossi
    date: 2026-09-15
    note: mandate accepted, brief approved
```

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

### Approval decisions

`authorize-initiation`, `authorize-project`, `authorize-stage-<n>`, `exception-plan-<n>`,
`authorize-closure`, or free text. `by` must be the Executive or a Board member named in `roles`.

## Stage delivery

A stage listed under `stages:` is linked to a forge issue or milestone and worked on `branch`.
The desk reads that branch with local git only — never a fetch: the ref is `branch`, else
`origin/<branch>`; on it, the plan is the one `.phased/active/<slug>/plan.md`, else
`.phased/done/<issue>-*/plan.md`. Its phase lines `- [m] **Phase N**: title` give the stage's
progress: `x` done, `>` in progress, ` ` to do, `!` failed, `~` blocked. The overview shows
`phases <done>/<total>` and the current phase of the current stage; a branch that resolves
neither way is the error `stage <n>: branch <branch> not found`.

The desk also lists the branch's commits over its base — `git log <base ref>..<stage ref>`, the
base resolved like the branch (`base`, else `origin/<base>`; `''` →
`git symbolic-ref --short refs/remotes/origin/HEAD`) — each with its notes from
`registers/commit-notes.yaml`. A base that does not resolve is the error
`stage <n>: base <base> not found`. Notes whose `stage` is not linked under `stages:`, or that
name none, are listed apart, since open blockers are counted over the whole register.

For the current stage only, at most every 5 minutes (the Refresh button reads it at once), the desk reads the forge of the repo's `origin`
(`github.com` → GitHub through `gh api`; any other host → Forgejo REST with the `fj` token of that
host from `~/Library/Application Support/forgejo-cli.forgejo-cli/keys.json`). GET only — the desk
never writes to a forge. `issue` → the issue's title and state; `milestone` → the milestone with that
title, shown `<title> <closed>/<open+closed>` with its due day; `branch` → the pull requests whose
head is the branch, open, merged or closed (GitHub filters by head; Forgejo has no such filter, so
the 250 most recently updated pull requests are searched). Git and forge calls give up after 30 s. The stage is `ready to close` when at least one is
merged and none is open; closing the milestone stays a human act. No origin, or an origin that is
not a repo URL, reads nothing; a forge failure is the error `stage <n>: <forge> <what>: <reason>`,
and the local data still shows.

## Markdown products

Every product starts with a YAML frontmatter block:

```markdown
---
title: Project Brief
product: brief            # brief | pid | business-case | stage-plan | work-package | report
version: 0.1
status: draft             # draft | submitted | approved | superseded
updated: 2026-11-03
---
```

### Work packages

`work-packages/WP-<nn>.md`, frontmatter:

```yaml
id: WP-03
title: Payment gateway integration
product: work-package
stage: 2
status: in-progress       # draft | authorized | in-progress | completed | cancelled
team_manager: Luca Verdi
due: 2026-11-20
```

Progress of a stage = WPs of that stage with status `completed` / WPs of that stage that are not
`cancelled`.

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

Internal notes on the commits of a stage branch, written by `/pm-note`; never posted to the forge.

```yaml
notes:
  - { sha: 3f2a9c1, stage: 2, kind: blocker, status: open, text: 'waiting for the print template', date: 2026-11-11 }
```

- `sha`: 7 or more hex characters, short or full; a note belongs to a commit when one sha is a
  prefix of the other, case aside.
- `kind`: `follow-up` | `blocker` | `remark`; `status`: `open` | `closed`.
- Notes of a stage matching no commit of its branch (after a squash merge, say) are listed apart.
- The overview counts the open blockers of the whole register: `blockers N`, in red.

## Next report due

`reporting.last_highlight + reporting.highlight_every_days`; with no highlight yet,
`stage.start + highlight_every_days`. Past today, the desk marks it overdue.

## The project registry

The desk lists the projects named in `~/.config/p2kit/projects.yaml` (written by `/pm-register`):

```yaml
projects:
  - path: /Users/me/src/customer-portal
    added: 2026-11-03
```
