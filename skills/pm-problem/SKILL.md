---
name: pm-problem
description: Write the report of a problem of a p2kit project for the Project Board — description, impact on time, cost, scope, quality, benefits and risk, the options with their effect, the recommendation — for an entry of the Problems register .pm/registers/issues.yaml, or for a new one raised first after its own OK; saved under .pm/reports/ and linked from the entry only after the user's explicit OK, the Board's decision recorded only when the user states it. Use when the user asks to add or raise a problem in the register (the report then only if asked), for an issue report, a problem report, to escalate a problem or a request for change to the Board, to weigh the options of a problem, to record the Board's decision on one, or asks for /pm-problem.
---

# Problem report

The report is the Issue Report of the method, renamed: in p2kit an *issue* is a forge issue
(`/pm-issue`), and the Issue Register is the desk's **Problems** register
(docs/pm-schema.md → *`registers/issues.yaml`*). It puts one entry before the Board — what
happened, what it costs, what can be done — and carries the Board's decision once taken. This
skill writes only `.pm/registers/issues.yaml` and its own report, each after the user's OK; it
never records a decision the user did not state, never writes to the forge and commits nothing.

1. Read `.pm/project.yaml` (`code`, `stage`, `tolerances`, the people of `roles`) and
   `.pm/registers/issues.yaml`. The argument is an entry id (`I-004`, `4`). None given → list the
   open entries — id, type, priority, title, `report` when it has one — and ask which, or whether
   to raise a new one. A request to add a problem goes straight to step 2.
2. **Raise a new entry** first, when the problem is not in the register: `title`, `type`
   (request-for-change | off-specification | problem), `priority` (low | medium | high) asked,
   never guessed, `status: open`, `raised: <today>`, the next `I-<nnn>` after the highest id
   (three digits, from `I-001`). Show the entry and ask for an explicit OK; on the OK append it to
   the register (create the file with `issues:` when missing), every other line as it is. No OK →
   stop: there is no report without its entry.

   Adding a problem does not imply a report: most entries stay a line of the register. Go on to
   the report only when the user asked for one ("report", "escalate", "the Board must decide");
   when the request was only to add or raise the problem, or it is unclear, ask whether to draft
   its report now, and on a no stop after step 8's summary.
3. Gather the sources:
   - the entry, and the Daily Log entries naming it (`register: <I-id>` in
     `.pm/registers/daily-log.yaml`) for what was said when it was raised;
   - the tolerances, the stage and its plan's dates; the work packages and brief objectives the
     user names as touched (`.pm/work-packages/`, `## Objectives` of `.pm/brief.md`);
   - the open risks of `.pm/registers/risks.yaml` the problem makes likelier;
   - what the user says in chat: cause, figures, options already on the table.
   An earlier report of the entry (its `report:`) is the starting point: rewrite it, do not start
   over. A figure no source gives — days, cost, a scope item — is asked, never estimated in
   silence; an estimate the user gives is written as an estimate.
4. Draft the report, in the language of the project's issues, under these headings, in plain
   sentences:
   - **Summary** — two lines: what happened and what the Board is asked to decide;
   - **Description** — the problem, its cause when known, who raised it and when;
   - **Impact** — only the relevant lines of time, cost, scope, quality, benefits and risk, each
     against its tolerance when it has one; a forecast beyond a tolerance says so first, and that
     the stage is then in exception (`/pm-document` drafts the Exception Report);
   - **Options** — two or more, doing nothing among them when it is a real choice, each with its
     effect on the same lines as Impact and what it needs (time, people, money);
   - **Recommendation** — the option the Project Manager recommends and why, in two or three
     lines; when the user has not chosen, propose one and say it is Claude's proposal;
   - **Decision** — `Pending the Project Board.`
   Every statement comes from a source of step 3; a section with nothing to say says so in one
   line.
5. Show the draft and, under it, the key the entry gains, `report:` (step 6). Ask for an explicit
   OK. Without it, write nothing; apply the corrections and show the draft again.
6. On the OK:
   - save `.pm/reports/<today>-problem-<I-id>.md` (the desk lists it under Documents with the
     other reports) with the products frontmatter — or, when the entry already has a report,
     rewrite that file, `version` up by 0.1:

     ```markdown
     ---
     title: Problem report I-004 — Payment provider moves the sandbox go-live
     product: problem-report
     version: 0.1
     status: draft
     updated: <today>
     ---
     ```

     A title holding a `'` goes in double quotes (docs/pm-schema.md → *YAML subset*);
   - in `.pm/registers/issues.yaml` set `report: reports/<file>` on the entry — that one key,
     every other line as it is. An entry written as a flow map `{ … }` may become a block entry.
7. **The Board's decision**, in this run or a later one, only when the user states it in chat
   ("the Board chose option 2", "Anna approved the change"). Draft:
   - the report's **Decision** section: the option chosen, by whom, the date, any condition;
     `status: approved` and `version` up by 0.1 in its frontmatter;
   - on the entry, `decision: "<one line>"` in double quotes; `status: closed` only when the user
     also says the problem is closed.
   Show both and ask for an explicit OK; on the OK write them, nothing else changed. A decision
   that needs work → say that `/pm-issue` or `/pm-package` makes it a forge issue or a work
   package; one that moves a tolerance or the stage plan is the Board's change to
   `.pm/project.yaml`, made only on its own request.
8. Tell the user in a few lines what was written (entry raised, report saved with its path,
   decision recorded, entry closed) and that the desk shows them at its next refresh, the report
   under Documents. Nothing is committed: `.pm/` is committed with the code, when the user decides.
