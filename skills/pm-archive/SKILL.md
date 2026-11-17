---
name: pm-archive
description: Archive a completed work package of a p2kit project — set its status from completed to archived in .pm/work-packages/WP-<nn>.md only after the user's explicit OK, so it leaves the work themes of the project desk and stays in the Work packages tab. Use when the user asks to archive, shelve or put away a completed work package, to clear it from the desk's themes, or asks for /pm-archive.
---

# Archive a completed work package

`archived` follows `completed`: the work is delivered and the Board has seen it
(docs/pm-schema.md → *Work packages*). A completed work package stays among the desk's work themes
until it is archived; an archived one is listed only in the Work packages tab and still counts as
delivered. This skill changes one key of one file, only after the user's OK, never touches the
forge and commits nothing.

1. The argument is a work package id (`WP-02`, `2`). None given → list the work packages of
   `.pm/work-packages/` with status `completed` (id, title, stage) and ask which one; none
   completed → say so and stop.
2. Read the chosen file's frontmatter:
   - status `archived` → say it is already archived and stop;
   - status other than `completed` → say its status and stop: only a completed work package is
     archived. When the user says the work is finished, the status is first set to `completed` —
     a Board decision the user states in chat, never inferred from the forge.
3. Show the work package (id, title, stage, linked issue / milestone / branch) and, when
   `.pm/presentations/<WP-id>.md` exists, that its presentation is there; when none exists, say
   so and offer `/pm-present <WP-id>` first.
4. Ask for an explicit OK to archive it. Without it, change nothing.
5. On the OK, change the `status:` line of the frontmatter to `status: archived` — that one line,
   every other line of the file as it is.
6. Tell the user in one line that the work package is archived and leaves the desk's work themes
   on its next refresh. Nothing is committed: `.pm/` is committed with the code, when the user
   decides.
