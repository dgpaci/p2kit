---
name: pm-initiate
description: Initiate a p2kit project — draft the Project Initiation Documentation (.pm/pid.md, light profile) and the first delivery stage plan from the approved Project Brief. Use when initiation has been authorized, when the user asks for a PID, a project plan or the initiation stage, or asks for /pm-initiate.
---

# Initiating a project

Build on the approved brief and prepare what the Board needs to *authorize the project*: the
Project Initiation Documentation (`.pm/pid.md`) and the plan of the first delivery stage
(`.pm/stages/2/plan.md`). You prepare; the Board decides. Schema: `docs/pm-schema.md` at the
plugin root (two levels up from this skill's folder); keep the YAML inside its subset.

## Steps

1. **Check the gate.** Read `.pm/project.yaml`. Initiation needs an `authorize-initiation` entry in
   `approvals`. If it is missing, stop: say the Executive has not authorized initiation yet, and
   offer to record the decision if the user states it now (see `/pm-start-up`, "The Board decides").
   If `pid.md` exists already, update it instead of starting over.
2. **Read** `.pm/brief.md` and the registers. Anything the brief left open is a question for the
   user now — one round, only what the PID cannot do without.
3. **Write `.pm/pid.md`** from `templates/pid.md` in this skill's folder. In the `light` profile the
   strategies are a few lines each inside the PID, the business case is the brief's outline made
   firmer, and the project plan is a stage list with dates. In the `full` profile also write
   `business-case.md` and say which strategies deserve their own file. `status: draft`.
4. **Write `.pm/stages/2/plan.md`** from `templates/stage-plan.md`: the first delivery stage, its
   products, its tolerances (within the project's), and the work packages it will authorize.
5. **Create the work packages** of that stage, one file each, `.pm/work-packages/WP-<nn>.md`, with
   the frontmatter of the schema, `stage: 2`, `status: draft`. Keep them few and deliverable-sized.
6. **Update `.pm/project.yaml`**: firm tolerances, roles, `reporting.highlight_every_days`;
   `stage.planned_end` of the initiation stage. Add the new risks and issues to the registers.
7. **Show the user a summary** — plan at a glance, tolerances, top risks — and the decision now due:
   *authorize the project* and *authorize stage 2*.

## The Board decides

Only when the user states the Board's decision in chat, append `authorize-project` and
`authorize-stage-2` to `approvals` (by, date, note), set `status: delivery`, `stage.current: 2`,
`stage.name`, `stage.start`, `stage.planned_end` from the stage plan, the PID and stage plan
`status: approved`, and the stage's work packages `status: authorized`. Then propose the stage
baseline tag — `git tag pm/stage-2-approved` — and create it only on the user's yes, after the
`.pm/` changes are committed.

Do not commit unless the user asks; when they do, one commit `docs(pm): initiation documentation`.
