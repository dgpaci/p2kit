import { expect, test } from 'claude-code/testing'

import { buildProject, getLight, getTreeEntries, parseRegistry, parseRegistryEntries } from '../hooks/project'

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
  - { id: R-4, probability: high, impact: high, status: open, response_actions: fallback ready, verdict: adequate }
  - { id: R-5, probability: high, impact: high, status: open, response_actions: fallback ready, verdict: not-adequate }
`,
      issues: 'issues:\n  - { id: I-1, status: open }\n  - { id: I-2, status: closed }\n',
    },
    '2026-11-03',
  )

  expect(project.light).toBe('amber')
  expect(project.progress).toEqual({ done: 1, total: 2 })
  expect(project.highRisks).toBe(2)
  expect(project.openIssues).toBe(1)
  expect(project.nextReport).toEqual({ due: '2026-10-29', isOverdue: true })
  expect(project.roles.map(role => `${role.label}: ${role.people.join(', ')}`)).toEqual(['Executive: Anna', 'Senior User: Marco'])
  expect(project.documents[0]).toEqual({ path: '/p/.pm/brief.md', title: 'Project Brief', product: '', status: 'approved', version: '1.0', folder: '' })
  expect(project.errors).toEqual([])
})

test('a Problems register entry with its report and decision (/pm-problem) reads as before', async () => {
  const issues = `issues:
  - id: I-004
    title: Payment provider moves the sandbox go-live
    type: problem
    priority: high
    status: open
    raised: 2026-11-20
    report: reports/2026-11-21-problem-I-004.md
    decision: "option 2, go-live moved a week, budget unchanged"
`
  const project = buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [], issues }, '2026-11-27')

  expect(project.issues).toEqual([{ id: 'I-004', title: 'Payment provider moves the sandbox go-live', type: 'problem', priority: 'high', status: 'open' }])
  expect(project.openIssues).toBe(1)
  expect(project.errors).toEqual([])
})

test('a project without .pm is listed with the error', async () => {
  const project = buildProject({ path: '/src/empty', products: [], workPackages: [] }, '2026-11-03')

  expect(project.name).toBe('empty')
  expect(project.errors).toEqual(['.pm/project.yaml not found — in the working tree, nor on pm_branch or origin/HEAD (docs/pm-schema.md → The project registry)'])
})

test('the traffic light: green under 75 %, amber under 100 %, red at the limit; a zero limit is red on any use', async () => {
  expect([getLight(10, 7), getLight(10, 7.5), getLight(10, 10), getLight(0, 0), getLight(0, 1)]).toEqual(['green', 'amber', 'red', 'green', 'red'])
})

test('the registry expands ~ and keeps the order', async () => {
  expect(parseRegistry('projects:\n  - path: ~/a\n  - path: /b\n', '/h')).toEqual(['/h/a', '/b'])
})

test('a registry entry may name the branch to read .pm/ from', async () => {
  expect(parseRegistryEntries('projects:\n  - path: ~/a\n    pm_branch: develop\n  - path: /b\n', '/h'))
    .toEqual([{ path: '/h/a', pmBranch: 'develop' }, { path: '/b', pmBranch: '' }])
})

test('a git tree lists the direct children of a folder, each subfolder once', async () => {
  const files = ['.pm/project.yaml', '.pm/brief.md', '.pm/stages/2/plan.md', '.pm/stages/3/plan.md', '.pm/work-packages/WP-01.md', '.pmx/a.md']
  expect(getTreeEntries(files, '.pm')).toEqual([
    { name: 'project.yaml', kind: 'file' }, { name: 'brief.md', kind: 'file' }, { name: 'stages', kind: 'dir' }, { name: 'work-packages', kind: 'dir' },
  ])
  expect(getTreeEntries(files, '.pm/stages/')).toEqual([{ name: '2', kind: 'dir' }, { name: '3', kind: 'dir' }])
  expect(getTreeEntries(files, '.pm/reports')).toEqual([])
})

test('a project read from a git ref carries the ref; from the working tree, none', async () => {
  expect(buildProject({ path: '/p', pmRef: 'origin/develop', project: PROJECT, products: [], workPackages: [] }, '2026-11-18').pmRef).toBe('origin/develop')
  expect(buildProject({ path: '/p', project: PROJECT, products: [], workPackages: [] }, '2026-11-18').pmRef).toBe('')
})
