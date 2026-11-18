---
title: Project Brief
product: brief
version: 0.2
status: approved
updated: 2026-11-18
---

# Project Brief — p2kit

> The brief is the project's yardstick. Its **Objectives** checklist is what the weekly digest
> and the Highlight Report measure progress against: every work package names the objectives it
> serves, and an objective is ticked only when the Board says it is met.

## Background
p2kit is a Claude Code plugin that prepares the management products of a PRINCE2-aligned project
and shows them on a project desk. It is in real use on anaci, and that use shows the desk is good
at *showing* and weak at *acting*: the team view lists people's work but nothing can be done from
it; on anaci the change requests opened for the delivered certifications package are lost on the
desk, cannot be taken in charge from it, and the progress of that block is unclear.

## Objective
Turn p2kit from a reporting tool into the board a project manager runs the project from: see what
is needed, create the issues, assign them, attach them to work packages and start the work, which
is then carried out in Claude sessions. A Jira-like day-to-day tool on top of the PRINCE2-aligned
management products, not instead of them. No end date: continuous delivery, paced by iterations.

## Objectives
Ticked only after the Board states in chat that the objective is met.

- [x] **O-1** Management products prepared by skills — brief, PID, stage plan, work packages,
  Highlight Report, weekly digest, Daily Log, Lessons Log, roadmap. *Done when:* each has its
  skill and appears on the desk. Delivered by WP-04, concluded 2026-11-18.
- [ ] **O-2** Nothing gets lost — every open issue and pull request of the project is visible on
  the desk, either inside a work package or in an "unpackaged" lane. *Done when:* on anaci the
  certifications change requests show under the certifications block.
- [ ] **O-3** Assign from the desk — issues and pull requests are assigned to a team member from
  the board, also by dragging them onto the person. *Done when:* a change request is taken in
  charge from the desk without opening the forge.
- [ ] **O-4** Package from the desk — issues and milestones are attached to a work package by
  dragging them onto it. *Done when:* the forge milestone and the WP file agree after the drag.
- [ ] **O-5** Graphical progress — each work package shows as a flow (to do → in progress → in
  review → done) with its issues, and what is missing is evident. *Done when:* the state of a
  block like anaci's certifications is readable at a glance, without reading tables.
- [ ] **O-6** Create and start from the desk — a new issue is drafted from the desk and the work on
  it starts in a Claude session with one action. *Done when:* from need to running session
  without leaving the desk except to confirm.
- [ ] **O-7** Measured against the brief — the weekly digest reports, per objective, the work
  packages serving it, their progress and what is missing. *Done when:* the digest has the
  section and flags objectives no work package serves.

## Desired outcome
A project manager runs a project from the desk without falling back to the forge's web UI or to
notes kept elsewhere: the board shows where things stand and what is missing, and every action
— create, assign, package, start — is one gesture away.

## Scope
- **In:** the skills, the project desk (pane and browser page) with its actions and drag & drop,
  the `.pm/` schema and its documentation, the forge integration (GitHub and Forgejo).
- **Out:** an issue tracker of p2kit's own — issues, assignees and milestones live on the forge,
  and the desk acts on them there; text copied from the official PRINCE2 manual.

## Constraints and assumptions
- The core (management products, `.pm/`) works standalone; issue management needs a forge and
  stays an optional extension of it.
- Every write to the forge starts from a gesture of the user on the desk or an explicit OK in
  chat; Claude never records a Board decision on its own.
- The `.pm/` YAML stays within the subset the desk parses (no Node, no npm in the mod).
- PRINCE2® is a registered trademark of PeopleCert: it never appears in the plugin name, a skill
  name or a command. The plugin is aligned with, not affiliated.
- Assumption: real use on anaci is the main source of requirements until a second project adopts
  p2kit.

## Outline business case
p2kit replaces management products written by hand, status gathered by reading the forge one item
at a time, and the round trips between the forge's UI and the Claude session where the work
happens. Cost is the maintainer's time; no budget is set. Discarded option: an off-the-shelf tool
(Jira and similar) — it lives outside the repo and the Claude session, and duplicates the forge.

## Project product and acceptance
The p2kit plugin, released from `main`. A change is accepted when it is used on a real project
(anaci, or p2kit itself) and the Senior User finds it removes a step from the daily routine; an
objective is accepted when its *done when* holds on a real project.

## Tolerances
| Area | Tolerance |
|---|---|
| Time | none set — continuous delivery |
| Cost | none set |

## Project management team
| Role | Name |
|---|---|
| Executive | Davide Paci |
| Senior User | Davide Paci |
| Senior Supplier | Davide Paci |
| Project Manager | Davide Paci |

## Approach
Built in-house, in this repository, as Claude Code skills and a mod, with the phased workflow
(`.phased/`). Agile profile: one continuous delivery stage, work packages grouping the forge
issues of `dgpaci/p2kit` in milestones, each naming the objectives it serves; timeboxed
iterations with `/pm-iterate`, retrospectives with `/pm-retro`.

## Initial risks
See `registers/risks.yaml`.

## Open points
- Iteration length (one or two weeks).
- Whether to set an effort tolerance once work packages carry effort estimates.
- When a second project, besides anaci, should adopt p2kit to widen the feedback.
