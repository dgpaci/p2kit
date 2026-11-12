---
name: pm-link
description: Link a work package of the current stage to a forge issue, a milestone or a branch, so the project desk shows it as a work theme with its phases, commits and pull requests. Writes the link keys in .pm/work-packages/WP-<nn>.md. Use when the user asks to link an issue, a milestone or a branch to a work package, to start tracking a work theme, or asks for /pm-link.
---

# Link a work package to an issue, a milestone or a branch

A work theme is a work package carrying link keys in its frontmatter: `issue`, `milestone`,
`branch`, `base` (docs/pm-schema.md → *Work themes*). This skill writes only
`.pm/work-packages/`; it never writes to GitHub or Forgejo and commits nothing.

1. The argument is an issue number (`498`, `#498`), a milestone title or a branch name. None
   given → ask which.
2. Read `.pm/project.yaml` for `stage.current`, and the frontmatter of every
   `.pm/work-packages/WP-*.md`. If one already carries that `issue`, `milestone` or `branch`,
   that is the work package: update its link keys (step 4) and go to step 5.
3. Otherwise list the work packages of the current stage (id, title, status) and ask which one to
   link, or offer a new one: `WP-<nn>` with the next free number, `stage` = the current stage,
   `status: draft`, `product: work-package`. Its title comes from the issue —
   `gh issue view <n> --json title -q .title` on a `github.com` origin,
   `fj issue view <n>` on any other host (read `git remote get-url origin`) — else ask it.
4. Fill the link keys:
   - `issue`: the number, when the argument is one, else leave it as it is.
   - `milestone`: the title, when the argument is one.
   - `branch`: when the argument is a branch, that one. Else, with an issue and no branch yet,
     look for it with `git branch -a --list '<issue>-*' '*/<issue>-*'` (local git, no fetch: the
     number must start a path segment, so issue 98 never matches `feature/498-…`) and propose the
     match, without the `remotes/origin/` prefix; confirm it with the user. No match → ask, or
     leave it absent.
   - `base`: ask, `''` (the repo's default branch) by default.

   Keep the frontmatter within the YAML subset (docs/pm-schema.md → *YAML subset*): one
   `key: value` per line; any value holding a `:` or a `#` — an issue title often does, a
   milestone title may — in single quotes, with every `'` inside it doubled.
   Change no other key and leave the body as it is.
5. Tell the user in one line which work package now carries which link, and that nothing is
   committed: `.pm/` is committed with the code, when the user decides. The desk shows it at its
   next refresh, or at once with `/pm-desk`.
