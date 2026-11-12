import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import type { Project, TeamMember } from '../types'

const member = (person: string, login: string, wip: number, wipLimit: number, items: TeamMember['items'] = []): TeamMember =>
  ({ person, login, roles: ['Team manager'], items, wip, wipLimit, isOverLimit: wip > wipLimit })
const project = (path: string, name: string, team: TeamMember[]): Project => ({
  path, name, code: name.toUpperCase(), profile: 'standard', status: 'delivery',
  stage: { current: 1, name: '', start: '', plannedEnd: '' },
  roles: [{ role: 'team_manager', label: 'Team manager', people: team.map(one => one.person) }], team, tolerances: [], light: 'green',
  progress: { done: 0, total: 0 }, highRisks: 0, openIssues: 0, nextReport: { due: '', isOverdue: false }, documents: [],
  workPackages: [], risks: [], issues: [], approvals: [], openBlockers: 0, unthemedNotes: [], errors: [],
})

const ROLES = 'roles:\n  executive: Anna Rossi\n  project_manager: Davide Paci\n  senior_supplier: [Luca Verdi]\n'
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/gh\n  - path: /t/calm\n',
  '/t/gh/.pm/project.yaml': `name: Gh\n${ROLES}team:\n  wip_limit: 1\n  people:\n    Davide Paci: { login: dgpaci }\n    Luca Verdi: { login: lverdi }\n`,
  '/t/calm/.pm/project.yaml': `name: Calm\n${ROLES}`,
}
const user = (login: string) => ({ login })
const ISSUES = [{ number: 1, title: 'Issue 1', html_url: 'https://h/issues/1', updated_at: '2026-11-11T09:00:00Z', assignees: [user('dgpaci')] }]
const PULLS = [
  { number: 2, title: 'Pull 2', html_url: 'https://h/pulls/2', updated_at: '2026-11-11T10:00:00Z', draft: false, user: user('dgpaci'), assignees: [], requested_reviewers: [user('lverdi')] },
]
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the browser page shows the Team tab and a WIP badge for each person over the limit', async () => {
  // wf:contract: renderBoard embeds each project's team; the project form has a "Team" tab right after "Roles", its count the team's length.
  // wf:contract: The Team tab shows one block per person: name, "@<login>" or "no forge login", role labels, "WIP <wip>/<wipLimit>",
  // wf:contract: and their items with the labels "review asked", "in progress", "to do", "waiting for review", "stalled".
  // wf:contract: The overview card head and the recap's "Needs attention" show "WIP <person> <wip>/<wipLimit>" for each person with isOverLimit,
  // wf:contract: and nothing about WIP for a project where nobody is over the limit. The inline script still compiles.
  const busy = project('/p', 'Busy', [
    member('Anna', 'anna', 4, 3, [
      { kind: 'pr', number: 7, title: 'Seven', status: 'review', url: 'https://h/pulls/7', updatedAt: '2026-11-10' },
      { kind: 'issue', number: 8, title: 'Eight', status: 'todo', url: 'https://h/issues/8', updatedAt: '2026-11-09' },
    ]),
    member('Bruno', '', 0, 3),
  ])
  const calm = project('/q', 'Calm', [member('Carla', 'carla', 1, 3)])
  const page = renderBoard({ projects: [busy, calm], refreshedAt: 0, errors: [] })
  const json = page.slice(page.indexOf('<script type="application/json" id="data">') + 42, page.indexOf('</script>'))
  const data = JSON.parse(json)
  expect(data.projects.map((one: Project) => one.team)).toEqual([busy.team, calm.team])
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  // The test sandbox forbids new Function: the tab list, the labels and the WIP lines are read from the script text.
  expect(script).toMatch(/\['roles', 'Roles'[^\n]*\n  \['team', 'Team', p => p\.team\.length, team\]/)
  for (const label of ["'@' + m.login : 'no forge login'", "'WIP ' + m.wip + '/' + m.wipLimit", 'm.roles.join', "review: 'review asked'", "inprogress: 'in progress'", "todo: 'to do'", "waiting: 'waiting for review'", "stalled: 'stalled'"]) {
    expect(script).toContain(label)
  }
  // Card head and "Needs attention" both list only the members over the limit.
  expect(script).toContain("const overLimit = p => p.team.filter(m => m.isOverLimit)")
  expect(script).toContain("const wipText = m => 'WIP ' + m.person + ' ' + m.wip + '/' + m.wipLimit")
  expect(script).toContain('...wipBadges(p))')
  expect(script).toContain("...overLimit(p).map(m => el('div', { className: 'err', textContent: wipText(m) }))")
  expect(page).not.toContain('WIP Carla')
  expect(script).toContain('function draw()')
  expect(script).not.toContain('${')
})

