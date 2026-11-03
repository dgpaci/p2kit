---
name: pm-register
description: Add the current repo's p2kit project to the project desk by listing it in ~/.config/p2kit/projects.yaml. Use when the user asks to register a project, add it to the desk, or asks for /pm-register; also to remove one ("unregister").
---

# Registering a project in the desk

The project desk lists the projects named in `~/.config/p2kit/projects.yaml`. This skill adds
the current one.

1. Find the repo root: `git rev-parse --show-toplevel` (outside a git repo, the working directory).
   If the user named another folder, use that instead.
2. Check that `<root>/.pm/project.yaml` exists. If not, stop and say so: suggest `/pm-start-up`.
3. Read `~/.config/p2kit/projects.yaml`; when missing, create it as:

   ```yaml
   # p2kit project registry — read by the project desk
   projects: []
   ```

4. If an entry with the same absolute `path` is there already, say so and change nothing.
   Otherwise append, keeping the file's style (block list, two-space indent):

   ```yaml
   projects:
     - path: <absolute repo root>
       added: <YYYY-MM-DD>
   ```

   Replace `projects: []` with the block form on the first entry. Write absolute paths, never `~`
   or relative ones.
5. Tell the user in one line, with the project's `name` from `project.yaml`, and that `/pm-desk`
   opens the pane (it refreshes by itself within a minute).

**Unregistering**: on request, remove the entry with that `path` and nothing else; the project's
`.pm/` folder is never touched.
