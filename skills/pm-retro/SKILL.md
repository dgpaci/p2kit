---
name: pm-retro
description: Run the retrospective of an iteration or a stage — the previous actions with the state of their forge issues, what we keep and what we change, one or two new actions — kept in the Lessons Log .pm/registers/lessons.yaml after the user's explicit OK, each action opened as a forge issue only after its own OK. Use when the user asks for a retrospective, a retro, lessons learned, or asks for /pm-retro.
---

# Retrospective

A retrospective looks back on one iteration (or on the stage, without iterations) and leaves
lessons and actions in the Lessons Log; the desk shows the last retrospective in the row and the
open actions in Needs attention and the Lessons tab (docs/pm-schema.md →
*`registers/lessons.yaml`*). This skill writes only `.pm/registers/lessons.yaml` after the user's
OK, creates a forge issue only after a second OK for that issue, and commits nothing.

1. Read `.pm/project.yaml` (`stage.current`, `code`, `readiness.headings`),
   `.pm/registers/iterations.yaml` and `.pm/registers/lessons.yaml` if they exist.
2. Choose the scope: the open iteration, else the last closed one, else the current stage. The
   user may name another iteration or stage. Say the scope in one line (iteration number and goal,
   or stage number and name).
3. Review the previous actions — the `actions` with `status: open`. Their issue state comes from
   the desk's snapshot, never from `gh` or `fj`: read `~/.claude/p2kit/desk.json` and take the
   entry of `projects` whose `path` equals `git rev-parse --show-toplevel` (no snapshot, or the
   repo not in it → every state is "not in the snapshot"; `refreshedAt` older than 10 minutes →
   say so). For each action with an `issue`:
   - its number among `forgeIssues` → open;
   - among `flow.closedIssues` → closed, with its `closedAt` day;
   - else → not in the snapshot.

   Show each open action with id, text, issue and that state, and propose `status: done` for the
   ones whose issue is closed; the user confirms or corrects, and may close an action without an
   issue.
4. Collect, from the user, what we **keep** and what we **change** (one lesson each, one line), and
   one or two **actions**: concrete, one line, something the team will do.
5. Show the exact entries as they will be written — flow maps within the YAML subset of
   docs/pm-schema.md, a text in single quotes, or in double quotes when it holds a `'` (the subset has no escapes):

   ```yaml
   retrospectives:
     - { date: 2026-11-21, iteration: 2, stage: 2 }
   lessons:
     - { id: L-003, date: 2026-11-21, iteration: 2, kind: keep, text: 'short daily sync' }
     - { id: L-004, date: 2026-11-21, iteration: 2, kind: change, text: 'review pull requests within a day' }
   actions:
     - { id: A-002, date: 2026-11-21, text: 'add a review reminder', status: open }
   ```

   - one retrospective: today, the iteration number (omitted for a stage scope), the stage;
   - lessons `L-<nnn>` and actions `A-<nnn>`: the next numbers after the highest in the file,
     three digits, starting at `L-001` / `A-001`;
   - the previous actions whose status changes, with `status: done`.

   Ask for an explicit OK. Without it, write nothing; apply the corrections and show them again.
6. On the OK, write `.pm/registers/lessons.yaml`: create it with the three lists when it does not
   exist; otherwise append the new entries to their lists and change only the `status` of the
   actions confirmed done, leaving every other line as it is.
7. Offer, for each new action, its forge issue — one at a time, each after its own explicit OK:
   draft and create it exactly as skills/pm-issue/SKILL.md steps 3–5 do (title: the action's text;
   one `## <heading>` section per readiness heading, the last as a `- [ ]` checklist; last line
   `Retrospective action: <A-id> — <project code>`; `gh issue create` on `github.com`,
   `fj issue create` elsewhere; the title quoted with every `'` written `'\''`). Read the number
   from the URL and write it as the action's `issue: <n>` in `lessons.yaml`, nothing else changed.
   No OK for an action → no issue, the action stays without one. A failed creation → report it and
   write nothing for that action.
8. Tell the user in a few lines what was written (the retrospective, the lessons and actions by
   id, the issues opened) and that the desk shows them at its next refresh. Nothing is committed:
   `.pm/` is committed with the code, when the user decides.
