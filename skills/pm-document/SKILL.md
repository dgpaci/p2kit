---
name: pm-document
description: Draft a document of a p2kit project — a management report no other skill writes (Exception, Checkpoint, End Stage, End Project, Lessons Report), saved under .pm/reports/, or a free project document (specification, manual, note) saved in a folder of the documents key of .pm/project.yaml — from the type, folder and notes the user gives; shown as a draft and saved only after the user's explicit OK. Use when the user asks for a new document, an exception report, a checkpoint report, an end stage report, an end project report, a lessons report, a spec, a manual or a note for the project, presses New document on the desk, or asks for /pm-document.
---

# New document

The skill drafts one document, of the type the user names, from the project's data and the
user's notes. A document another skill writes is left to it. This skill writes only the new file,
after the user's OK; it never records a Board decision, never writes to the forge and commits
nothing.

1. Get from the user — the argument, or a desk dialog's prompt, or questions — the **type**, the
   **folder** for a free document, and the **notes**: what it must say, for whom, the sources to
   read. Ask for what is missing; never guess a type.
2. **A product another skill writes** → name that skill in one line and stop:

   | The user asks for | Skill |
   |---|---|
   | Project Brief | `/pm-start-up` |
   | Project Initiation Documentation, first stage plan | `/pm-initiate` |
   | Highlight Report, periodic report to the Board | `/pm-report` |
   | Issue Report, report of a problem or a request for change | `/pm-problem` |
   | weekly digest | `/pm-digest` |
   | retrospective, an entry of the Lessons Log | `/pm-retro` |
   | presentation or release notes of a work package | `/pm-present` |
   | work package | `/pm-package` |
   | roadmap | `/pm-roadmap` |

3. **A management report** this skill drafts, saved as `.pm/reports/<today>-<kind>.md`, read from
   the desk's snapshot (`~/.claude/p2kit/desk.json`, project found by step 1 of
   skills/pm-digest/SKILL.md) and `.pm/`, with the period and data rules of step 3 of
   skills/pm-report/SKILL.md where they apply:

   | Type | `<kind>` | Headings |
   |---|---|---|
   | Exception Report | `exception` | Summary, The tolerance at stake, Cause, Consequences, Options, Recommendation |
   | Checkpoint Report | `checkpoint` | Work package and period, Done, Planned next, Problems and risks, Tolerances of the work package |
   | End Stage Report | `end-stage` | Summary, Stage against its plan, Tolerances, Objectives, Work packages and products, Risks and problems, Lessons, Outlook for the next stage |
   | End Project Report | `end-project` | Summary, Objectives of the brief, Performance against the baseline, Products, Benefits still to come, Follow-on actions, Lessons |
   | Lessons Report | `lessons` | Summary, What worked, What did not, Recommendations, Sources |

   The sources per type: the tolerance's limit and forecast and the open problems of
   `.pm/registers/issues.yaml` (Exception); one work package, its forge items and commit notes
   (Checkpoint); the stage's work packages, objectives, risks, problems and the Lessons Log
   `.pm/registers/lessons.yaml` (End Stage, End Project, Lessons). Options and a recommendation
   that ask the Board for a decision end with `Decision: pending the Project Board.`; an
   authorization the Board grants later is recorded by its own skill, never here.
4. **A free document** — a specification, a manual, a note, any type not in steps 2–3. The folder
   is one of the `documents:` folders of `.pm/project.yaml`, or a subfolder of one up to three
   levels down, so the desk lists it. None configured, or the user names another folder → say the
   desk will not list it there and ask whether to add the folder to `documents:` (one key of
   `.pm/project.yaml`, its own OK) or save it anyway. The file is `<folder>/<slug>.md`, `<slug>`
   the title in lower case with hyphens; an existing file of that name is never overwritten
   without saying so. It starts with a `# <title>` heading (the desk titles a shared document by
   it); its headings follow the type and the user's notes.
5. Draft the document in the language of the project's issues, in plain sentences. Every statement
   comes from the project's data, the sources named in the notes or what the user says; a source
   that cannot be read is named under the draft, a figure no source gives is asked, and a section
   with nothing to say says so in one line.
6. Show the draft with the path it will take and ask for an explicit OK. Without it, write
   nothing; apply the corrections and show the draft again.
7. On the OK, save the file. A report of step 3 carries the products frontmatter:

   ```markdown
   ---
   title: End Stage Report — stage 2 Build
   product: report
   version: 0.1
   status: draft
   updated: <today>
   ---
   ```

   A title holding a `'` goes in double quotes (docs/pm-schema.md → *YAML subset*).
8. Tell the user in one line where the document is and that the desk lists it under Documents at
   its next refresh. Nothing is committed: `.pm/` and the documents folders are committed with the
   code, when the user decides.