test('the pane shows the Team tab, filters it by member, and flags each person over the WIP limit', async ($, on) => {
  // wf:contract: In the drill-in, pressing the `tab:team` button shows one line per person with "WIP <wip>/<wipLimit>" and their items
  // wf:contract: ("#<n>" or "PR #<n>", title, status label as in the browser page); a person without a login shows "no forge login".
  // wf:contract: One `member:<person>` button per person toggles that person in the shown set; none picked shows everyone;
  // wf:contract: the pick is reset when another project is opened or the pane goes back to the overview.
  // wf:contract: The overview and the recap show "WIP <person> <wip>/<wipLimit>" for each person with isOverLimit.
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'gh') {
      if (e.argv[2] === 'repos/acme/gh/issues?state=open&per_page=100&page=1') return answer(0, JSON.stringify(ISSUES))
      if (e.argv[2] === 'repos/acme/gh/pulls?state=open&per_page=100&page=1') return answer(0, JSON.stringify(PULLS))
      return answer(1)
    }
    if (e.argv.slice(3).join(' ') === 'remote get-url origin') return answer(0, 'git@github.com:acme/gh.git\n')
    return answer(1)
  })

  await $.command.run(RUN)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'WIP Davide Paci 2/1', color: 'red' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^WIP Luca Verdi/ })).toBeFalsy()

  await ui.press({ key: 'open:/t/gh' })
  expect(await ui.find({ type: 'Text', text: 'WIP Davide Paci 2/1', color: 'red' })).toBeTruthy()
  await ui.press({ key: 'tab:team' })
  expect(await ui.find({ type: 'Text', text: /^Davide Paci · @dgpaci · Project Manager · WIP 2\/1$/, color: 'red' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#1 Issue 1 · to do$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /PR #2 Pull 2 · waiting for review$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Luca Verdi · @lverdi · Senior Supplier · WIP 0\/1$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /PR #2 Pull 2 · review asked$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Anna Rossi · no forge login' })).toBeTruthy()

  await ui.press({ key: 'member:Luca Verdi' })
  expect(await ui.find({ type: 'Text', text: /^Luca Verdi · @lverdi/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Davide Paci · @dgpaci/ })).toBeFalsy()
  await ui.press({ key: 'member:Davide Paci' })
  expect(await ui.find({ type: 'Text', text: /^Davide Paci · @dgpaci/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Anna Rossi · no forge login' })).toBeFalsy()
  await ui.press({ key: 'member:Luca Verdi' })
  await ui.press({ key: 'member:Davide Paci' })
  expect(await ui.find({ type: 'Text', text: 'Anna Rossi · no forge login' })).toBeTruthy()

  // The pick does not survive leaving the project.
  await ui.press({ key: 'member:Luca Verdi' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/gh' })
  await ui.press({ key: 'tab:team' })
  expect(await ui.find({ type: 'Text', text: /^Davide Paci · @dgpaci/ })).toBeTruthy()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'open:/t/calm' })
  expect(await ui.find({ type: 'Text', text: /^WIP / })).toBeFalsy()
  await ui.unmount()
})
