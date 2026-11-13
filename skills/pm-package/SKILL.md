---
name: pm-package
description: Group forge issues and pull requests into a work package — a forge milestone they all join and a .pm/work-packages/WP-<nn>.md linked to it — or make the work package of an existing milestone. Shows the plan and writes to GitHub or Forgejo only after the user's explicit OK. Use when the user picks issues or pull requests to package together, presses Create package or Create work package on the project desk, or asks for /pm-package.
---

# Package issues and pull requests into a work package

On the forge a work package is a milestone: the work package whose frontmatter `milestone:` is
the milestone's title is the one the desk shows next to it (docs/pm-schema.md → *Activity*).
This skill writes to the forge only after the user's OK — a milestone, and the milestone of the
picked issues and pull requests — then writes one work package file. It commits nothing.

1. **Read the arguments.**
   - References: `#12` an issue, `PR #18` a pull request, any number of them
     (`/pm-package #12 #15 PR #18`).
   - Or `--milestone '<title>'`: make the work package of that milestone; the title is everything
     between the first and the last `'`.
   - Nothing given → ask which issues or pull requests, or which milestone.
2. **Read the project.** `.pm/project.yaml` for `stage.current` and `code`; the frontmatter of every
   `.pm/work-packages/WP-*.md`. The forge and the repo come from `git remote get-url origin`:
   `github.com` is GitHub (`gh`), any other host is Forgejo, the repo is `<owner>/<name>` of the
   URL. On Forgejo the token is the one `fj auth` saved, read inline where a command needs it and
   never printed or written anywhere:
   `$(jq -r '.hosts["<host>"].token' ~/Library/Application\ Support/forgejo-cli.forgejo-cli/keys.json)`.
3. **Read the forge, GET only.** For each reference its title, state and milestone:
   GitHub `gh issue view <n> --json title,state,milestone` / `gh pr view <n> --json title,state,milestone`;
   Forgejo `GET https://<host>/api/v1/repos/<repo>/issues/<n>` (a pull request is an issue there).
   The milestones, every page — a title missed on a later page would be created twice: GitHub
   `gh api --paginate 'repos/<repo>/milestones?state=all&per_page=100'`, Forgejo
   `GET …/repos/<repo>/milestones?state=all&limit=50&page=<p>` from page 1 until a page returns fewer
   than 50. With `--milestone`, also its open items.
   A reference that does not exist or is closed → say so and leave it out.
4. **Ask the package title**, offering a default: the milestone's title with `--milestone`, else the
   first issue's title. The milestone and the work package take this title.
5. **Draft the plan** and show it:
   - the milestone: *create* `<title>`, or *reuse* the one with that title (say if it is closed);
   - the items to assign to it, `#n title` / `PR #n title`;
   - apart, the items already in **another** milestone, with its title: they move only if the
     user confirms each of them, else they stay where they are and are left out;
   - the work package: the one already carrying `milestone: <title>` (reused, nothing written),
     else a new `WP-<nn>` with the next free number — `title`, `product: work-package`,
     `stage` = the current stage, `status: draft`, `milestone: <title>` — and a body listing the
     packaged items, one `- #n title` line each.
6. **Ask for an explicit OK.** Without it, write nothing; apply the user's corrections and show the
   plan again.
7. **On the OK, write to the forge**, in this order, and stop at the first failure — report what was
   done and what was not, and write no work package file:
   - the milestone, when it is to be created:
     GitHub `gh api -X POST repos/<repo>/milestones -f title='<title>' --jq .number`;
     Forgejo `curl -sS -X POST "https://<host>/api/v1/repos/<repo>/milestones" -H "Authorization: token <token>" -H 'Content-Type: application/json' -d "$(jq -n --arg t '<title>' '{title: $t}')"`,
     its `id` from the answer (a reused one: its `id` from the list of step 3);
   - each item: GitHub `gh issue edit <n> --milestone '<title>'` for an issue,
     `gh pr edit <n> --milestone '<title>'` for a pull request; Forgejo
     `curl -sS -X PATCH "https://<host>/api/v1/repos/<repo>/issues/<n>" -H "Authorization: token <token>" -H 'Content-Type: application/json' -d '{"milestone": <id>}'`
     for issues and pull requests alike.

   Every title in a shell command goes in single quotes, with each `'` inside it written `'\''`
   (`l'anagrafica` → `'l'\''anagrafica'`); the JSON body is built by `jq --arg`, never by hand.
8. **Write the work package** `.pm/work-packages/WP-<nn>.md` when a new one was planned, within the
   YAML subset (docs/pm-schema.md → *YAML subset*): one `key: value` per line; a title holding a `:`
   or a `#` — the `title:` and the `milestone:` value alike — in single quotes, with every `'` inside
   it doubled.
9. **Tell the user** in a few lines the milestone (created or reused) and its URL, the items assigned
   and the ones left where they were, and the work package written. Nothing is committed: `.pm/` is
   committed with the code, when the user decides. The desk shows the milestone with its work
   package at its next refresh, or at once with `/pm-desk`; `/pm-link` adds a branch to it.
