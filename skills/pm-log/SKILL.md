---
name: pm-log
description: Update the Daily Log of a p2kit project — the day's forge events (issues opened and closed, pull requests opened and merged) from the project desk's snapshot, plus the decisions, actions, problems and notes of a meeting transcript or of the user's own notes — kept in .pm/registers/daily-log.yaml after the user's explicit OK; a problem or a risk goes to its register or a forge issue only after its own OK. Use when the user asks to update the daily log, log a meeting, record what was said or decided today, summarise the day, close a logged action, or asks for /pm-log.
---

# Daily Log

The Daily Log is the project manager's diary: what happened in a day, what was decided, who does
what by when, the problems not yet formal (docs/pm-schema.md → *`registers/daily-log.yaml`*). The
forge part is read from the desk's snapshot, never from `gh` or `fj`; the rest comes from the
user. This skill writes only `.pm/registers/daily-log.yaml` after the user's OK, touches a
register or the forge only after a second OK for that one entry, and commits nothing.

1. Read `.pm/project.yaml` (`code`, the people of `roles`) and `.pm/registers/daily-log.yaml` if it
   exists. The **day** is today, unless the user names another.
2. **Forge events of the day.** Read `~/.claude/p2kit/desk.json` and take the entry of `projects`
   whose `path` equals `git rev-parse --show-toplevel` (no snapshot, or the repo not in it → say so
   in one line and skip this step; `refreshedAt` older than 10 minutes → say so, and suggest
   `/pm-desk` before going on). The events are, in this order:
   - `issue opened` — `forgeIssues` with `createdAt` equal to the day;
   - `issue closed` — `flow.closedIssues` with `closedAt` equal to the day;
   - `pull request opened` — `forgePulls` with `createdAt` equal to the day;
   - `pull request merged` — `flow.mergedPulls` with `closedAt` equal to the day.

   Each is one entry `kind: event, source: forge, text: '<event>: <title>', ref: '#<n>'`. Leave
   out a `ref` already logged as a forge event on the same day, so running the skill twice adds
   nothing twice. The snapshot's days are UTC days, and an item opened and closed on the same day
   is only in the closed lists: say so when it matters, never guess the missing event. `flow: null`
   → no forge events.
3. **The user's input**, when given: a text in the message, or a file path (a meeting transcript,
   notes). Read the file; it never goes into `.pm/` and is never quoted at length. Extract one
   line per entry, faithful to what was said, never inferred:
   - `decision` — something agreed;
   - `action` — something someone will do: `owner` the person named (as written in `roles` when
     it is one of them), `due` when a date was said, `status: open`;
   - `problem` — something wrong or in the way, not yet in a register;
   - `event` — something that happened worth remembering (a meeting held, a release, a visit);
   - `note` — anything else useful later.

   A meeting transcript gives `source: meeting` and a first `event` naming the meeting and who
   took part; the user's own notes give `source: manual`. An action whose owner is unclear stays
   without `owner`, and the draft says so: ask, never guess. Names of people outside the roles are
   written only when they own an action.
4. **Closing actions**: when the user says a logged action is done, change its `status` to `done`.
   List the open actions (`kind: action`, `status: open`) when the user asks which.
5. Show the exact entries as they will be written, flow maps within the YAML subset of
   docs/pm-schema.md, a text in single quotes, or in double quotes when it holds a `'` (the subset
   has no escapes):

   ```yaml
   entries:
     - { id: D-012, date: 2026-11-17, kind: event, source: forge, text: 'issue closed: Fix login', ref: '#41' }
     - { id: D-013, date: 2026-11-17, kind: event, source: meeting, text: 'alignment meeting with the customer: Davide Paci, Marco Bianchi' }
     - { id: D-014, date: 2026-11-17, kind: decision, source: meeting, text: 'the export keeps the old layout until January' }
     - { id: D-015, date: 2026-11-17, kind: action, source: meeting, text: 'send the revised price list', owner: Marco Bianchi, due: 2026-11-21, status: open }
     - { id: D-016, date: 2026-11-17, kind: problem, source: meeting, text: "the customer's test server is down since Friday" }
   ```

   Ids are `D-<nnn>`, the next numbers after the highest in the file, three digits, starting at
   `D-001`. Group the draft by source (forge, then the user's input) so it reads at a glance, and
   list the actions whose status changes. Ask for an explicit OK. Without it, write nothing;
   apply the corrections and show them again.
6. On the OK, write `.pm/registers/daily-log.yaml`: create it with `entries:` when it does not
   exist; otherwise append the new entries at the end and change only the `status` of the actions
   confirmed done, leaving every other line as it is.
7. Offer, one at a time and each after its own explicit OK, to move a `problem` (or a risk the
   meeting raised) out of the diary:
   - into the Issue Register `.pm/registers/issues.yaml` (`type: problem`, `priority` asked,
     `status: open`, `raised: <day>`, the next `I-<nnn>`) — or, for a risk, the Risk Register
     `.pm/registers/risks.yaml` (probability, impact, owner asked; the next `R-<nnn>`);
   - or into a forge issue, drafted and created exactly as skills/pm-issue/SKILL.md steps 3–5 do,
     with last line `Daily Log: <D-id> — <project code>`.

   Then write the entry's `register: <I-id | R-id>` or `issue: <n>` in `daily-log.yaml`, nothing
   else changed. No OK → the entry stays in the log only. A failed creation → report it and write
   nothing for that entry.
8. Tell the user in a few lines what was written (entries by id, actions closed, what went to a
   register or the forge) and that the desk shows them in its Daily log tab at the next refresh,
   with an open action past its due in Needs attention. Nothing is committed: `.pm/` is committed
   with the code, when the user decides.
