# p2kit

Project management for Claude Code, **aligned with PRINCE2®** — not affiliated with or endorsed
by PeopleCert or AXELOS. PRINCE2® is a registered trademark of PeopleCert. All templates here are
written from scratch.

**New here? Read the [guide](docs/index.md)** — what p2kit is for, the desk with screenshots, and a
task's journey from assignment to merge.

- **Skills, one per process.** Claude drafts the management products (Project Brief, PID, plans,
  reports) from what you tell it; the Project Board — you — decides.
- **Data in your repo.** Everything lives in `.pm/` in the project's own repository, versioned with
  git: `project.yaml`, Markdown products with frontmatter, YAML registers. Stage baselines are git
  tags `pm/stage-<n>-approved`. Schema: [docs/pm-schema.md](docs/pm-schema.md).
- **Project desk.** A side pane in the Claude Desktop Code tab with every registered project as a
  card — stage, objectives, progress, open high risks, blockers — with its work themes beneath. A
  project with no fixed end runs a continuous stage (`stage.continuous: true`), shown as open and
  completed work packages, with no percentage and no end date. A
  project opens on a form: a header, a bar of its work themes and the tabs Recap, Board,
  Activity, Team, Work packages, Documents, Registers and Metrics; picking a theme shows its phases, issue
  and pull requests, commits with notes. The Team tab shows the roles on top, then each person with the
  open issues and pull requests that are theirs — to do, in progress, review asked, waiting for
  review, stalled — filterable by member; a red `WIP <person> n/limit` badge on the card and in
  the recap flags anyone over their work-in-progress limit. Logins and limits come from the
  `team:` section of `project.yaml`. The Activity tab shows the repo's open milestones — progress,
  due day, stalled items, pulls in review, and the work package carrying each — its open pull
  requests, and its open issues grouped by milestone; an open issue missing a readiness heading
  (default Why / What changes / Done when, set in `readiness:` of `project.yaml`) is marked
  `notready`, counted on the card and filterable. The Metrics tab gives the flow of the last 30 and
  90 days from the repo's closed issues and merged pull requests — lead time, time to first review
  and to merge as median and p90 — and the weekly throughput. Work packages may carry estimated
  and actual effort in hours: the desk shows each one's deviation and the current stage's, which
  feeds an `effort` tolerance. The Work packages tab groups them in Now, Next, Later and Not placed
  (`/pm-roadmap`); Documents ends with the Daily log, and Registers holds risks, approvals,
  problems (the PRINCE2 issue register), lessons and iterations. The same desk is a local browser page, where
  checked issues and pull requests are grouped into a work package.
- **Actions on the desk.** Archive or complete a work package, place it on the roadmap, link it,
  close a note, package issues: each shows the change and writes it on Confirm, without opening a
  session; text — reports, digests, presentations — is still drafted in a session with its skill.
  In the browser the actions need **Python 3** (a standard-library helper the mod starts); without
  it the page stays read-only. What acts directly and why: [docs/scope.md](docs/scope.md).
- **Work themes.** The work packages of a stage run in parallel; one linked with `/pm-link` to an
  issue, a milestone or a branch shows the phases of the phased-workflow plan found on its branch,
  each with what it adds, read with local git — or, with no plan, a bar of its milestone's closed
  items — with internal notes on its commits kept in `.pm/registers/commit-notes.yaml`, and the
  forge state of its issue or milestone and pull requests (GitHub or Forgejo, read-only), flagged
  `ready to close` when they are all merged. A completed work package stays a theme until
  `/pm-archive` sets it `archived`.
- **Light by default.** The `light` tailoring profile keeps only what a small project needs;
  `full` adds the rest.

Status: phase 1 skeleton, under development.

## Skills

| Skill | Does |
|---|---|
| `/pm-start-up` | turns a project mandate into a Project Brief and creates `.pm/project.yaml` |
| `/pm-initiate` | drafts the Project Initiation Documentation (light profile) and the first stage |
| `/pm-link` | links a work package to a forge issue, a milestone or a branch (`.pm/work-packages/`) |
| `/pm-issue` | drafts a work package's forge issue with the readiness headings, creates it after your OK and records `issue:` |
| `/pm-package` | groups issues and pull requests into a work package: a forge milestone they join, after your OK, and `WP-<nn>.md` linked to it |
| `/pm-iterate` | opens or closes a timeboxed iteration of the stage — goal, dates, work packages, result — after your OK (`.pm/registers/iterations.yaml`) |
| `/pm-retro` | runs a retrospective: lessons and actions in the Lessons Log after your OK, each action opened as a forge issue after its own OK (`.pm/registers/lessons.yaml`) |
| `/pm-risk` | keeps the Risk Register: how each risk is handled, Claude's verdict on that response (adequate or not), closure only on your confirmation; each change after your OK (`.pm/registers/risks.yaml`) |
| `/pm-log` | updates the Daily Log: the day's forge events from the desk's data, plus decisions, actions and problems from a meeting transcript or your notes, after your OK; a problem goes to a register or a forge issue after its own OK (`.pm/registers/daily-log.yaml`) |
| `/pm-roadmap` | proposes the Now / Next / Later order of the open work packages, writes `horizon` and `rank` after your OK and generates `.pm/roadmap.md` and `.pm/roadmap-external.md` |
| `/pm-present` | writes the presentation of a work package for its users and the Board — what is new, what improves, how it works — and saves it after your OK (`.pm/presentations/`) |
| `/pm-archive` | sets a completed work package `archived` after your OK, so it leaves the desk's work themes |
| `/pm-note` | adds or closes an internal note on a commit of a work package's branch (`.pm/registers/commit-notes.yaml`) |
| `/pm-digest` | writes the weekly digest for the alignment meeting from the desk's data (`.pm/digests/`, clipboard on request) |
| `/pm-report` | drafts the Highlight Report for the Board and, after your OK, saves it and moves the next report date |
| `/pm-register` | adds the current repo to the project desk (`~/.config/p2kit/projects.yaml`) |

`/pm-desk` opens the pane.

## Install (development)

The repository root is the plugin. Load it in every session by naming it in the `env` block of
`~/.claude/settings.json`: `"CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>"` (several paths are
separated by `:`), or for one session `claude --plugin-dir <path>`.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
python3 -m unittest discover -s server
```

## License

MIT
