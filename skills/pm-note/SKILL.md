---
name: pm-note
description: Add or close an internal note (follow-up, blocker, remark) on a commit of a work package's branch, kept in .pm/registers/commit-notes.yaml and shown by the project desk. Use when the user asks to note something on a commit, flag a blocker on a work-package branch, close a note, or asks for /pm-note.
---

# Notes on the commits of a work package's branch

Internal notes stay in the project's `.pm/`, never on the forge. This skill writes only
`.pm/registers/commit-notes.yaml`; it posts nothing to GitHub or Forgejo and commits nothing.

1. Read the frontmatter of `.pm/work-packages/WP-*.md`. The work package is the one whose `branch`
   is the current git branch (`git branch --show-current`); else ask which, among the work
   packages carrying a `branch`. None carries one → stop and say no work package is linked to a
   branch: `/pm-link` links one. Take its `id`, `branch` and `base`.
2. List the branch's commits with local git only, never a fetch:
   `git log --date=short --format='%h %ad %s' <base>..<branch>` — `branch`, else `origin/<branch>`;
   `base` likewise, and `''` means `git symbolic-ref --short refs/remotes/origin/HEAD`.
3. **Adding**: the commit is the one the user named (a sha or its subject), else ask which. Ask the
   `kind` — `follow-up`, `blocker` or `remark` — and the text, unless already given. Append:

   ```yaml
   notes:
     - { sha: <short sha>, wp: WP-<nn>, kind: blocker, status: open, text: '<text>', date: <YYYY-MM-DD> }
   ```

   Create the file with `notes:` when missing. Quote the text in single quotes (double any `'`
   inside it): a comma or a colon would otherwise break the flow map. One line per note.
4. **Closing**: list the open notes of the work package, ask which one, and change its `status` to `closed`.
   Change nothing else; never delete a note.
5. Tell the user in one line what was written, and that it is not committed: `.pm/` is committed
   with the code, when the user decides.
