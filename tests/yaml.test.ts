import { expect, test } from 'claude-code/testing'

import { parseFrontmatter, parseYaml } from '../hooks/yaml'

test('the subset of the schema parses: maps, block and flow lists, flow maps, scalars, comments', async () => {
  const doc = parseYaml(`
schema: 1
name: "Customer: portal"   # quoted, with a colon
stage:
  current: 2
  planned_end: 2026-12-15
tolerances:
  time: { limit: 10, used: 3, unit: days }
roles:
  executive: Anna Rossi
  senior_user: [Marco Bianchi, 'Eva Neri']
  team_manager: []
approvals:
  - decision: authorize-initiation
    by: Anna Rossi
    note: ~
tags:
- one
- two
`)

  expect(doc).toEqual({
    schema: 1,
    name: 'Customer: portal',
    stage: { current: 2, planned_end: '2026-12-15' },
    tolerances: { time: { limit: 10, used: 3, unit: 'days' } },
    roles: { executive: 'Anna Rossi', senior_user: ['Marco Bianchi', 'Eva Neri'], team_manager: [] },
    approvals: [{ decision: 'authorize-initiation', by: 'Anna Rossi', note: null }],
    tags: ['one', 'two'],
  })
})

test('a line out of place is an error naming the line', async () => {
  expect(() => parseYaml('a: 1\n    b: 2\n')).toThrow('line 2')
})

test('a product splits into frontmatter and body', async () => {
  const { data, body } = parseFrontmatter('---\ntitle: Project Brief\nversion: 0.1\n---\n# Brief\n')

  expect(data).toEqual({ title: 'Project Brief', version: 0.1 })
  expect(body).toBe('# Brief\n')
})
