---
name: pm-link
description: Link a work package of the current stage to a forge issue, a milestone, a branch or issues and pull requests named one by one (items, also across repos), so the project desk shows it as a work theme with its phases, commits and pull requests. Writes the link keys in .pm/work-packages/WP-<nn>.md. Use when the user asks to link an issue, a milestone, a branch or some issues and pull requests (genropy#1974) to a work package, to start tracking a work theme, or asks for /pm-link.
---

# Link a work package to an issue, a milestone or a branch

A work theme is a work package carrying link keys in its frontmatter: `issue`, `milestone`,
`branch`, `base`, `items` (docs/pm-schema.md → *Work themes*, *Cross-repo projects*). This skill writes only
`.pm/work-packages/`; it never writes to GitHub or Forgejo and commits nothing.

1. The argument is an issue number (`498`, `#498`), a milestone title, a branch name, or one or more
   item references (`genropy#1974 anaci#628`). None given → ask which. On a project whose
   `project.yaml` lists `repos:` (a cross-repo project) an issue or pull request is always an item,
   written `<repo>#<n>` with the repo's name as the desk shows it (its last path segment, or
   `owner/repo` when two repos share it); a number with no repo → ask which repo.
2. Read `.pm/project.yaml` for `stage.current`, and the frontmatter of every
   `.pm/work-packages/WP-*.md`. If one already carries that `issue`, `milestone`, `branch` or item,
   that is the work package: update its link keys (step 4) and go to step 5.
3. Otherwise list the work packages of the current stage (id, title, status) and ask which one to
   link, or offer a new one: `WP-<nn>` with the next free number, `stage` = the current stage,
   `status: draft`, `product: work-package`. Its title is a short name — one to three words, the
   one the desk shows in every row — asked of the user, never the issue title copied: read the
   issue's title (`gh issue view <n> --json title -q .title` on a `github.com` origin,
   `fj issue view <n>` on any other host — read `git remote get-url origin`) and propose a short
   name drawn from it (`Rivedere il giro delle certificazioni UNI: …` → `Certificazioni`).
4. Fill the link keys:
   - `issue`: the number, when the argument is one, else leave it as it is.
   - `milestone`: the title, when the argument is one.
   - `branch`: when the argument is a branch, that one. Else, with an issue and no branch yet,
     look for it with `git branch -a --list '<issue>-*' '*/<issue>-*'` (local git, no fetch: the
     number must start a path segment, so issue 98 never matches `feature/498-…`) and propose the
     match, without the `remotes/origin/` prefix; confirm it with the user. No match → ask, or
     leave it absent.
   - `base`: ask, `''` (the repo's default branch) by default.
   - `items`: the references given, added to the list the work package already carries, once
     each, as a flow list `items: [genropy#1974, anaci#628]`; on a project reading its origin
     `items: ['#12']`. To unlink an item, take it out of the list; an empty list is dropped.
     Read each one first (`gh issue view <n> -R <owner>/<repo>` on GitHub,
     `fj -H <host> issue view <owner>/<repo>#<n>` on Forgejo, host and repo from its `repos:`
     remote; both answer for a pull request too) and say its title, so a typo in a number is
     caught before it is written.
   - `objectives`: when `.pm/brief.md` has an `## Objectives` checklist and the work package
     carries no `objectives:` yet, list the open objectives (id and title) and offer the ones the
     work package serves, `objectives: [O-2, O-4]`; only ids of the brief, none if the user says so.

   Keep the frontmatter within the YAML subset (docs/pm-schema.md → *YAML subset*): one
   `key: value` per line; any value holding a `:` or a `#` — an issue title often does, a
   milestone title may — in single quotes, or in double quotes when it holds a `'` (the subset
   has no escapes).
   Change no other key and leave the body as it is.
5. Tell the user in one line which work package now carries which link, and that nothing is
   committed: `.pm/` is committed with the code, when the user decides. The desk shows it at its
   next refresh, or at once with `/pm-desk`.
