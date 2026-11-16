---
name: pm-roadmap
description: Place the open work packages of a p2kit project in a Now / Next / Later roadmap — propose horizon and rank, write them in the work package frontmatter only after the user's explicit OK, and generate .pm/roadmap.md (internal) and .pm/roadmap-external.md (no ids, risks or effort). Use when the user asks for a roadmap, to order or prioritise the work packages, to say what comes now, next and later, or asks for /pm-roadmap.
---

# Now / Next / Later roadmap

The roadmap lives in the work packages: `horizon` and `rank` in their frontmatter
(docs/pm-schema.md → *Roadmap*). The two documents are generated from them and read by nothing but
the desk's Documents list. This skill writes only those two keys and the two documents, after the
user's OK; it never touches the forge and commits nothing.

1. Read `.pm/project.yaml` (`name`, `stage`, `tolerances`), the work packages of
   `.pm/work-packages/` (id, title, stage, status, due, estimate, actual, horizon, rank),
   `.pm/registers/risks.yaml` and `.pm/registers/issues.yaml` when they exist. Open work packages
   are those whose status is neither `completed`, `archived` nor `cancelled`; no open one → say so and stop.
2. Propose a horizon and a rank for every open work package:
   - one that already has a valid `horizon` keeps it, and its `rank`, as the starting point;
   - the others: `in-progress` or `authorized` of the current stage → **Now**; the other open ones
     of the current stage and those of the next stage (`stage.current + 1`) → **Next**; later
     stages or no stage → **Later**;
   - within a horizon: the existing rank first, then by `due` (none last), then by id.
3. Show the order as one table per horizon (Now, Next, Later) — rank, id, title, stage, status,
   due — and ask the user to move work packages between horizons or reorder them. Apply each
   correction and show the tables again.
4. Ask for an explicit OK. Without it, write nothing.
5. On the OK, in each open work package's frontmatter set `horizon:` and `rank:` — `rank`
   renumbered 1..n inside each horizon — adding the keys after the last frontmatter line when they
   are absent, and changing only those two lines: every other line of the file stays as it is.
   Completed, archived and cancelled work packages are not touched.
6. Generate both documents with the products frontmatter (`product: roadmap`, `version: 0.1`,
   `status: draft`, `updated: <today>`), replacing any earlier version of the same file:
   - `.pm/roadmap.md`, `title: Roadmap` — a section per horizon, a table with id, title, stage,
     status, due and, where set, estimate / actual / deviation in hours (deviation as in
     docs/pm-schema.md → *Effort*); then the stage effort line
     (`Stage <n> effort: <actual>h of <estimate>h, deviation <signed>h over <counted> work packages`)
     when the current stage has work packages carrying both figures; then the open risks with
     score ≥ 6 (probability × impact, low 1 · medium 2 · high 3) and the open issues of the
     registers, id and title;
   - `.pm/roadmap-external.md`, `title: Roadmap (external)` — a section per horizon listing each
     work package's title, status and due only: no ids, no risks, no issues, no effort.
   An empty horizon reads `Nothing planned.` in both.
7. Tell the user in one line how many work packages were placed per horizon, where the two
   documents are, and that the desk's Roadmap tab shows the order at its next refresh. Nothing is
   committed: `.pm/` is committed with the code, when the user decides.
