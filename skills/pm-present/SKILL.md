---
name: pm-present
description: Write the presentation of a p2kit work package for its users and the Project Board — what is new, what improves, how it works — from the phases of its plan, its linked issues and pull requests and the manuals of the project's documents; shown as a draft and saved under .pm/presentations/ only after the user's explicit OK. Use when the user asks to present a work package, to explain to the users or the Board what a work package delivered, for release notes of a work package, or asks for /pm-present.
---

# Present a work package to its users and the Board

The presentation tells people who did not follow the work what it brings them. It is written for
the users and the Board, not for developers: no commit, branch, sha or table names, no phase
numbers. This skill reads the forge (GET only), never writes to it, writes only its own file after
the user's OK, and commits nothing.

1. The argument is a work package id (`WP-02`, `2`). None given → list the work packages of the
   current stage (`stage.current` of `.pm/project.yaml`), open or completed, and ask which one.
2. Gather the sources:
   - the work package file: title, status, body, link keys `issue`, `milestone`, `branch`;
   - the plan, when the desk shows phases: the entry of the work package in
     `~/.claude/p2kit/desk.json` (project found by step 1 of skills/pm-digest/SKILL.md) gives
     `delivery.objective` and, per phase, `title`, `state` and `outcome`; for the full text read
     the plan itself with `git show <delivery.ref>:<delivery.planPath>`;
   - the forge items: the milestone's items (`delivery.forge.milestoneItems`), else the linked
     issue and the branch's pull requests (`delivery.forge.issue`, `delivery.forge.pulls`). Read
     the body of each closed issue and merged pull request — `gh issue view <n>` / `gh pr view <n>`
     on GitHub, `fj issue view <n>` / `fj pr view <n>` on Forgejo (host of
     `git remote get-url origin`); a fix that changes nothing a user sees is left out of the text;
   - the manuals: the files of the `documents:` folders of `.pm/project.yaml` whose title or path
     names the work package's subject; read the relevant ones, and link them in the presentation.
   A source that cannot be read is named in one line under the draft, not guessed.
3. Draft the presentation, in the language of the project's issues (Italian for an Italian
   project), under these headings, in plain sentences:
   - **In brief** — two or three lines: what the work package brings and to whom;
   - **What is new** — one short paragraph per new capability, grouped by user task, not by issue;
   - **What improves** — what was slow, error-prone or missing before, and how it is now;
   - **How it works** — the path a user follows, step by step, with the names the screens use;
     link the manual pages for the detail;
   - **Still open** — the open items of the milestone, in words, or `nothing` when all are closed;
   - **Sources** — the issues and pull requests drawn on, as links.
   Every statement comes from a source of step 2; nothing is invented to fill a section — a
   section with nothing to say says so in one line.
4. Show the draft and ask for an explicit OK. Without it, write nothing; apply the user's
   corrections and show the draft again.
5. On the OK, save `.pm/presentations/<WP-id>.md` with the products frontmatter, replacing an
   earlier version of the same file:

   ```markdown
   ---
   title: <WP title> — presentation
   product: presentation
   version: 0.1
   status: draft
   updated: <today>
   ---
   ```

   A title holding a `'` goes in double quotes (docs/pm-schema.md → *YAML subset*).
6. Tell the user in one line where the presentation is (the desk lists it under Documents) and,
   when the work package is `completed`, that `/pm-archive <WP-id>` takes it off the work themes.
   Nothing is committed: `.pm/` is committed with the code, when the user decides.
