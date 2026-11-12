# p2kit

Project management for Claude Code, **aligned with PRINCE2®** — not affiliated with or endorsed
by PeopleCert or AXELOS. PRINCE2® is a registered trademark of PeopleCert. All templates here are
written from scratch.

- **Skills, one per process.** Claude drafts the management products (Project Brief, PID, plans,
  reports) from what you tell it; the Project Board — you — decides.
- **Data in your repo.** Everything lives in `.pm/` in the project's own repository, versioned with
  git: `project.yaml`, Markdown products with frontmatter, YAML registers. Stage baselines are git
  tags `pm/stage-<n>-approved`. Schema: [docs/pm-schema.md](docs/pm-schema.md).
- **Project desk.** A side pane in the Claude Desktop Code tab with every registered project as a
  card — stage, progress, open high risks, next report due — with its work themes beneath. A
  project opens on a form: a header, a bar of its work themes and the tabs Recap, Roles,
  Documents, Work packages, Risks, Issues and Approvals; picking a theme shows its phases, issue
  and pull requests, commits with notes. The same desk is a local browser page.
- **Work themes.** The work packages of a stage run in parallel; one linked with `/pm-link` to an
  issue, a milestone or a branch shows the phases of the phased-workflow plan found on its branch
  and its commits, read with local git, with internal notes on them kept in
  `.pm/registers/commit-notes.yaml`, and the forge state of its issue or milestone and pull
  requests (GitHub or Forgejo, read-only), flagged `ready to close` when they are all merged.
- **Light by default.** The `light` tailoring profile keeps only what a small project needs;
  `full` adds the rest.

Status: phase 1 skeleton, under development.

## Skills

| Skill | Does |
|---|---|
| `/pm-start-up` | turns a project mandate into a Project Brief and creates `.pm/project.yaml` |
| `/pm-initiate` | drafts the Project Initiation Documentation (light profile) and the first stage |
| `/pm-link` | links a work package to a forge issue, a milestone or a branch (`.pm/work-packages/`) |
| `/pm-note` | adds or closes an internal note on a commit of a work package's branch (`.pm/registers/commit-notes.yaml`) |
| `/pm-register` | adds the current repo to the project desk (`~/.config/p2kit/projects.yaml`) |

`/pm-desk` opens the pane.

## Install (development)

The repository root is the plugin. Load it in every session by naming it in the `env` block of
`~/.claude/settings.json`: `"CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>"` (several paths are
separated by `:`), or for one session `claude --plugin-dir <path>`.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## License

MIT
