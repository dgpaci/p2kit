---
name: pm-start-up
description: Start a p2kit project in the current repo — turn a project mandate into a Project Brief (.pm/brief.md) and create .pm/project.yaml. Use when the user wants to start, set up or kick off a managed project, has a mandate or idea to turn into a brief, or asks for /pm-start-up.
---

# Starting up a project

Turn the mandate into the two files that let the Executive decide whether to initiate the project:
`.pm/project.yaml` and `.pm/brief.md`. You prepare; the Executive decides. The schema is
`docs/pm-schema.md` at the plugin root (two levels up from this skill's folder) — read it before
writing, and keep the YAML inside its subset.

## Steps

1. **Check the ground.** Work at the repo root (`git rev-parse --show-toplevel`). If `.pm/project.yaml`
   already exists, stop and say so: this is not a start-up any more (suggest `/pm-initiate`).
2. **Get the mandate.** Whatever the user gave — a paragraph, an email, a ticket, a file. If there
   is none, ask for it in one question. Do not invent what the mandate does not say.
3. **Ask only what is missing**, in one round, at most these:
   - who is the **Executive** (the one person accountable, who decides), and the Senior User(s) and
     Senior Supplier(s) if known;
   - who is the **Project Manager** (default: the user);
   - the **tailoring profile**: `light` (default) or `full`;
   - time and cost **tolerances** for the project, if the mandate has a budget or a deadline.
   Anything still unknown goes in the brief as an open point, not as a guess.
   If the user says the project has **no fixed end** ("ongoing", "continuous delivery"), say that
   `/pm-initiate` will offer a continuous delivery stage, and note it in the brief's approach. Never
   infer it from the mandate.
4. **Write `.pm/project.yaml`** from `templates/project.yaml` in this skill's folder: `status: start-up`,
   `stage.current: 0`, `stage.name: Start-up`, `stage.start` today. Leave `approvals: []`.
5. **Write `.pm/brief.md`** from `templates/brief.md`: fill every section from the mandate in short,
   plain sentences; mark assumptions as assumptions; list open points. `status: draft`,
   `version: 0.1`. In the `light` profile the outline business case stays inside the brief.
6. **Create `.pm/registers/risks.yaml` and `.pm/registers/issues.yaml`** with the risks and issues
   the mandate already reveals (often a few risks, no issues): `risks: []` / `issues: []` when none.
7. **Show the user a summary**: the brief's objective, scope, top risks, open points, and the
   decision now due — *authorize initiation*. Ask whether to register the project in the desk
   (`/pm-register`) if it is not there yet.

## The Board decides

Never write an approval on your own. Only when the user states the Executive's decision in chat
("Anna approved the brief, go ahead"), append to `approvals`:

```yaml
  - decision: authorize-initiation
    by: <Executive's name>
    date: <today>
    note: <what was said, in a few words>
```

and set `status: initiation`, `stage.current: 1`, `stage.name: Initiation`, `stage.start: <today>`,
and the brief's `status: approved`. Then suggest `/pm-initiate`.

Do not commit unless the user asks; when they do, one commit `docs(pm): project brief` for the
`.pm/` files.
