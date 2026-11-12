# p2kit

A Claude Code plugin for project management aligned with PRINCE2®: skills that prepare the
management products of each process, project data kept in the project's own repo under `.pm/`,
and a multi-project "project desk" pane. Claude prepares; the human Project Board decides.

## Maintainer

dgpaci (Davide Paci) — owns the repo and reviews its PRs.

## Target branch for PRs

`main`.

## Language

English for issues, PRs, review comments, code comments, skills, templates and documentation.
Identifiers and commit messages are English as everywhere. Conversations with the user stay in
Italian.

## Forge

GitHub, public repo `dgpaci/p2kit` (MIT), CLI `gh`. Push only on the user's explicit OK. Not a Softwell repo: Claude attribution in commits and PRs is
allowed.

## Guidelines

- Trademark: PRINCE2® is a registered trademark of PeopleCert. Never put "PRINCE2" in the plugin
  name, a skill name or a command; write every template from scratch, never copy text from the
  official manual. The README says "aligned with, not affiliated".
- Claude never records a Board decision on its own: approvals in `project.yaml` are written only
  after the user states the decision in chat.
- The core works standalone. The forge-desk integration (work packages ↔ issues/PRs) is an
  optional extension (roadmap phase 3) and must stay optional.
- The `.pm/` schema is documented in `docs/pm-schema.md`; change the doc together with the code
  (`hooks/project.ts`, `hooks/yaml.ts`) and the skills that write it.
- YAML in `.pm/` stays within the subset `hooks/yaml.ts` parses (the mod has no Node and no npm).
- Ask the user whether a new branch should be a worktree or a plain branch.
- Mod style reference: `~/sviluppo/claude/forge-desk`.

## Mod notes (learned in the stage-delivery, desk-redesign and team-wip workflows)

- `claude plugin test` runs every `*.test.ts(x)` under the folder but skips dot folders, so tests
  under `.phased/` and worktrees under `.claude/` never run by accident.
- `$.http.fetch` takes no timeout. A hung call stalls every later refresh behind the `isLoading`
  flag: race it with `$.clock.sleep(ms, { signal })` and abort the sleep once the answer is in
  (`hooks/forge.ts:getForgeJson`). `$.process.run` takes `timeoutMs`.
- Forgejo's pull-request list has no head-branch filter: page `pulls?state=all&sort=recentupdate`.
  GitHub filters server-side with `pulls?head=<owner>:<branch>`.
- QA of a worktree build: `claude -p --plugin-dir <worktree>` loads the mod without the pane; read
  the board it writes to `~/.claude/p2kit/desk.html`. Another session loading p2kit rewrites that
  file every 60 s, so wait for content only the new code writes. `/pm-desk` run while the
  session-start reload is in flight returns "0 registered projects".
- The `claude plugin test` sandbox rejects `new Function` / `eval` (EvalError), so a test cannot
  compile the board's inline script: extract it and run `node --check` outside the suite.
- To render the board without the engine (QA against a mockup): `hooks/board.ts` and its imports
  use `claude-code` for types only, so a scratch `npx tsx` script can `await import()` it (no
  package.json: a static import fails; take `mod.renderBoard ?? mod.default.renderBoard`) and feed
  it fixture projects.
- Forgejo's `issues/search?assigned=true|created=true|review_requested=true` answers only for the
  token's own user. A per-person view reads the repo's open issues and pulls once and partitions
  them locally (`hooks/project.ts:addTeamState`, `hooks/team.ts:toTeamItems`).
- In `claude plugin test` the test `$` has no `env`/`fs`, so `loadProjects` cannot be called
  directly: drive the plugin (session start, forced `/pm-desk`) and read the `projects` atom through
  a `state.set` pass-through hook (`tests/team-forge.test.ts`).
