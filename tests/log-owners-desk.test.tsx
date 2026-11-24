import { expect, mock, test } from 'claude-code/testing'

import { renderBoard } from '../hooks/board'
import { buildProject } from '../hooks/project'
import { getPersonName } from '../hooks/team'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const PROJECT = `name: Portal
stage: { current: 2, name: Build, start: 2026-10-01 }
roles:
  executive: Anna Rossi
  senior_user: [Finizio (Secretary), Roberta]
  project_manager: Davide Paci
team:
  people:
    Davide Paci: { login: dgpaci }
`
const LOG = `entries:
  - { id: D-001, date: 2026-11-17, kind: action, text: 'send the file', owner: Roberta, due: 2026-11-19, status: open }
  - { id: D-002, date: 2026-11-17, kind: action, text: 'call the secretary', owner: finizio }
  - { id: D-003, date: 2026-11-18, kind: action, text: 'book the room', owner: Roberta, status: done }
  - { id: D-004, date: 2026-11-18, kind: action, text: 'print the badges', owner: Marco }
  - { id: D-005, date: 2026-11-18, kind: action, text: 'find a sponsor' }
  - { id: D-006, date: 2026-11-19, kind: decision, text: 'keep the layout', owner: Roberta }
`
const FILES: Record<string, string> = {
  '/h/.config/p2kit/projects.yaml': 'projects:\n  - path: /t/owned\n',
  '/t/owned/.pm/project.yaml': PROJECT,
  '/t/owned/.pm/registers/daily-log.yaml': LOG,
}
const PANE = {
  plugin: 'p2kit',
  component: 'Pane',
  requestId: 'p2kit-desk',
  surface: 'desktop',
  props: { title: 'Project desk', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const RUN = { command: 'pm-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } } as const

test("a person's name drops a trailing note in brackets, as the owner of an action names them", () => {
  expect(getPersonName('Finizio (Secretary)')).toBe('Finizio')
  expect(getPersonName("Daniela D'Alessandro")).toBe("Daniela D'Alessandro")
  expect(getPersonName('R. (Bob) Smith')).toBe('R. (Bob) Smith')
})

test('each person of the roles carries the open actions they own, with or without a forge login; the rest are stray', () => {
  // wf:contract: buildProject gives each team member the open Daily Log actions whose owner is their name (a trailing note in
  // wf:contract: brackets dropped), case aside; `strayActions` are the open actions owned by nobody or by no person of the roles.
  const project = buildProject({ path: '/t/owned', project: PROJECT, products: [], workPackages: [], dailyLog: LOG }, '2026-11-20')
  expect(project.team.map(m => [m.person, m.name, m.actions.map(d => d.id)])).toEqual([
    ['Anna Rossi', 'Anna Rossi', []],
    ['Finizio (Secretary)', 'Finizio', ['D-002']],
    ['Roberta', 'Roberta', ['D-001']],
    ['Davide Paci', 'Davide Paci', []],
  ])
  expect(project.strayActions.map(d => d.id)).toEqual(['D-004', 'D-005'])
  expect(project.errors).toEqual([])
})

test('the page assigns checked open actions to a person of the roles and lists them per person in the Team tab, in the page and the pane', async ($, on) => {
  // wf:contract: Page: with the helper, each open action of the Daily log has a checkbox; a bar over the list offers every person of
  // wf:contract: the roles by name and "no owner", and previews a `log-owner` request; the reload waits while an action is checked.
  // wf:contract: Page and pane: the Team tab lists each person's open actions under their items, then "No team member" with the rest.
  const page = renderBoard({ projects: [buildProject({ path: '/t/owned', project: PROJECT, products: [], workPackages: [], dailyLog: LOG }, '2026-11-20')], refreshedAt: NOW, errors: [] })
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'))
  expect(script).toContain("act(p, { kind: 'log-owner', ids, owner: owner === '-' ? '' : owner })")
  expect(script).toContain("const canOwn = p => server && !p.pmRef && p.team.length > 0")
  expect(script).toContain("const isOpenAction = d => d.kind === 'action' && d.status === 'open'")
  expect(script).toContain("actionRows(m.actions || [], false, assignable && m.login && m.items.length)")
  expect(script).toContain("el('strong', { textContent: 'No team member' })")
  expect(script).toContain("if (preview.kind === 'log-owner') return [...fileChanges(preview),")
  expect(script).toContain('if (!pickedItems.size && !pickedActions.size) location.reload()')
  expect(script).not.toContain('${')

  mock.store(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:/t/owned' })
  await ui.press({ key: 'tab:team' })
  expect((await ui.find({ type: 'Text', text: '  D-001 send the file · due 2026-11-19 · action' }))?.props.color).toBe('red')
  expect(await ui.find({ type: 'Text', text: '  D-002 call the secretary · action' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  D-004 print the badges · Marco · action' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  D-005 find a sponsor · no owner · action' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '  D-003 book the room · action' })).toBeFalsy()
  await ui.unmount()
})
