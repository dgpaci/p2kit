import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { DEFAULT_HEADINGS, getMissingHeadings, readReadiness } from '../hooks/readiness'
import { parseYaml } from '../hooks/yaml'

test('the default readiness headings are Why / What changes / Done when', () => {
  // wf:contract: DEFAULT_HEADINGS is ['Why', 'What changes', 'Done when'] — the same format /pm-issue writes (#11).
  expect(DEFAULT_HEADINGS).toEqual(['Why', 'What changes', 'Done when'])
})

test('a heading counts when an ATX heading line carries it, whatever its level, case, trailing colon or closing hashes', () => {
  // wf:contract: getMissingHeadings(body, headings) gives the headings, in their configured order, that no line `#`…`######` + space + text carries;
  // wf:contract: the text is trimmed, trailing `#`s and a trailing `:` removed, and compared case-insensitively. Empty or null body → all missing.
  const body = ['Intro', '## Why', 'because', '#### what CHANGES: ##', '- a', 'Done when', '- [ ] b'].join('\n')
  expect(getMissingHeadings(body, DEFAULT_HEADINGS)).toEqual(['Done when'])
  expect(getMissingHeadings('# Why\n###### Done when\n## What changes', DEFAULT_HEADINGS)).toEqual([])
  expect(getMissingHeadings('**Why**\n##Why\n####### Why', DEFAULT_HEADINGS)).toEqual(['Why', 'What changes', 'Done when'])
  expect(getMissingHeadings('', DEFAULT_HEADINGS)).toEqual(DEFAULT_HEADINGS)
  expect(getMissingHeadings(null, ['Context'])).toEqual(['Context'])
})

test('readiness.headings in project.yaml replaces the default; a malformed one is an error and the default applies', () => {
  // wf:contract: readReadiness(value, errors) reads the `readiness` section of project.yaml: `headings` a non-empty list of scalars;
  // wf:contract: absent → DEFAULT_HEADINGS, no error; anything else → the error `readiness.headings: expected a list of headings` and DEFAULT_HEADINGS.
  const errors: string[] = []
  const doc = parseYaml('readiness:\n  headings: [Context, Proposal, Acceptance criteria]\n') as { readiness: unknown }
  expect(readReadiness(doc.readiness as never, errors)).toEqual(['Context', 'Proposal', 'Acceptance criteria'])
  expect(readReadiness(undefined, errors)).toEqual(DEFAULT_HEADINGS)
  expect(errors).toEqual([])
  const bad = parseYaml('readiness:\n  headings: Why\n') as { readiness: unknown }
  expect(readReadiness(bad.readiness as never, errors)).toEqual(DEFAULT_HEADINGS)
  expect(readReadiness('yes' as never, errors)).toEqual(DEFAULT_HEADINGS)
  expect(errors).toEqual(['readiness.headings: expected a list of headings', 'readiness.headings: expected a list of headings'])
})

test('a project carries the headings in force and starts with nothing not ready', () => {
  // wf:contract: buildProject gives `readiness` (the headings in force) and `notReady` 0; loadProjects sets notReady from the forge issues.
  const plain = buildProject({ path: '/p', project: 'name: P\n', products: [], workPackages: [] }, '2026-11-13')
  expect(plain.readiness).toEqual(DEFAULT_HEADINGS)
  expect(plain.notReady).toBe(0)
  const custom = buildProject({ path: '/p', project: 'name: P\nreadiness:\n  headings: [Context]\n', products: [], workPackages: [] }, '2026-11-13')
  expect(custom.readiness).toEqual(['Context'])
  expect(custom.errors).toEqual([])
})
