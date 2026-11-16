---
name: pm-digest
description: Write the weekly digest of a p2kit project for the alignment meeting — closed this week, pull requests in review, stalled and waiting items per person, issues needing a decision, open blockers — from the project desk's snapshot, saved under .pm/digests/. Use when the user asks for the weekly digest, the alignment-meeting summary, what happened this week, or asks for /pm-digest.
---

# Weekly digest

The digest reads the desk's snapshot, so stalled, waiting, in review and blockers mean exactly
what the desk shows (docs/pm-schema.md → *The desk snapshot*). This skill never calls `gh` or
`fj`, never writes to the forge, writes only its own file under `.pm/digests/` and commits
nothing.

1. Find the project. Read `~/.claude/p2kit/desk.json`; take the entry of `projects` whose `path`
   equals `git rev-parse --show-toplevel`.
   - No snapshot file → say to open the desk with `/pm-desk`, which writes it, and stop.
   - The repo not in it → say the project is not registered, suggest `/pm-register`, and stop.
   - `refreshedAt` older than 10 minutes → go on, and note it in the header (step 3).
2. Collect the six sections over the period, by default the last 7 days (`from` = today − 7,
   `to` = today; a day is inside when it is after `from` and not after `to`, so consecutive
   digests never share a day). Every section is written, `none` when empty:
   1. **Closed this week** — `flow.closedIssues` and `flow.mergedPulls` with `closedAt` inside
      the period: `#<n> <title>` with the milestone, if any. `flow: null` → `no forge data`.
   2. **Pull requests in review** — `forgePulls` with `inReview`: `#<n> <title>`, last updated.
   3. **Stalled** — per person of `team`, their items with status `stalled`.
   4. **Waiting** — per person of `team`, items `waiting` (the author waits on someone) and
      `review` (a review is asked of that person), each tagged with its status. Forge mentions
      are not read: the forge answers them only for the token's own user.
   5. **Needing a decision** — the open entries of `issues` (the Issue Register):
      `request-for-change` and `off-specification` first, then the rest; within each group by
      `priority`, high → low.
   6. **Open blockers** — the notes of `.pm/registers/commit-notes.yaml` with `kind: blocker`
      and `status: open`: work package (`wp`, or `stage <n>`), short sha, text, date.
3. Write the digest:

   ```markdown
   ---
   title: Weekly digest <to>
   product: digest
   period: <from> → <to>
   updated: <today>
   ---

   # <project name> — weekly digest, <from> → <to>
   ```

   then one `## <section>` per section in the order above. A stale snapshot adds under the title
   `Desk data as of <refreshedAt> — refresh with /pm-desk.`
4. Save it as `.pm/digests/<today>.md`, replacing a digest of the same day. With the argument
   `copy`, also pipe it to `pbcopy`.
5. Show the digest and tell the user in one line where it is saved. Nothing is committed: `.pm/`
   is committed with the code, when the user decides.
