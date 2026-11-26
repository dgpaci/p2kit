# p2kit

A Claude Code plugin for project management aligned with PRINCE2®: skills that prepare the
management products of each process, project data kept in the project's own repo under `.pm/`,
and a multi-project "project desk" pane. Claude prepares; the human Project Board decides.

## Maintainer

dgpaci (Davide Paci) — owns the repo and reviews its PRs.

## Target branch for PRs

`main`, merged with **squash** (`gh pr merge <n> --squash`).

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

## Mod notes (learned in the stage-delivery, desk-redesign, team-wip, planning-signals and flow-reporting workflows)

- To watch board changes live, keep the dev desk running in a terminal:
  `~/.claude/p2kit/dev-desk/run.sh <p2kit checkout or worktree> [port, default 8765]`, then open
  `http://127.0.0.1:8765/` (`http://127.0.0.1:8764/refresh` re-reads the forge). It renders the board
  outside any session and serves it through the tree's own `server/desk_server.py`, so drag & drop and
  the actions work, on the real projects and forge; it restarts on a change under `hooks/` or `server/`.
  Its helper runs with `--home ~/.claude/p2kit/dev-desk/home`, so it passes `--timelog-home ~` (when the tree's
  `server/desk_server.py` takes it): without it a clock started on the dev desk runs and stops in that other home,
  invisible to every session and to `/pm-log` (the "lost" clock of 2026-11-26).
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
  them locally (`hooks/project.ts:addRepoState`, `hooks/team.ts:toTeamItems`).
- In `claude plugin test` the test `$` has no `env`/`fs`, so `loadProjects` cannot be called
  directly: drive the plugin (session start, forced `/pm-desk`) and read the `projects` atom through
  a `state.set` pass-through hook (`tests/team-forge.test.ts`).
- A `claude://code/new?q=…` link can never run a slash command: Claude Desktop turns the leading `/`
  of the linked prompt into `／`. A link that needs a skill names it in plain text
  (`[p2kit] Use the p2kit:pm-package skill with: …`, `hooks/actions.ts:getPackageLink`).
- A session opened from Desktop (a deep link, a new chat) loads only the plugins in
  `CLAUDE_CODE_PLUGIN_DIRS` (`~/.claude/settings.json` → `env`): to try a skill that exists only in a
  worktree, add the worktree's path there, and put the repo's path back after the merge.
- The browser page reloads itself every 60 s (`RELOAD_MS`), dropping any page-local state. State the
  user builds over time (the Activity selection) holds the reload while it is set
  (`if (!pickedItems.size) location.reload()`); a plain filter may reset.
- Forgejo's `pulls/<n>/reviews` lists every requested reviewer as a review with `state: REQUEST_REVIEW`
  and a date: a "first review" must skip it as well as `PENDING` (`hooks/flow.ts:getFirstReviewAt`).
- `tests/team-forge.test.ts` and `tests/milestones-forge.test.ts` assert the exact set and count of forge
  requests, so any new forge read turns them red: filter the new read out of their mocks and pin it in
  a test of its own — and say in the plan that those mocks may change, or the phase records it as a deviation.
- The test clock of `mock.clock` starts at 0: a guard such as "never read yet" on `refreshedAt === 0`
  also fires in tests, so pair it with another signal (no project held) or `await clock.set(...)` first.
- The `.pm/` YAML subset (`hooks/yaml.ts`) has no `''` escape: `'it''s'` reads as `it''s`, and inside
  a flow map `{ … }` it breaks the entry. A skill writing a text that may hold `'` puts it in double
  quotes (`skills/pm-retro/SKILL.md` step 5).
- The desk tests pin the shape of `hooks/board.ts` `TABS` entries with regexes: the `wps` entry stays exactly two lines
  (`tests/iterations-desk.test.tsx`) and `lessons` stays one line (`tests/lessons-desk.test.tsx`). A new column goes inside the
  two `wps` lines; a new tab goes after an existing line, never between `wps` and `iterations` or `iterations` and `lessons`.
- `ui.find` matches only `type`, `key`, `text` and `in`: a `color` key in the query is silently ignored. Assert a colour on the
  found element, `expect((await ui.find({ type: 'Text', text: … }))?.props.color).toBe('red')` (`tests/daily-log-filters-desk.test.tsx`).
- `claude plugin test` does not typecheck: the hand-built `Project` fixtures of `tests/board.test.ts` and `tests/team-desk.test.tsx`
  keep passing when `Project` gains a field, so board and pane code must tolerate the field missing (`p.effort ? … : null`).
- A hooks module and its tests import only code files (`.ts`, `.mjs`, …), never `.json`: data shared with the Python helper is
  `server/edit-cases.mjs`, one JSON array behind `export default`, which `server/test_desk_server.py` reads by splitting it off.
- The browser actions go through `server/desk_server.py` (stdlib only, its tests `python3 -m unittest discover -s server`); keep its
  rules and messages equal to `hooks/edits.ts`, the pane's copy, and add a shared case for any change.
- The browser page tidies its `tableOf` tables after each draw (`hooks/board.ts:tidyTables`): short columns stay on one line and
  tables sharing a header line up. Code that redraws part of the page outside `draw()` calls `tidyTables` on what it filled once it
  is in the document (the Daily Log filters do). Tables built by hand (Activity, Team) line up through `table.rows` and fixed widths.
