import { expect, test } from 'claude-code/testing'

import { buildProject } from '../hooks/project'
import { DEFAULT_WIP_LIMIT, readTeam, toTeamItems, withItems } from '../hooks/team'
import { parseYaml } from '../hooks/yaml'
import type { RoleLine, TeamItem, TeamMember } from '../types'

const ROLES: RoleLine[] = [
  { role: 'executive', label: 'Executive', people: ['Anna Rossi'] },
  { role: 'project_manager', label: 'Project Manager', people: ['Davide Paci'] },
  { role: 'senior_supplier', label: 'Senior Supplier', people: ['Davide Paci', 'Luca Verdi'] },
  { role: 'team_manager', label: 'Team Manager', people: [] },
]

const TEAM = `
wip_limit: 4
people:
  Davide Paci: { login: dgpaci, wip_limit: 5 }
  Luca Verdi: { login: lverdi }
`

test('the team is the people of the roles, once each, in role order, with their logins and WIP limits', async () => {
  const errors: string[] = []
  const team = readTeam(ROLES, parseYaml(TEAM), errors)
  expect(errors).toEqual([])
  expect(team).toEqual([
    { person: 'Anna Rossi', login: '', roles: ['Executive'], items: [], wip: 0, wipLimit: 4, isOverLimit: false },
    { person: 'Davide Paci', login: 'dgpaci', roles: ['Project Manager', 'Senior Supplier'], items: [], wip: 0, wipLimit: 5, isOverLimit: false },
    { person: 'Luca Verdi', login: 'lverdi', roles: ['Senior Supplier'], items: [], wip: 0, wipLimit: 4, isOverLimit: false },
  ])
})

test('without a team section nobody has a login and the WIP limit is the default', async () => {
  const team = readTeam(ROLES, undefined, [])
  expect(DEFAULT_WIP_LIMIT).toBe(3)
  expect(team.map(member => [member.person, member.login, member.wipLimit])).toEqual([
    ['Anna Rossi', '', 3],
    ['Davide Paci', '', 3],
    ['Luca Verdi', '', 3],
  ])
})

test('a team.people entry naming nobody in the roles is reported, not added', async () => {
  const errors: string[] = []
  const team = readTeam(ROLES, parseYaml('people:\n  Mario Bianchi: { login: mbianchi }\n'), errors)
  expect(team.map(member => member.person)).toEqual(['Anna Rossi', 'Davide Paci', 'Luca Verdi'])
  expect(errors).toEqual(['team.people: Mario Bianchi is in no role'])
})

const NOW = Date.parse('2026-11-12T12:00:00Z')
const login = (name: string) => ({ login: name })
const issue = (number: number, assignees: string[], extra: Record<string, unknown> = {}) => ({
  number, title: `Issue ${number}`, html_url: `https://h/issues/${number}`, updated_at: '2026-11-11T09:00:00Z', assignees: assignees.map(login), ...extra,
})
const pull = (number: number, author: string, updated: string, extra: Record<string, unknown> = {}) => ({
  number, title: `Pull ${number}`, html_url: `https://h/pulls/${number}`, updated_at: updated, draft: false,
  user: login(author), assignees: [], requested_reviewers: [], ...extra,
})

test('the items of a person carry the status from their point of view, most urgent first', async () => {
  const issues = [
    issue(10, ['dgpaci']),
    issue(11, ['lverdi']),
    issue(12, ['dgpaci'], { pull_request: {} }), // GitHub lists pull requests among issues: skipped here, read from the pulls
  ]
  const pulls = [
    pull(20, 'dgpaci', '2026-11-09T10:00:00Z', { draft: true, requested_reviewers: [login('lverdi')] }),
    pull(21, 'dgpaci', '2026-11-10T10:00:00Z', { requested_reviewers: [login('lverdi')] }),
    pull(22, 'dgpaci', '2026-11-01T10:00:00Z', { requested_reviewers: [login('lverdi')] }),
    pull(23, 'lverdi', '2026-11-12T08:00:00Z', { assignees: [login('dgpaci')] }),
    pull(24, 'lverdi', '2026-11-11T10:00:00Z', { requested_reviewers: [login('dgpaci')] }),
    pull(25, 'lverdi', '2026-11-11T10:00:00Z'),
  ]
  const items = toTeamItems('dgpaci', issues, pulls, NOW)
  expect(items.map(item => [item.kind, item.number, item.status])).toEqual([
    ['pr', 24, 'review'],
    ['pr', 23, 'inprogress'],
    ['pr', 20, 'inprogress'],
    ['issue', 10, 'todo'],
    ['pr', 21, 'waiting'],
    ['pr', 22, 'stalled'],
  ])
  expect(items[0]).toEqual({ kind: 'pr', number: 24, title: 'Pull 24', status: 'review', url: 'https://h/pulls/24', updatedAt: '2026-11-11' })
})

test('the WIP counts every item of the person but the reviews asked of them, and is over the limit only above it', async () => {
  const member: TeamMember = { person: 'Davide Paci', login: 'dgpaci', roles: ['Project Manager'], items: [], wip: 0, wipLimit: 3, isOverLimit: false }
  const item = (number: number, status: TeamItem['status']): TeamItem => ({ kind: 'pr', number, title: `Pull ${number}`, status, url: '', updatedAt: '2026-11-11' })
  const atLimit = withItems(member, [item(1, 'inprogress'), item(2, 'waiting'), item(3, 'todo'), item(4, 'review')])
  expect([atLimit.wip, atLimit.isOverLimit, atLimit.items.length]).toEqual([3, false, 4])
  const over = withItems(member, [item(1, 'inprogress'), item(2, 'waiting'), item(3, 'todo'), item(5, 'stalled')])
  expect([over.wip, over.isOverLimit]).toEqual([4, true])
})

test('the project carries its team, with no item before the forge is read', async () => {
  const project = buildProject(
    {
      path: '/p',
      project: 'name: Portal\nroles:\n  executive: Anna Rossi\n  project_manager: Davide Paci\nteam:\n  people:\n    Davide Paci: { login: dgpaci }\n',
      products: [],
      workPackages: [],
    },
    '2026-11-12',
  )
  expect(project.errors).toEqual([])
  // The per-person status Macro 5 reads: { person, items: { number, title, status }[], wip }.
  expect(project.team.map(member => ({ person: member.person, login: member.login, items: member.items, wip: member.wip }))).toEqual([
    { person: 'Anna Rossi', login: '', items: [], wip: 0 },
    { person: 'Davide Paci', login: 'dgpaci', items: [], wip: 0 },
  ])
})

test('a Forgejo issue, which carries pull_request: null, is an item of the person it is assigned to', async () => {
  const items = toTeamItems('dgpaci', [issue(30, ['dgpaci'], { pull_request: null })], [], NOW)
  expect(items.map(item => [item.kind, item.number, item.status])).toEqual([['issue', 30, 'todo']])
})
