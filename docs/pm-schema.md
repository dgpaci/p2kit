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
