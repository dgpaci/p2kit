import { expect, test } from 'claude-code/testing'

import { buildProject, getLight, parseRegistry } from '../hooks/project'

const PROJECT = `
name: Portal
code: PORTAL
status: delivery
stage: { current: 2, name: Build, start: 2026-10-01 }
tolerances:
  time: { limit: 10, used: 8, unit: days }
  cost: { limit: 5000, used: 1000, unit: EUR }
reporting:
  highlight_every_days: 14
  last_highlight: 2026-10-15
roles:
  executive: Anna
  senior_user: [Marco]
`

const wp = (id: string, stage: number, status: string) => ({
  path: `/p/.pm/work-packages/${id}.md`,
  text: `---\nid: ${id}\ntitle: ${id} title\nstage: ${stage}\nstatus: ${status}\n---\n`,
})

test('the overview figures come from the .pm files', async () => {
  const project = buildProject(
    {
      path: '/p',
      project: PROJECT,
      products: [{ path: '/p/.pm/brief.md', text: '---\ntitle: Project Brief\nstatus: approved\nversion: 1.0\n---\n' }],
      workPackages: [wp('WP-01', 2, 'completed'), wp('WP-02', 2, 'in-progress'), wp('WP-03', 2, 'cancelled'), wp('WP-04', 3, 'draft')],
      risks: `risks:
  - { id: R-1, probability: high, impact: medium, status: open }
  - { id: R-2, probability: low, impact: high, status: open }
  - { id: R-3, probability: high, impact: high, status: closed }
`,
      issues: 'issues:\n  - { id: I-1, status: open }\n  - { id: I-2, status: closed }\n',
    },
    '2026-11-03',
  )

  expect(project.light).toBe('amber')
  expect(project.progress).toEqual({ done: 1, total: 2 })
  expect(project.highRisks).toBe(1)
  expect(project.openIssues).toBe(1)
  expect(project.nextReport).toEqual({ due: '2026-10-29', isOverdue: true })
  expect(project.roles.map(role => `${role.label}: ${role.people.join(', ')}`)).toEqual(['Executive: Anna', 'Senior User: Marco'])
  expect(project.documents[0]).toEqual({ path: '/p/.pm/brief.md', title: 'Project Brief', product: '', status: 'approved', version: '1.0' })
  expect(project.errors).toEqual([])
})

test('a project without .pm is listed with the error', async () => {
  const project = buildProject({ path: '/src/empty', products: [], workPackages: [] }, '2026-11-03')

  expect(project.name).toBe('empty')
  expect(project.errors).toEqual(['.pm/project.yaml not found'])
})

test('the traffic light: green under 75 %, amber under 100 %, red at the limit; a zero limit is red on any use', async () => {
  expect([getLight(10, 7), getLight(10, 7.5), getLight(10, 10), getLight(0, 0), getLight(0, 1)]).toEqual(['green', 'amber', 'red', 'green', 'red'])
})

test('the registry expands ~ and keeps the order', async () => {
  expect(parseRegistry('projects:\n  - path: ~/a\n  - path: /b\n', '/h')).toEqual(['/h/a', '/b'])
})
