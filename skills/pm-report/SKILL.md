---
name: pm-report
description: Draft the Highlight Report of a p2kit project for the Project Board — stage status, tolerances, work completed and planned, risks and issues, blockers, flow — from the project desk's snapshot; save it under .pm/reports/ and move the next report date only after the user's explicit OK. Use when the user asks for a highlight report, a status report for the Board, the periodic report, or asks for /pm-report.
---

# Highlight Report

The report reads the desk's snapshot, like `/pm-digest`, and drafts the report for the Project
Manager to send to the Board. This skill never calls `gh` or `fj`, never writes to the forge,
writes only after the user's OK, and commits nothing.

1. Find the project in `~/.claude/p2kit/desk.json` by step 1 of skills/pm-digest/SKILL.md (no
   snapshot, not registered, stale snapshot: same handling).
2. The period: from `reporting.last_highlight` of `.pm/project.yaml` — or `stage.start` when
   there is none — to today.
3. Collect, over the period:
   - the six digest sections, by the rules of step 2 of skills/pm-digest/SKILL.md, with this
     period in place of the last 7 days. The desk reads closed items for the last 90 days only:
     a period starting earlier says so in **Completed in the period** (`closed items listed
     from <today − 90> on`);
   - stage progress: `progress.done`/`progress.total` of `stage`, or on a continuous stage
     (`stage.isContinuous`) `<open> open · <completed> completed`;
   - the tolerances with their light, and the project's `light`; a tolerance with `isComputed`
     true takes its `used` from the work packages;
   - the stage effort, when `effort` is set: `actual`h of `estimate`h, deviation (signed) over
     `counted` work packages;
   - the brief objectives (`objectives`, the dropped ones left out): met over all, and per open
     objective the work packages in `wps` with `done` of them completed; none when the list is
     empty. Ticking one is never this skill's job: when one looks met, say so in **Blockers and
     decisions for the Board**;
   - the open high risks of `risks` (`score ≥ 6`), with owner, `responseActions` and `verdict`
     (`no response` when it has none); then the open risks of any score whose response is missing
     or not adequate, in one line each;
   - the work packages of the current stage with status `completed` or `archived` — all of them: a work
     package carries no completion date, so the section says they are the stage's, not the
     period's — and the open ones of the stage with status and due date;
   - the open `milestones` with their due date and `closed`/`open + closed`;
   - the 30-day flow window (`flow.windows[0]`): lead time, review, merge as median · p90 (n),
     and the issues closed and pulls merged in it.
4. Draft the report under these headings, in this order, in plain sentences built from the data:
   **Summary**, **Period and stage status**, **Tolerances**, **Completed in the period**,
   **Planned for the next period**, **Risks and issues**, **Blockers and decisions for the
   Board**, **Flow**. **Period and stage status** ends with the objectives line
   (`objectives <met>/<total> met`, then the open ones with their work packages). Summary and the Board requests are drafted from the data and from what the
   user adds in chat; a section with nothing to say says so in one line. **Period and stage
   status** carries one line with the stage effort when `effort` is set; **Tolerances** marks a
   computed tolerance (`isComputed`) `from work packages`.
5. Show the draft and ask for an explicit OK. Without it, write nothing; apply the user's
   corrections and show the draft again.
6. On the OK:
   - save `.pm/reports/<today>-highlight.md` with the products frontmatter:

     ```markdown
     ---
     title: Highlight Report <today>
     product: report
     version: 0.1
     status: draft
     updated: <today>
     ---
     ```

   - in `.pm/project.yaml` set `reporting.last_highlight: <today>` — that one key, nothing else
     changed, within the YAML subset of docs/pm-schema.md. The desk's next report date moves on
     its next refresh.
7. Tell the user in one line where the report is and the new next report date
   (`today + reporting.highlight_every_days`). Nothing is committed: `.pm/` is committed with the
   code, when the user decides.
