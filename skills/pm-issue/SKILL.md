---
name: pm-issue
description: Draft the forge issue of a work package with the readiness headings (default Why / What changes / Done when), create it on GitHub or Forgejo only after the user's explicit OK, and record its number as `issue:` in .pm/work-packages/WP-<nn>.md. Use when the user asks to open an issue for a work package, to make a work package ready, or asks for /pm-issue.
---

# Open the forge issue of a work package

The issue carries the headings the desk's readiness check looks for, so an issue opened here is
never `notready` (docs/pm-schema.md → *Readiness*). This skill writes to the forge only after the
user's OK, writes only the `issue` key of one work package, and commits nothing.

1. The argument is a work package id (`WP-03`, `3`). None given → read `.pm/project.yaml` for
   `stage.current`, list the work packages of that stage without an `issue` (id, title, status)
   and ask which one. If the chosen work package already has `issue`, say so and stop.
2. Read the headings: `readiness.headings` of `.pm/project.yaml`, else `Why`, `What changes`,
   `Done when`.
3. Draft the issue:
   - title: the work package's title;
   - body: one `## <heading>` section per heading, in their order, filled from the work package's
     body and the conversation; the last heading (`Done when` by default) as a `- [ ]` checklist;
   - last line: `Work package: <WP-id> — <project code>` (`code` of `project.yaml`).
4. Show the title and the body, and ask for an explicit OK. Without it, create nothing; apply the
   user's corrections and show the draft again.
5. On the OK, write the body to a temporary file and create the issue, by the host of
   `git remote get-url origin`:
   - `github.com` → `gh issue create --title '<title>' --body-file <tmp>`;
   - any other host (Forgejo) → `fj issue create --body-file <tmp> '<title>'`; if the repo
     disables blank issues, add `--template work-item` (the template `/pm-register` installs).

   The title goes in single quotes with every `'` inside it written `'\''` — Italian titles
   carry apostrophes (`l'anagrafica` → `'l'\''anagrafica'`).

   Read the issue number from the command output (the URL ends with it). A failure → report it
   and write nothing.
6. Write `issue: <n>` in the work package's frontmatter — one `key: value` line, no other key
   changed, the body left as it is.
7. Tell the user in one line the issue's number and URL, that the work package now carries it,
   and suggest `/pm-link <n>` to link its branch. Nothing is committed: `.pm/` is committed with
   the code, when the user decides.
