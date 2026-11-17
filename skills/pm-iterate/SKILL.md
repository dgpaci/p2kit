---
name: pm-iterate
description: Open or close a timeboxed iteration of the current stage — number, goal, dates, work packages, and at close what was delivered and the result — kept in .pm/registers/iterations.yaml, written only after the user's explicit OK. Use when the user asks to start, open, plan or close an iteration or a sprint, to set the iteration goal, or asks for /pm-iterate.
---

# Open or close an iteration

An iteration is a timebox with a goal across the work packages of the current stage; the desk
shows the open one in the row, the recap and the Iterations tab (docs/pm-schema.md →
*`registers/iterations.yaml`*). This skill writes only `.pm/registers/iterations.yaml`, one entry
at a time, after the user's OK; it never touches the forge and commits nothing.

1. Read `.pm/project.yaml` (`stage.current`, `profile`), `.pm/registers/iterations.yaml` if it
   exists, and the work packages of `.pm/work-packages/` (id, title, stage, status). When
   `profile` is not `agile`, say in one line that `profile: agile` documents the practice in
   `project.yaml`, and go on.
2. Choose the action. The argument `open` or `close` forces it. No argument → **close** when an
   iteration is open (`status: open`, or no `status`), else **open**.
3. **Open**:
   - an iteration is already open → say which (number, goal, end) and offer to close it first;
     open nothing while it stays open;
   - `number`: the highest number of the register + 1, 1 when there is none;
   - `start`: today; `end`: start + the previous iteration's length (its `end` − `start` in days),
     else start + 14 days. The user may change either;
   - `stage`: `stage.current`;
   - `goal`: ask the user for it, in one line;
   - `work_packages`: propose the open work packages of the current stage (status neither
     `completed`, `archived` nor `cancelled`), id and title; the user picks.
4. **Close** — the open iteration, the highest number when several are open:
   - show its number, goal, dates and each of its work packages with its status;
   - propose `delivered`: its work packages now `completed` or `archived`; the user may correct it;
   - ask for the one-line `result`;
   - set `status: closed`.
5. Show the exact YAML entry as it will be written — a block-list entry under `iterations:`, with
   `work_packages` and `delivered` as flow lists:

   ```yaml
     - number: 3
       goal: Checkout end to end
       start: 2026-11-16
       end: 2026-11-30
       stage: 2
       status: open
       work_packages: [WP-04, WP-05]
   ```

   and ask for an explicit OK. Without it, write nothing; apply the corrections and show it again.
6. On the OK, write `.pm/registers/iterations.yaml`: create it with `iterations:` and the entry
   when it does not exist; when opening, append the entry; when closing, change that one entry
   (`status`, `delivered`, `result`) and leave every other entry and line as it is. Stay within the
   YAML subset of docs/pm-schema.md: a value with `: ` or ` #` goes in single quotes,
   or in double quotes when it holds a `'` (the subset has no escapes).
7. Tell the user in one line what was written (iteration number, opened or closed), that the desk
   shows it at its next refresh, and — after a close — suggest `/pm-retro` for the
   retrospective. Nothing is committed: `.pm/` is committed with the code, when the user decides.
