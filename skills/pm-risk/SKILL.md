---
name: pm-risk
description: Keep the Risk Register of a p2kit project — add a risk, record how it is handled (the response actions next to the response type), assess whether those actions are adequate against its cause, probability and impact with a one-line verdict, and close it only when the user confirms the closure — in .pm/registers/risks.yaml, each change written only after the user's explicit OK. Use when the user asks to add or update a risk, record or assess a risk response, review the open risks, close a risk, or asks for /pm-risk.
---

# Risk Register

A risk carries a response type (`response`: reduce, accept, …) and how it is actually handled
(`response_actions`); Claude assesses those actions and records a verdict, `adequate` or
`not-adequate`, with one line of reasoning (docs/pm-schema.md → *`registers/risks.yaml`*). The desk
keeps every open risk in Needs attention, red until its response is judged adequate, then waiting
for the closure. This skill writes only `.pm/registers/risks.yaml`, after the user's OK for each
change; it never closes a risk on its own, never touches the forge and commits nothing.

1. Read `.pm/project.yaml` (`code`, the people of `roles`) and `.pm/registers/risks.yaml` (create
   it with `risks: []` when missing, on the first OK). With no request more precise, list the open
   risks — id, score, title, response type, response actions and verdict — the ones without an
   adequate verdict first, and ask which to work on.
2. **Add a risk**: title, `category` (threat | opportunity), `probability` and `impact` (low |
   medium | high), `owner` (as written in `roles` when it is one of them), `status: open`, the next
   `R-<nnn>` after the highest id in the file. Ask for what the user did not say; never guess a
   probability, an impact or an owner. When the user already says how it is handled, go on to
   step 3 for it.
3. **Record the response** of a risk: the `response` type (avoid | reduce | fallback | transfer |
   accept | share | exploit | enhance) and `response_actions`, the concrete actions taken or
   planned, on one line, faithful to what the user said — e.g. *advance circular to the branches,
   updated inline manuals, upcoming videos, classic-mode conventions still available*. A change
   of `response_actions` clears `verdict` and `verdict_reason`: the new actions are assessed again
   in step 4.
4. **Assess the response** — always right after step 3, or on request for a risk that has actions
   but no verdict. Weigh the actions against the risk:
   - the **cause**: does some action remove or weaken it?
   - the **probability**: does it fall, and to what level?
   - the **impact**: is it contained, or is there a fallback when the risk occurs?
   - for `accept`: is the residual exposure tolerable for its score, and is someone watching it?

   Verdict `adequate` when the actions plausibly bring the risk within what the project can bear;
   `not-adequate` otherwise, naming what is missing. `verdict_reason` is one line, never a
   paragraph. Say the verdict and the reasoning in the reply, honestly: a weak response is
   `not-adequate` even when the user wrote it.
5. **Close a risk** only when the user states the closure in chat ("close R-007", "yes, close it").
   An `adequate` verdict is a reason to *propose* the closure, never to write it: say "R-007's
   response is adequate: close it?" and wait. A risk that has occurred is not closed here: propose
   moving it to the Issue Register as `/pm-log` step 7 does.
6. Show the exact entry or entries as they will be written, within the YAML subset of
   docs/pm-schema.md — `response_actions` and `verdict_reason` in double quotes (they often hold a
   `,`, and the subset has no escapes for a `'` in single quotes):

   ```yaml
     - id: R-007
       title: Branch staff keep using the old procedure
       category: threat
       probability: medium
       impact: high
       owner: Marco Bianchi
       status: open
       response: reduce
       response_actions: "advance circular to the branches, updated inline manuals, upcoming videos, classic-mode conventions still available"
       verdict: adequate
       verdict_reason: "cuts the cause with notice and manuals and keeps the old conventions as a fallback; the videos are not out yet"
   ```

   Ask for an explicit OK. Without it, write nothing; apply the corrections and show them again.
   The verdict is part of what the user approves: when the user disagrees with it, write the
   user's correction and say so, or leave the verdict empty — never write one the user rejected.
7. On the OK, write `.pm/registers/risks.yaml`: append a new risk at the end; for an existing one,
   change only its keys named in the draft, leaving every other risk and line as it is. A risk
   written as a flow map `{ … }` may be rewritten as a block entry when it gains these keys.
8. Tell the user in a few lines what was written (risk ids, response recorded, verdict, closed),
   that the desk shows it at its next refresh — red in Needs attention until the response is
   judged adequate, then waiting for the closure — and, for each risk judged adequate and still
   open, ask whether to close it. Nothing is committed: `.pm/` is committed with the code, when
   the user decides.
