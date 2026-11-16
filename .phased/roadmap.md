# Roadmap

p2kit extends forge-desk with project management. One roadmap for issues #1–#16 of dgpaci/p2kit; each macro gets its own
`wf/` branch and PR on main, and is detailed by `/write-workflow` after the previous one has landed.

## Macro 1 (done, #17): Stage delivery — archived in done/stage-delivery/ on wf/stage-delivery
- Issues: #1, #2, #16
- Delivers: `stages:` link in project.yaml; `hooks/stage.ts` (phases of a branch's plan); `.pm/registers/commit-notes.yaml` + `/pm-note`; `hooks/forge.ts` (read-only GitHub/Forgejo GETs); drill-in Delivery section.

## Macro 2: Desk redesign and work themes — split in two
- 2a (done, #18 → #19): work themes as linked work packages, `/pm-link`, `wp:` on commit notes; `stages:` links removed.
- 2b (done, #20 → #21): desk redesign to the mockup approved in planning.

Original scope, kept for the contracts:
- Issues: follow-up of #1, #2, #16 from the Macro 1 QA (2026-11-12); a new issue to open when this macro is planned
- Objective: the desk shows each project as a parent with its work themes beneath (each with its phases bar, issue and PRs); clicking a project opens a form with a recap page first, a bar of work themes, and tabs for roles, documents, work packages, risks, issues, approvals.
- Decided: work themes run in parallel, so they are **work packages**, not stages — the issue/branch/base/phases link moves from `stages:` to work-package frontmatter; the stage stays the PRINCE2 time box above them.
- Starts from: Macro 1 landed — stage links, phases, commit notes and forge state per stage.
- Ends at: WP frontmatter carries `issue`, `branch`, `base` (and `milestone` where used); phases, commits, notes and forge state are read per linked WP; `stages:` link superseded or kept only as a fallback; a skill writes the link (e.g. `/pm-link` or inside `/pm-issue`); pane and browser page redesigned to an approved mockup.
- Delivers: the WP link (consumed by Macros 4 #11, 5, 7) and the desk layout every later macro adds to.
- Consumes: hooks/stage.ts, hooks/notes.ts, hooks/forge.ts, the loader and its 5-minute forge cache from Macro 1.
- Requires of earlier work: parsePhases/getPhaseSummary pure; getForgeJson/detectForge reusable; commit-notes schema unchanged except `stage` gaining a WP id alternative.
- Open decisions: whether `stages:` links survive or migrate; a note's `stage` vs `wp` key; how forge reads scale with several linked WPs per project (cache per WP); the tab set and recap content (mockup).

## Macro 3 (done, #22): Team
- Issues: #3 team view, #4 WIP limit
- Objective: show the project's issues and PRs per team member (roles in project.yaml) and flag members over a WIP limit.
- Starts from: Macro 1 landed — `hooks/forge.ts` reads both forges.
- Ends at: a team view in pane and browser page; `wip_limit` in project.yaml with per-person override; badge in the row.
- Delivers: per-person forge queries and status; consumed by Macro 5 (digest "waiting" sections).
- Consumes: `detectForge`, `getForgeJson` from Macro 1.
- Requires of earlier work: `getForgeJson` callable with an arbitrary path, not only the stage reads; GET only.
- Contracts it owns for later macros: per-person status `{ person, items: { number, title, status }[], wip }` (Macro 5).
- Open decisions: mapping role names to forge logins (a `logins:` map in project.yaml?); which items count as "in progress".

## Macro 4 (done, #27): Planning signals on the forge
- Issues: #11 issue template skill, #6 definition of ready, #5 milestone progress
- Objective: well-formed issues (Why / What changes / Done when) created from work packages, flagged when not ready, and milestone progress for the repo.
- Starts from: Macro 1 landed (milestone reading for one stage); Macro 3 not required.
- Ends at: `/pm-issue` creates issues after the user's OK and records the number in the WP; `notready` badge; milestone list with progress.
- Delivers: WP frontmatter `issue:` (Macro 7); milestone progress (Macro 5 #14, Macro 7 #12); readiness check — a final result, shown in the desk.
- Consumes: the WP link of Macro 2 (`issue` already in WP frontmatter — #11 records it, does not invent it), `toMilestone`, `detectForge` and `getForgeJson` from Macro 1.
- Requires of earlier work: `toMilestone` shape `{ title, open, closed, due }` unchanged; `issue` key meaning unchanged; `getForgeJson` takes any repo path.
- Contracts it owns for later macros: WP frontmatter `issue:` (Macro 7); milestone progress list `{ title, open, closed, due, stalled, inReview }[]` (Macros 5, 7). `/pm-issue` writes to the forge only after the user's OK, outside `hooks/forge.ts`.
- Open decisions: the readiness headings default and how `/pm-register` installs templates on Forgejo.

## Macro 5 (done, #28): Flow and reporting — archived in done/flow-reporting/ on wf/flow-reporting
- Issues: #7 flow metrics, #8 weekly digest, #14 Highlight Report
- Objective: lead/review time and throughput from forge data; a weekly digest; the Highlight Report drafted from repo data.
- Starts from: Macros 1–4 landed.
- Ends at: metrics page (30/90 days, cached closed items); `/pm-digest`; `/pm-report` saving a draft under `.pm/reports/` and moving the next report date.
- Delivers: the reporting products of a stage.
- Consumes: commit-notes open blockers (Macro 1), stage phases and forge state (Macro 1), team status (Macro 3), milestones (Macro 4).
- Requires of earlier work: commit-notes schema stable; `Project.delivery` and `StageDelivery.forge` filled by `loadProjects` (Macro 1); per-person status shape (Macro 3); milestone progress list (Macro 4) — each kept by the macros in between.
- Open decisions: where closed-item caches live; digest output (file under `.pm/` vs clipboard) default.

## Macro 6 (done): Agile cadence — archived in done/agile-cadence/ on wf/agile-cadence
- Issues: #9 agile profile, #10 current iteration, #13 retrospective
- Objective: timeboxed iterations inside a stage, shown in the desk, closed by a retrospective that feeds the Lessons Log.
- Starts from: Macro 1 landed (phases of a stage branch); Macro 5 useful but not required.
- Ends at: `agile` profile documented; `/pm-iterate`; current iteration in row and drill-in; `/pm-retro` writing `registers/lessons.yaml`.
- Delivers: iterations and lessons registers.
- Consumes: `parsePhases` / `getPhaseSummary` (Macro 1) — #9 first checks whether workflow phases already cover iterations.
- Requires of earlier work: `parsePhases` pure and exported.
- Open decisions: whether iterations are needed at all once phases are visible (#9's own check).

## Macro 7 (done): Planning products — closed by wf/planning-products
- Issues: #12 roadmap in three horizons, #15 estimated vs actual effort
- Objective: a Now/Next/Later roadmap built from `.pm/` data; effort fields on work packages with deviation against stage tolerance.
- Starts from: Macros 1–4 landed.
- Ends at: `/pm-roadmap` writing `.pm/roadmap.md` (internal and external output); effort fields and deviation in drill-in and tolerance status.
- Delivers: the last two management products of the set.
- Consumes: WP `issue:` (Macro 4), stage links (Macro 1), tolerances (existing).
- Requires of earlier work: WP frontmatter `issue:` key (Macros 2 and 4) and the milestone progress list (Macro 4) survive Macros 5–6; WP frontmatter stays backward compatible.
- Open decisions: effort unit (hours) and whether actuals ever come from a time tracker.
