---
title: Project Initiation Documentation
product: pid
version: 0.1
status: approved
updated: 2026-11-17
---

# Project Initiation Documentation — p2kit

## 1. Project definition
- **Objective:** make p2kit useful and usable in day-to-day project management. Measured by use:
  every open signal on the desk of anaci and of p2kit itself can be acted on without leaving the
  desk and the skills.
- **Scope:** in — the skills, the project desk (pane and browser page), the `.pm/` schema and its
  documentation, the optional forge integration (GitHub, Forgejo); out — any dependency of the
  core on the forge, text from the official manual.
- **Deliverables:** releases of the plugin from `main`, each with its updated `docs/pm-schema.md`
  and README.
- **Constraints and assumptions:** the core works standalone; `.pm/` YAML stays within the subset
  the desk parses; PRINCE2® never in a plugin, skill or command name. Assumption: anaci stays the
  main source of requirements until a second project adopts p2kit.
- **Interfaces:** anaci, whose `.pm/` data must keep reading after every schema change; Claude Code
  and Claude Desktop (mod engine, deep links); GitHub and Forgejo APIs.

## 2. Business case
p2kit removes management products written by hand and status gathered by reading the forge one
item at a time. Cost is the maintainer's time, with no budget set; there is no end date. The
project is worth continuing while each iteration removes a manual step from managing anaci or
p2kit. Reviewed at every retrospective.

## 3. Project management team
| Role | Name | Responsibility in this project |
|---|---|---|
| Executive | Davide Paci | owns the business case, decides |
| Senior User | Davide Paci | specifies needs from real use, accepts the product |
| Senior Supplier | Davide Paci | builds the plugin |
| Project Manager | Davide Paci | runs the project day to day |

One person holds every role (risk R-001): pull-request review and use on anaci stand in for
independent assurance.

## 4. Tolerances
| Area | Project tolerance | Escalation |
|---|---|---|
| Time | none — continuous delivery | — |
| Cost | none set | — |
| Scope | none set; work packages may be reordered at any iteration | — |

## 5. Approach and strategies
- **Quality:** every change goes through a pull request to `main` with `claude plugin test` green;
  a work package is accepted when it is used on a real project.
- **Risk:** risks in `registers/risks.yaml`, reviewed at each retrospective.
- **Change and issues:** new needs enter as forge issues of `dgpaci/p2kit`; the Project Manager
  groups them into work packages and reorders them with `/pm-roadmap`.
- **Communication:** highlight report every 14 days (`/pm-report`); the desk is the day-to-day view.

## 6. Project plan
| Stage | Name | Start | End | Main products |
|---|---|---|---|---|
| 1 | Initiation | 2026-11-17 | 2026-11-17 | PID, stage 2 plan |
| 2 | Delivery | at authorization | continuous | plugin releases, one work package at a time |

## 7. Controls
- One continuous delivery stage, paced by timeboxed iterations (`/pm-iterate`) closed by a
  retrospective (`/pm-retro`).
- Highlight reports every 14 days; an exception report if the business case stops holding.
- Baseline of the approved stage: git tag `pm/stage-2-approved`.

## 8. Tailoring
Profile **agile**: the light products plus iterations. The business case and the strategies stay
inside this PID; no quality register or daily log for now; one stage with no end date instead of
dated stage boundaries.
