# Scope

What p2kit is for, what it is not, and which desk actions act directly.

## Who it is for

p2kit is for **one project manager**, working on their own machine, who runs **one or more
projects**. Each project lives in its own repository, with its forge on GitHub or Forgejo.

Another PM can install it and use it the same way. Each user has their own desk, built from the
repositories they have cloned.

The PM runs the project day to day. Claude drafts the documents and the PM decides. The Project
Board's decisions reach p2kit only when the PM states them.

## Not in scope

- **Multi-user use:** no shared desk, no user accounts, no permissions per role.
- **A server-side database:** nothing is stored outside the project repositories and the
  user's own `~/.claude/p2kit/` and `~/.config/p2kit/` folders.
- **Hosting:** the desk is served only on `127.0.0.1`, never on a network interface.

These are choices for now, not permanent limits. One rule keeps the way to a shared desk open:
**`.pm/` in the project's repository is the only source of truth**. Every write is a plain edit
of a `.pm/` file in the working tree. Nothing is committed: the PM commits `.pm/` with the code,
when they decide. A future shared desk would read and write the same files through git, so its
data would need no migration.

## Desk actions

An action that only changes data acts **directly**, after the PM confirms a preview of the
change. An action that writes new text opens **a session**, because Claude drafts the text and
the PM reads it before it is saved.

| Action | Changes | How |
|---|---|---|
| Archive a work package | `status: completed` → `archived` | button, preview, confirm |
| Mark a work package completed | `status:` → `completed` — a Board decision the PM states | button, explicit confirm |
| Set horizon / rank | `horizon:`, `rank:` of a work package | button, preview, confirm |
| Close / reopen a commit note | `status:` of one note in `commit-notes.yaml` | button, preview, confirm |
| Link an issue, milestone or branch | `issue:`, `milestone:`, `branch:` of a work package | button, preview, confirm |
| Group issues and pull requests into a package | a forge milestone, and a new `WP-<nn>.md` | button, preview of the plan, confirm |
| Assign / unassign a team member | the assignees of an open issue or pull request on the forge | select, preview before / after, confirm |
| Attach an issue or pull request to a work package | the milestone of an open item on the forge: the work package's `milestone:` | select, preview old / new milestone, confirm |
| Digest, Highlight Report, Presentation, Retrospective, issue draft | new text | opens a session with the skill |

A direct action never writes without a preview. The confirmation applies only to the file as
the preview showed it: if the file has changed since, the action is refused and the preview is
shown again.

## Where the actions run

- **Claude Desktop pane.** The mod writes the file itself and asks for confirmation in a dialog.
  Nothing else needs to be installed.
- **Browser page.** A local helper serves the page and its actions on `127.0.0.1`. It is a
  single script, `server/desk_server.py`, using only the Python standard library, and the mod
  starts it. **Python 3 is required** for actions in the browser.
  - The helper accepts an action only when it carries the page's per-session token and comes
    from its own origin. Any website can reach `127.0.0.1`, so these checks are needed.
  - It edits only projects listed in `~/.config/p2kit/projects.yaml`.
  - It changes one line per action, and only to a value from a fixed set.
  - It assigns only the logins of `team.people`, and writes nothing on a project whose
    checkout has no `.pm/`.
  - Forge writes go through the CLI the user has already authenticated (`gh`, `fj`). No new
    token is needed.
  - When `python3` is missing, the browser page stays the read-only file it is today. Its
    buttons then open a session with the skill instead.
